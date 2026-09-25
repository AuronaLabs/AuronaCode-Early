import { AiChatService } from "../../Core/AiChatService";
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
}

/** AiChatService 回调的工具调用（arguments 为聚合后的完整 JSON 字符串） */
export interface AiAgentToolInvocation {
  id: string;
  name: string;
  arguments: string;
  signal?: AbortSignal;
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
  execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
}

const tools: AiAgentTool[] = [
  {
    name: "read_file",
    signature: "read_file(path)",
    description: "读取工作区内文件的完整文本内容",
    requiresConfirmation: false,
    async execute(args) {
      const path = readStringArg(args, "path");
      if (!path) return "缺少参数 path";
      const document = DocumentService.get(path);
      const content =
        document?.openState === "open"
          ? document.content
          : await FileSystemCommands.readTextFile(path);
      return truncate(`# ${path}\n${content}`, READ_FILE_LIMIT);
    },
  },
  {
    name: "list_dir",
    signature: "list_dir(path)",
    description: "列出工作区内目录的子项（相对路径）",
    requiresConfirmation: false,
    async execute(args) {
      const path = readStringArg(args, "path") ?? "";
      const entries = await FileSystemCommands.readDirectory(path);
      const lines = entries.map((entry) => `${entry.isDirectory ? "[dir] " : ""}${entry.name}`);
      return truncate(`# ${path || "."}\n${lines.join("\n")}`, TOOL_OUTPUT_LIMIT);
    },
  },
  {
    name: "search_workspace",
    signature: "search_workspace(query)",
    description: "在工作区内容中搜索文本（大小写不敏感），返回文件、行号与匹配行",
    requiresConfirmation: false,
    async execute(args) {
      const query = readStringArg(args, "query");
      if (!query) return "缺少参数 query";
      const root = WorkspaceService.getCurrent().primaryRoot ?? "";
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
    async execute(args, signal) {
      const path = readStringArg(args, "path");
      const oldText = readStringArg(args, "old_text");
      if (!path || oldText === null) return "缺少参数 path / old_text";
      const newText = typeof args.new_text === "string" ? args.new_text : "";

      // 确保文档已打开（open 不开 UI 标签，openTab 负责可见性）
      const record = DocumentService.get(path);
      const isOpen = record?.openState === "open";
      if (!isOpen) await DocumentService.open(path);
      if (signal?.aborted) throw new Error("Agent operation cancelled");
      const current = DocumentService.get(path);
      const content = current?.content ?? "";
      const firstMatch = content.indexOf(oldText);
      if (firstMatch < 0) return "编辑失败：old_text 在文件中不存在，请先 read_file 精确复制";
      if (content.indexOf(oldText, firstMatch + 1) >= 0) {
        return "编辑失败：old_text 在文件中出现多次，请加入更多上下文使其唯一";
      }
      if (signal?.aborted) throw new Error("Agent operation cancelled");
      await DocumentService.applyEdits(
        path,
        [{ startUtf16: firstMatch, endUtf16: firstMatch + oldText.length, text: newText }],
        content.slice(0, firstMatch) + newText + content.slice(firstMatch + oldText.length),
      );
      void useWorkbenchStore.getState().openFile(path);
      return `已修改 ${path}（${oldText.length} → ${newText.length} 字符），改动未保存，等待用户确认保存`;
    },
  },
  {
    name: "get_diagnostics",
    signature: "get_diagnostics()",
    description: "获取当前语言服务诊断（错误/警告）汇总",
    requiresConfirmation: false,
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
    async execute() {
      const path = useWorkbenchStore.getState().activeTabId ?? "(无活动文件)";
      const language = DocumentService.get(path)?.languageId ?? "unknown";
      const selection = EditorAdapter.getSelectionText();
      const text = EditorAdapter.getText();
      const lines = [
        `# path: ${path}`,
        `# language: ${language}`,
        selection ? `# selection:\n${selection}` : undefined,
        text ? `# content:\n${truncate(text, EDITOR_CONTEXT_LIMIT)}` : "# content: (empty)",
      ].filter((line): line is string => line !== undefined);
      return truncate(lines.join("\n\n"), TOOL_OUTPUT_LIMIT + EDITOR_CONTEXT_LIMIT);
    },
  },
];

/** 供系统提示词使用的工具清单文档（agent 风格） */
export function getAgentToolPromptDocs(): string {
  return tools.map((tool) => `- ${tool.signature}: ${tool.description}`).join("\n");
}

function describeArgs(name: string, args: Record<string, unknown>): string {
  if (name === "edit_file") {
    return `${String(args.path ?? "?")}：${String(args.old_text ?? "").slice(0, 60)} → ${String(args.new_text ?? "").slice(0, 60)}`;
  }
  return stringifyArgs(args).slice(0, 120);
}

/**
 * 同步 agent 执行端注册到 AiChatService（应用启动与设置变更后调用）。
 * 关闭时注销执行端：上下文不含工具规范段，模型不会发起工具调用。
 */
export function syncAgentExecutorRegistration(): void {
  void UserConfigStore.get().then((config) => {
    const enabled = config.ai?.enabled !== false;
    agentPermission = config.ai?.agentPermission ?? "ask";
    AiChatService.setAgentExecutor(
      enabled ? { execute: executeAgentToolCall, toolPrompt: getAgentToolPromptDocs() } : null,
    );
  });
}

/** 执行一次工具调用（含确认与错误归一化），供 AiChatService agent loop 调用 */
export async function executeAgentToolCall(
  invocation: AiAgentToolInvocation,
): Promise<AiAgentToolOutcome> {
  if (invocation.signal?.aborted) return { content: "Agent operation cancelled", isError: true };
  const tool = tools.find((candidate) => candidate.name === invocation.name);
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
    const confirmed = await confirmWriteAction(
      LocaleService.translate("ai.agent.confirmTitle").replace("{tool}", tool.name),
      `${describeArgs(tool.name, args)}\n${LocaleService.translate("ai.agent.confirmMessage")}`,
      invocation.signal,
    );
    if (!confirmed) {
      return {
        content: "用户拒绝了此操作。不要重试同一操作；请调整方案或向用户说明",
        isError: true,
      };
    }
  }
  if (invocation.signal?.aborted) return { content: "Agent operation cancelled", isError: true };
  try {
    return { content: await tool.execute(args, invocation.signal), isError: false };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    OutputService.append("core", `AI agent tool ${tool.name} failed: ${message}`, "warn");
    return { content: truncate(`工具执行失败：${message}`, TOOL_OUTPUT_LIMIT), isError: true };
  }
}
