import { AgentService } from "../../Core/Agent/AgentService";
import { DiagnosticsService } from "../../Core/DiagnosticsService";
import { DocumentService } from "../../Core/DocumentService";
import { EditorAdapter } from "../../Core/Editor/EditorAdapter";
import { OutputService } from "../../Core/OutputService";
import { WorkspaceService } from "../../Core/WorkspaceService";
import { CommandRegistry } from "../../Extension/CommandRegistry";
import { LocaleService } from "../../Foundation/I18n";
import { FileSystemCommands } from "../../Foundation/IPC/FileSystemCommands";
import { WorkspaceSearchIPC } from "../../Foundation/IPC/WorkspaceSearchCommands";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { AiPreferences } from "../../Foundation/Types/Config";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import { dismissNotification, showConfirm } from "../../UI/Feedback/Toast";

/**
 * 0.4.8 AI agent 工具执行端：把 0.4.7 预留的 tool_calls 协议接到真实能力上。
 *
 * 边界与安全：
 * - 所有文件类工具限定在当前工作区内（路径交由 Rust 侧 fs 工作区解析强制校验）
 * - edit_file / run_command 属写类操作，执行前经 showConfirm 用户确认；拒绝即返回
 *   「用户拒绝」结果且本轮不重试（提示词侧有对应约束）
 * - 输出统一截断，防止单次工具结果撑爆模型上下文
 */

/** 单条工具调用回传给模型的结果 */
export interface AiAgentToolOutcome {
  content: string;
  isError: boolean;
  affectedFiles?: string[];
}

/** Agent Responses 回调的工具调用（arguments 为聚合后的完整 JSON 字符串） */
export interface AiAgentToolInvocation {
  id: string;
  taskId: string;
  stepId: string;
  name: string;
  arguments: string;
  signal: AbortSignal;
}

/** 工具单次输出上限（字符） */
const TOOL_OUTPUT_LIMIT = 4_000;
/** read_file 单次读取上限（字符） */
const READ_FILE_LIMIT = 32_000;
/** editor_context 全文上限（字符） */
const EDITOR_CONTEXT_LIMIT = 24_000;
/** 诊断展示条数上限 */
const DIAGNOSTICS_LIMIT = 40;
/** 搜索结果展示条数上限 */
const SEARCH_RESULT_LIMIT = 30;

type AgentPermission = NonNullable<AiPreferences["agentPermission"]>;
let agentPermission: AgentPermission = "ask";

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n…(截断，共 ${text.length} 字符)` : text;
}

function stringifyArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args);
}

/** 解析工具参数 JSON；失败返回 null（调用方产出错误结果） */
function parseArgs(argumentsJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readStringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** 确认弹窗：确认返回 true，取消/拒绝返回 false */
async function confirmWriteAction(
  title: string,
  message: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;
  return new Promise((resolve) => {
    const id = `agent-confirm-${Date.now()}-${Math.random()}`;
    const onAbort = () => {
      dismissNotification(id);
      finish(false);
    };
    const finish = (confirmed: boolean) => {
      signal?.removeEventListener("abort", onAbort);
      resolve(confirmed);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    showConfirm({
      id,
      title,
      message,
      confirmLabel: LocaleService.translate("common.confirm"),
      cancelLabel: LocaleService.translate("common.cancel"),
      onConfirm: () => finish(!signal?.aborted),
      onCancel: () => finish(false),
    });
    if (signal?.aborted) onAbort();
  });
}

interface AiAgentTool {
  name: string;
  /** 提示词中的参数签名（agent 风格文档） */
  signature: string;
  description: string;
  requiresConfirmation: boolean;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
}

function resolveWorkspacePath(input: string | null, allowEmpty = false): string {
  const root = WorkspaceService.getCurrent().primaryRoot;
  if (!root) throw new Error("No workspace is open");
  const raw = (input ?? "").trim();
  if (!raw && !allowEmpty) throw new Error("A workspace path is required");
  const rootPath = root.replaceAll("\\", "/").replace(/\/+$/, "");
  const candidate = raw ? raw.replaceAll("\\", "/") : ".";
  const isAbsolute = /^[A-Za-z]:\//.test(candidate) || candidate.startsWith("/");
  const base = isAbsolute ? candidate : `${rootPath}/${candidate}`;
  const rootSegments = rootPath.split("/").filter(Boolean).length;
  const parts = base.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (normalized.length <= rootSegments) throw new Error("Path must stay inside the workspace");
      normalized.pop();
    } else normalized.push(part);
  }
  const resolved = (candidate.startsWith("/") ? "/" : "") + normalized.join("/");
  const normalizedRoot = rootPath.toLowerCase();
  const normalizedResolved = resolved.toLowerCase();
  if (
    normalizedResolved !== normalizedRoot &&
    !normalizedResolved.startsWith(`${normalizedRoot}/`)
  ) {
    throw new Error("Path must stay inside the workspace");
  }
  return resolved;
}

function toolParameters(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

const tools: AiAgentTool[] = [
  {
    name: "read_file",
    signature: "read_file(path)",
    description: "读取工作区内文件的完整文本内容",
    requiresConfirmation: false,
    parameters: toolParameters(
      { path: { type: "string", description: "Workspace-relative file path" } },
      ["path"],
    ),
    async execute(args) {
      const path = readStringArg(args, "path");
      if (!path) return "缺少参数 path";
      const resolvedPath = resolveWorkspacePath(path);
      const document = DocumentService.get(resolvedPath);
      const content =
        document?.openState === "open"
          ? document.content
          : await FileSystemCommands.readTextFile(resolvedPath);
      return truncate(`# ${resolvedPath}\n${content}`, READ_FILE_LIMIT);
    },
  },
  {
    name: "list_dir",
    signature: "list_dir(path)",
    description: "列出工作区内目录的子项（相对路径）",
    requiresConfirmation: false,
    parameters: toolParameters({
      path: {
        type: "string",
        description: "Workspace-relative directory path; defaults to workspace root",
      },
    }),
    async execute(args) {
      const path = readStringArg(args, "path") ?? "";
      const resolvedPath = resolveWorkspacePath(path, true);
      const entries = await FileSystemCommands.readDirectory(resolvedPath);
      const lines = entries.map((entry) => `${entry.isDirectory ? "[dir] " : ""}${entry.name}`);
      return truncate(`# ${resolvedPath}\n${lines.join("\n")}`, TOOL_OUTPUT_LIMIT);
    },
  },
  {
    name: "search_workspace",
    signature: "search_workspace(query)",
    description: "在工作区内容中搜索文本（大小写不敏感），返回文件、行号与匹配行",
    requiresConfirmation: false,
    parameters: toolParameters({ query: { type: "string", description: "Text to search for" } }, [
      "query",
    ]),
    async execute(args) {
      const query = readStringArg(args, "query");
      if (!query) return "缺少参数 query";
      const root = WorkspaceService.getCurrent().primaryRoot;
      if (!root) return "当前没有打开工作区";
      const response = await WorkspaceSearchIPC.searchText(
        root,
        query,
        false,
        false,
        `agent-${Date.now()}`,
      );
      const results = response.results.slice(0, SEARCH_RESULT_LIMIT);
      const lines = results.map(
        (result) => `${result.file_path}:${result.line_number + 1}: ${result.match_text.trim()}`,
      );
      const suffix = response.limit_reached ? "\n…(结果达到上限，请细化查询)" : "";
      return truncate(`${lines.join("\n")}${suffix}`, TOOL_OUTPUT_LIMIT);
    },
  },
  {
    name: "edit_file",
    signature: "edit_file(path, old_text, new_text)",
    description:
      "在工作区内文件中做一次精确文本替换（old_text 必须在文件中唯一）。文件会在编辑器中打开并可见，改动即时同步语言服务，保存仍由用户决定",
    requiresConfirmation: true,
    parameters: toolParameters(
      {
        path: { type: "string", description: "Workspace-relative file path" },
        old_text: { type: "string", description: "One unique exact text span to replace" },
        new_text: { type: "string", description: "Replacement text" },
      },
      ["path", "old_text", "new_text"],
    ),
    async execute(args, signal) {
      const path = readStringArg(args, "path");
      const oldText = readStringArg(args, "old_text");
      if (!path || oldText === null) return "缺少参数 path / old_text";
      const newText = typeof args.new_text === "string" ? args.new_text : "";
      const resolvedPath = resolveWorkspacePath(path);

      // 确保文档已打开（open 不开 UI 标签，openTab 负责可见性）
      const record = DocumentService.get(resolvedPath);
      const isOpen = record?.openState === "open";
      if (!isOpen) await DocumentService.open(resolvedPath);
      if (signal?.aborted) throw new Error("Agent operation cancelled");
      const current = DocumentService.get(resolvedPath);
      const content = current?.content ?? "";
      const firstMatch = content.indexOf(oldText);
      if (firstMatch < 0) return "编辑失败：old_text 在文件中不存在，请先 read_file 精确复制";
      if (content.indexOf(oldText, firstMatch + 1) >= 0) {
        return "编辑失败：old_text 在文件中出现多次，请加入更多上下文使其唯一";
      }
      if (signal?.aborted) throw new Error("Agent operation cancelled");
      await DocumentService.applyEdits(
        resolvedPath,
        [{ startUtf16: firstMatch, endUtf16: firstMatch + oldText.length, text: newText }],
        content.slice(0, firstMatch) + newText + content.slice(firstMatch + oldText.length),
      );
      void useWorkbenchStore.getState().openFile(resolvedPath);
      return `已修改 ${path}（${oldText.length} → ${newText.length} 字符），改动未保存，等待用户确认保存`;
    },
  },
  {
    name: "get_diagnostics",
    signature: "get_diagnostics()",
    description: "获取当前语言服务诊断（错误/警告）汇总",
    requiresConfirmation: false,
    parameters: toolParameters({}),
    async execute() {
      const documents = DiagnosticsService.getAll();
      const lines: string[] = [];
      for (const document of documents) {
        for (const diagnostic of document.diagnostics) {
          if (lines.length >= DIAGNOSTICS_LIMIT) break;
          const severity =
            diagnostic.severity === 1 ? "error" : diagnostic.severity === 2 ? "warning" : "info";
          lines.push(
            `${document.uri} ${diagnostic.range.start.line + 1}:${diagnostic.range.start.character} [${severity}] ${diagnostic.message}`,
          );
        }
      }
      return lines.length > 0 ? lines.join("\n") : "当前没有诊断信息";
    },
  },
  {
    name: "run_command",
    signature: "run_command(command)",
    description: "执行一条编辑器命令（editor.* / workbench.* 等，与命令面板同源）",
    requiresConfirmation: true,
    parameters: toolParameters(
      { command: { type: "string", description: "Registered editor or workbench command" } },
      ["command"],
    ),
    async execute(args, signal) {
      const command = readStringArg(args, "command");
      if (!command) return "缺少参数 command";
      if (signal?.aborted) throw new Error("Agent operation cancelled");
      const result = await CommandRegistry.execute(command);
      return result.ok
        ? `命令 ${command} 已执行`
        : `命令 ${command} 执行失败：${result.error?.message ?? "不可用或被门控"}`;
    },
  },
  {
    name: "editor_context",
    signature: "editor_context()",
    description: "获取当前活动编辑器：文件路径、语言、选中文本与可见的全文内容",
    requiresConfirmation: false,
    parameters: toolParameters({}),
    async execute() {
      const path = useWorkbenchStore.getState().activeTabId ?? "(no active file)";
      const language =
        path === "(no active file)"
          ? "unknown"
          : (DocumentService.get(path)?.languageId ?? "unknown");
      const selection = EditorAdapter.getSelectionText();
      const text = EditorAdapter.getText();
      const document = path === "(no active file)" ? undefined : DocumentService.get(path);
      const diagnostics = document?.uri
        ? (DiagnosticsService.get(document.uri)?.diagnostics ?? [])
        : [];
      const diagnosticText =
        diagnostics.length > 0
          ? diagnostics
              .slice(0, DIAGNOSTICS_LIMIT)
              .map(
                (diagnostic) =>
                  `${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1} [${diagnostic.severity}] ${diagnostic.message}`,
              )
              .join("\n")
          : "(none)";
      const lines = [
        `# path: ${path}`,
        `# language: ${language}`,
        selection ? `# selection:\n${selection}` : undefined,
        `# diagnostics:\n${diagnosticText}`,
        text ? `# content:\n${truncate(text, EDITOR_CONTEXT_LIMIT)}` : "# content: (empty)",
      ].filter((line): line is string => line !== undefined);
      return truncate(lines.join("\n\n"), TOOL_OUTPUT_LIMIT + EDITOR_CONTEXT_LIMIT);
    },
  },
  {
    name: "get_tool_help",
    signature: "get_tool_help(tool_name?)",
    description: "Return the exact schema and usage example for an available tool.",
    requiresConfirmation: false,
    parameters: toolParameters({
      tool_name: { type: "string", description: "Optional tool name" },
    }),
    async execute(args) {
      const requested = readStringArg(args, "tool_name");
      const normalized = requested?.trim().split(/[.:/]/).pop();
      const selected = normalized ? tools.find((tool) => tool.name === normalized) : undefined;
      const available = selected
        ? [selected]
        : tools.filter((tool) => tool.name !== "get_tool_help");
      return available
        .map(
          (tool) =>
            `${tool.name}\n${tool.description}\nSchema: ${JSON.stringify(tool.parameters)}\nExample: ${exampleForTool(tool.name)}`,
        )
        .join("\n\n");
    },
  },
];

function exampleForTool(name: string): string {
  switch (name) {
    case "read_file":
      return '{"path":"src/App.tsx"}';
    case "list_dir":
      return '{"path":"."}';
    case "search_workspace":
      return '{"query":"AgentService"}';
    case "edit_file":
      return '{"path":"src/App.tsx","old_text":"old","new_text":"new"}';
    case "run_command":
      return '{"command":"editor.formatDocument"}';
    case "get_tool_help":
      return '{"tool_name":"read_file"}';
    default:
      return "{}";
  }
}

/** 供系统提示词使用的工具清单文档（agent 风格） */
export function getAgentToolPromptDocs(): string {
  return tools.map((tool) => `- ${tool.signature}: ${tool.description}`).join("\n");
}

export function getAgentToolDefinitions(): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function describeArgs(name: string, args: Record<string, unknown>): string {
  if (name === "edit_file") {
    return `${String(args.path ?? "?")}：${String(args.old_text ?? "").slice(0, 60)} → ${String(args.new_text ?? "").slice(0, 60)}`;
  }
  return stringifyArgs(args).slice(0, 120);
}

/**
 * 同步 Agent 执行端注册到运行时（应用启动与设置变更后调用）。
 * 关闭时注销执行端：上下文不含工具规范段，模型不会发起工具调用。
 */
let registrationPromise: Promise<void> | null = null;

export function syncAgentExecutorRegistration(): Promise<void> {
  if (registrationPromise) return registrationPromise;
  const promise = UserConfigStore.get().then((config) => {
    const enabled = config.ai?.enabled !== false;
    agentPermission = config.ai?.agentPermission ?? "ask";
    AgentService.setExecutor(
      enabled
        ? {
            execute: executeAgentToolCall,
            toolPrompt: getAgentToolPromptDocs(),
            definitions: getAgentToolDefinitions(),
          }
        : null,
    );
  });
  registrationPromise = promise;
  void promise.then(
    () => {
      if (registrationPromise === promise) registrationPromise = null;
    },
    () => {
      if (registrationPromise === promise) registrationPromise = null;
    },
  );
  return promise;
}

/** 执行一次工具调用（含确认与错误归一化），供 Agent loop 调用 */
export async function executeAgentToolCall(
  invocation: AiAgentToolInvocation,
): Promise<AiAgentToolOutcome> {
  if (invocation.signal.aborted) return { content: "Agent operation cancelled", isError: true };
  const normalizedName = invocation.name.trim().split(/[.:/]/).pop() ?? invocation.name.trim();
  const tool = tools.find((candidate) => candidate.name === normalizedName);
  if (!tool) {
    return {
      content: `未知工具 ${invocation.name}。可用工具：${tools.map((candidate) => candidate.name).join(", ")}`,
      isError: true,
    };
  }
  const args = parseArgs(invocation.arguments);
  if (!args) {
    return { content: "参数不是合法的 JSON 对象，请以严格 JSON 重试", isError: true };
  }
  const readOnlyTool = [
    "read_file",
    "list_dir",
    "search_workspace",
    "get_diagnostics",
    "editor_context",
  ].includes(tool.name);
  const requiresPermission =
    agentPermission === "ask" ||
    (!readOnlyTool && agentPermission === "read") ||
    (!readOnlyTool && agentPermission === "edit" && tool.name === "run_command");
  if (requiresPermission || (tool.requiresConfirmation && agentPermission !== "full")) {
    AgentService.notifyApproval({
      taskId: invocation.taskId,
      stepId: invocation.stepId,
      state: "requested",
      toolName: tool.name,
      summary: describeArgs(tool.name, args),
      args: invocation.arguments,
    });
    const confirmed = await confirmWriteAction(
      LocaleService.translate("ai.agent.confirmTitle").replace("{tool}", tool.name),
      `${describeArgs(tool.name, args)}\n${LocaleService.translate("ai.agent.confirmMessage")}`,
      invocation.signal,
    );
    if (!confirmed) {
      AgentService.notifyApproval({
        taskId: invocation.taskId,
        stepId: invocation.stepId,
        state: invocation.signal.aborted ? "cancelled" : "rejected",
        toolName: tool.name,
        summary: describeArgs(tool.name, args),
        args: invocation.arguments,
      });
      return {
        content: "用户拒绝了此操作。不要重试同一操作；请调整方案或向用户说明",
        isError: true,
      };
    }
    AgentService.notifyApproval({
      taskId: invocation.taskId,
      stepId: invocation.stepId,
      state: "approved",
      toolName: tool.name,
      summary: describeArgs(tool.name, args),
      args: invocation.arguments,
    });
  }
  if (invocation.signal.aborted) return { content: "Agent operation cancelled", isError: true };
  try {
    return {
      content: await tool.execute(args, invocation.signal),
      isError: false,
      affectedFiles:
        tool.name === "edit_file" && typeof args.path === "string" ? [args.path] : undefined,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    OutputService.append("core", `AI agent tool ${tool.name} failed: ${message}`, "warn");
    return { content: truncate(`工具执行失败：${message}`, TOOL_OUTPUT_LIMIT), isError: true };
  }
}
