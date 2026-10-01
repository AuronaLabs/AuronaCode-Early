import { AgentService } from "../../Core/Agent/AgentService";
import type {
  AgentToolCheckpointPolicy,
  AgentToolEffect,
  AgentToolMetadata,
  AgentToolPermission,
  AgentToolRecoverability,
} from "../../Core/Agent/AgentTypes";
import { getWorkspaceContext } from "../../Core/Agent/WorkspaceContext";
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

/** Exposes the effective runtime mode to the local Assistant surface. The setting still lives
 * in UserConfig; this read-only view keeps the panel badge in sync with tool execution. */
export function getAgentPermission(): AgentPermission {
  return agentPermission;
}

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
  effects: readonly AgentToolEffect[];
  permission: AgentToolPermission;
  checkpointPolicy: AgentToolCheckpointPolicy;
  recoverability: AgentToolRecoverability;
  resolveAffectedFiles?(args: Record<string, unknown>): Promise<string[]> | string[];
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
    effects: ["filesystem.read", "workspace.read"],
    permission: "read",
    checkpointPolicy: "never",
    recoverability: "fully-recoverable",
    parameters: toolParameters(
      { path: { type: "string", description: "Workspace-relative file path" } },
      ["path"],
    ),
    async execute(args) {
      const path = readStringArg(args, "path");
      if (!path) throw new Error("Missing required argument: path");
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
    effects: ["filesystem.read", "workspace.read"],
    permission: "read",
    checkpointPolicy: "never",
    recoverability: "fully-recoverable",
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
    effects: ["filesystem.read", "workspace.read"],
    permission: "read",
    checkpointPolicy: "never",
    recoverability: "fully-recoverable",
    parameters: toolParameters({ query: { type: "string", description: "Text to search for" } }, [
      "query",
    ]),
    async execute(args) {
      const query = readStringArg(args, "query");
      if (!query) throw new Error("Missing required argument: query");
      const root = WorkspaceService.getCurrent().primaryRoot;
      if (!root) throw new Error("No workspace is open");
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
    effects: ["filesystem.write", "workspace.modify"],
    permission: "approval-required",
    checkpointPolicy: "before-write",
    recoverability: "fully-recoverable",
    resolveAffectedFiles(args) {
      const path = readStringArg(args, "path");
      return path ? [resolveWorkspacePath(path)] : [];
    },
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
      if (!path || oldText === null) {
        throw new Error("Missing required argument: path / old_text");
      }
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
      if (firstMatch < 0) {
        throw new Error("Edit failed: old_text was not found; call read_file to verify the text");
      }
      if (content.indexOf(oldText, firstMatch + 1) >= 0) {
        throw new Error("Edit failed: old_text occurs more than once; provide a unique span");
      }
      if (signal?.aborted) throw new Error("Agent operation cancelled");
      await DocumentService.applyEdits(
        resolvedPath,
        [{ startUtf16: firstMatch, endUtf16: firstMatch + oldText.length, text: newText }],
        content.slice(0, firstMatch) + newText + content.slice(firstMatch + oldText.length),
        "external",
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
    effects: ["editor.read", "workspace.read"],
    permission: "read",
    checkpointPolicy: "never",
    recoverability: "fully-recoverable",
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
    effects: ["command.execute", "workspace.change"],
    permission: "approval-required",
    checkpointPolicy: "before-write",
    recoverability: "partially-recoverable",
    resolveAffectedFiles() {
      return DocumentService.getAll()
        .filter((document) => document.openState === "open")
        .map((document) => document.path);
    },
    parameters: toolParameters(
      { command: { type: "string", description: "Registered editor or workbench command" } },
      ["command"],
    ),
    async execute(args, signal) {
      const command = readStringArg(args, "command");
      if (!command) throw new Error("Missing required argument: command");
      if (signal?.aborted) throw new Error("Agent operation cancelled");
      const result = await CommandRegistry.execute(command);
      if (!result.ok) {
        throw new Error(
          `Command ${command} failed: ${result.error?.message ?? "command rejected"}`,
        );
      }
      return `命令 ${command} 已执行`;
    },
  },
  {
    name: "editor_context",
    signature: "editor_context()",
    description: "获取当前活动编辑器：文件路径、语言、选中文本与可见的全文内容",
    requiresConfirmation: false,
    effects: ["editor.read", "workspace.read"],
    permission: "read",
    checkpointPolicy: "never",
    recoverability: "fully-recoverable",
    parameters: toolParameters({}),
    async execute() {
      const context = getWorkspaceContext();
      const path = context.activeFile ?? "(no active file)";
      const language = context.language;
      const selection = context.selection;
      const text = EditorAdapter.getText();
      const diagnosticText =
        context.diagnostics.length > 0
          ? context.diagnostics
              .slice(0, DIAGNOSTICS_LIMIT)
              .map(
                (diagnostic) =>
                  `${diagnostic.uri} ${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1} [${diagnostic.severity}] ${diagnostic.message}`,
              )
              .join("\n")
          : "(none)";
      const lines = [
        `# projectRoot: ${context.projectRoot ?? "(none)"}`,
        `# path: ${path}`,
        `# language: ${language}`,
        `# cursor: ${context.cursor.line}:${context.cursor.column}`,
        `# opened files: ${context.openedFiles.map((file) => file.path).join(", ") || "(none)"}`,
        `# recent changes: ${context.recentChanges.map((change) => change.path).join(", ") || "(none)"}`,
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
    effects: [],
    permission: "read",
    checkpointPolicy: "never",
    recoverability: "fully-recoverable",
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
            `${tool.name}\n${tool.description}\nSchema: ${JSON.stringify(tool.parameters)}\nEffects: ${tool.effects.join(", ") || "none"}\nPermission: ${tool.permission}\nCheckpoint policy: ${tool.checkpointPolicy}\nRecoverability: ${tool.recoverability}\nExample: ${exampleForTool(tool.name)}`,
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
  return tools
    .map(
      (tool) =>
        `- ${tool.signature}: ${tool.description} (effects: ${tool.effects.join(", ") || "none"}; permission: ${tool.permission}; checkpoint: ${tool.checkpointPolicy}; recovery: ${tool.recoverability})`,
    )
    .join("\n");
}

export function getAgentToolMetadata(): AgentToolMetadata[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
    effects: [...tool.effects],
    permission: tool.permission,
    checkpointPolicy: tool.checkpointPolicy,
    recoverability: tool.recoverability,
  }));
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

async function validateToolArguments(
  tool: AiAgentTool,
  args: Record<string, unknown>,
): Promise<string | null> {
  const required = Array.isArray(tool.parameters.required)
    ? tool.parameters.required.filter((item): item is string => typeof item === "string")
    : [];
  const properties =
    tool.parameters.properties && typeof tool.parameters.properties === "object"
      ? (tool.parameters.properties as Record<string, { type?: unknown }>)
      : {};
  for (const key of required) {
    const value = args[key];
    if (value === undefined || value === null) return `Missing required argument: ${key}`;
    if (properties[key]?.type === "string" && typeof value !== "string") {
      return `Argument ${key} must be a string`;
    }
  }
  if (tool.name === "edit_file") {
    const path = readStringArg(args, "path");
    const oldText = readStringArg(args, "old_text");
    if (!path || oldText === null) return "Missing required argument: path / old_text";
    try {
      const resolvedPath = resolveWorkspacePath(path);
      const document = DocumentService.get(resolvedPath);
      const content =
        document?.openState === "open"
          ? document.content
          : await FileSystemCommands.readTextFile(resolvedPath);
      const firstMatch = content.indexOf(oldText);
      if (firstMatch < 0)
        return "Edit failed: old_text was not found; call read_file to verify the text";
      if (content.indexOf(oldText, firstMatch + 1) >= 0) {
        return "Edit failed: old_text occurs more than once; provide a unique span";
      }
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  return null;
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
            metadata: getAgentToolMetadata(),
            resolveAffectedFiles: async (invocation) => {
              const normalizedName =
                invocation.name.trim().split(/[.:/]/).pop() ?? invocation.name.trim();
              const tool = tools.find((candidate) => candidate.name === normalizedName);
              const args = parseArgs(invocation.arguments);
              return tool?.resolveAffectedFiles && args ? tool.resolveAffectedFiles(args) : [];
            },
            getToolMetadata: (name) =>
              getAgentToolMetadata().find((tool) => tool.name === name.trim().split(/[.:/]/).pop()),
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
  const validationError = await validateToolArguments(tool, args);
  if (validationError) return { content: validationError, isError: true };
  const requiresPermission =
    agentPermission === "ask" ||
    (agentPermission === "read" && tool.permission !== "read") ||
    (tool.permission === "approval-required" && agentPermission !== "full");
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
    const affectedFiles = tool.resolveAffectedFiles
      ? await tool.resolveAffectedFiles(args)
      : undefined;
    return {
      content: await tool.execute(args, invocation.signal),
      isError: false,
      affectedFiles,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    OutputService.append("core", `AI agent tool ${tool.name} failed: ${message}`, "warn");
    return { content: truncate(`工具执行失败：${message}`, TOOL_OUTPUT_LIMIT), isError: true };
  }
}
