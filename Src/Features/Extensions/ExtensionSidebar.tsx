import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DocumentService } from "../../Core/DocumentService";
import { desktopFileSystem } from "../../Foundation/Desktop";
import { useLocale } from "../../Foundation/I18n";
import {
  ExtensionIPC,
  type ExtensionPermissionState,
  type ExtensionViewPayload,
} from "../../Foundation/IPC/ExtensionCommands";
import { SIDEBAR_EXTENSIONS } from "../../Shared/Constants/Sidebar";
import { useExtensionStore } from "../../State/useExtensionStore";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import { Button } from "../../UI/Components/Button";
import { Select } from "../../UI/Components/Select";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";
import { resolveExtensionName } from "./ExtensionUtils";
import { type ExtensionRenderState, ExtensionViewHost } from "./ExtensionViewHost";

const LARGE_DOCUMENT_BYTES = 512 * 1024;
const RENDER_DEBOUNCE_MS = 80;
const LARGE_DOCUMENT_DEBOUNCE_MS = 350;

export interface PlannerTask {
  id: string;
  title: string;
  category: string;
  priority: string;
  completed: boolean;
}

const CATEGORIES = [
  { name: "开发", color: "bg-blue-400" },
  { name: "测试", color: "bg-purple-400" },
  { name: "文档", color: "bg-emerald-400" },
  { name: "优化", color: "bg-amber-400" },
  { name: "设计", color: "bg-pink-400" },
];

const VSCODE_SAMPLE_SCRIPTS = [
  {
    name: "官方原生声明式组件",
    script: JSON.stringify({
      mode: "declarative",
      title: "官方原生拟物组件示例",
      description: "插件直接声明式复用 Aurona 官方 Select、Switch、Card 与 Button 组件",
      components: [
        {
          type: "card",
          id: "card_main",
          title: "扩展配置中心",
          subtitle: "Declarative Component System v1.0",
          children: [
            {
              type: "select",
              id: "targetChannel",
              label: "目标渠道",
              value: "pioneer",
              options: [
                { label: "Stable 正式稳定版", value: "stable" },
                { label: "Pioneer 先锋计划", value: "pioneer" },
              ],
            },
            {
              type: "switch",
              id: "autoSync",
              label: "自动同步状态",
              description: "开启后自动持久化至本地存储",
              checked: true,
            },
            {
              type: "input",
              id: "tokenInput",
              label: "访问令牌 (Token)",
              placeholder: "输入插件安全令牌...",
              inputType: "password",
            },
            {
              type: "progress",
              id: "compatProgress",
              label: "API 兼容就绪度",
              progress: 98.5,
            },
            {
              type: "button",
              id: "btnSave",
              label: "保存并应用配置",
              variant: "primary",
              action: "config:save",
            },
          ],
        },
      ],
    }),
  },
  {
    name: "命令与窗口交互",
    script: `vscode.commands.registerCommand("extension.sayHello", () => {
  vscode.window.showInformationMessage("Hello from VSCode Compat Layer!");
});
vscode.window.showWarningMessage("API Compatibility verified.");`,
  },
  {
    name: "文件系统与剪贴板",
    script: `const uri = vscode.Uri.file("/workspace/README.md");
vscode.workspace.fs.readFile(uri).then(content => {
  vscode.env.clipboard.writeText("Read " + content.length + " bytes");
});`,
  },
];

function currentTheme(): string {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

const isMarkdownFile = (filePath: string | null): boolean => {
  if (!filePath) return false;
  return /\.(md|markdown|mdown|mkd|mdx)$/i.test(filePath);
};

export function ExtensionSidebar({ extensionId }: { extensionId: string }) {
  const { t, locale } = useLocale();
  const descriptor = useExtensionStore((state) =>
    state.descriptors.find((item) => item.id === extensionId),
  );
  const tabs = useWorkbenchStore((state) => state.tabs);
  const activeTabId = useWorkbenchStore((state) => state.activeTabId);
  const setActiveSidebar = useWorkbenchStore((state) => state.setActiveSidebar);
  const activePath =
    tabs.find((tab) => tab.id === activeTabId && tab.type === "file")?.path ?? null;

  const isStandalone = extensionId === "aurona.planner" || extensionId === "aurona.vscode-compat";
  const isPlanner = extensionId === "aurona.planner";
  const isVsCodeCompat = extensionId === "aurona.vscode-compat";

  const [view, setView] = useState<ExtensionViewPayload | null>(null);
  const [viewFailed, setViewFailed] = useState(false);
  const [editorPermission, setEditorPermission] = useState<ExtensionPermissionState>(
    isStandalone ? "granted" : "unknown",
  );
  const [renderState, setRenderState] = useState<ExtensionRenderState | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Planner 专属状态
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskCategory, setNewTaskCategory] = useState("开发");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "completed">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // VSCode Compat 专属状态
  const [compatScript, setCompatScript] = useState("");

  const latestDocument = useRef<{ content: string; version: number } | null>(null);
  const debounceTimer = useRef<number | null>(null);
  const generation = useRef(0);
  const activePathRef = useRef(activePath);
  activePathRef.current = activePath;

  const runRender = useCallback(
    async (docPayload: { content: string; version: number }) => {
      const currentGeneration = ++generation.current;
      try {
        const isBold = window.document.documentElement.getAttribute("data-bold-text") === "true";
        const fontSizeAttr =
          window.document.documentElement.getAttribute("data-font-size") || "default";
        const accentTheme =
          window.document.documentElement.getAttribute("data-accent-theme") || "aurora";
        const response = await ExtensionIPC.render({
          extensionId,
          markdown: docPayload.content,
          activeEditorPath: isStandalone ? null : activePathRef.current,
          theme: currentTheme(),
          accentColor: accentTheme,
          colorScheme: currentTheme(),
          locale,
          fontWeight: isBold ? "bold" : "normal",
          fontSize: fontSizeAttr,
        });
        if (currentGeneration !== generation.current) return;
        setRenderError(null);
        setRenderState({
          html: response.html,
          diagnostics: response.diagnostics,
          revision: docPayload.version,
        });
      } catch (error) {
        if (currentGeneration !== generation.current) return;
        setRenderError(error instanceof Error ? error.message : String(error));
      }
    },
    [extensionId, isStandalone, locale],
  );

  const scheduleRender = useCallback(() => {
    if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current);
    const document = latestDocument.current;
    if (!document) return;
    const delay =
      document.content.length > LARGE_DOCUMENT_BYTES
        ? LARGE_DOCUMENT_DEBOUNCE_MS
        : RENDER_DEBOUNCE_MS;
    debounceTimer.current = window.setTimeout(() => {
      void runRender(document);
    }, delay);
  }, [runRender]);

  const refresh = useCallback(async () => {
    if (isStandalone) {
      latestDocument.current = { content: compatScript, version: Date.now() };
      await runRender(latestDocument.current);
      return;
    }

    const path = activePathRef.current;
    if (!path || !isMarkdownFile(path)) {
      latestDocument.current = null;
      setRenderState(null);
      setRenderError(null);
      return;
    }
    let record = DocumentService.get(path);
    if (!record || record.content === undefined) {
      try {
        record = await DocumentService.open(path);
      } catch {
        // ignore
      }
    }
    if (record?.content !== undefined) {
      latestDocument.current = { content: record.content, version: record.version };
      await runRender(latestDocument.current);
    }
  }, [isStandalone, compatScript, runRender]);

  // Planner: 添加新任务
  const handleAddNewTask = useCallback(() => {
    const trimmed = newTaskTitle.trim();
    if (!trimmed) return;
    const newTask: PlannerTask = {
      id: `task_${Date.now()}`,
      title: trimmed,
      category: newTaskCategory,
      priority: "normal",
      completed: false,
    };
    const updated = [newTask, ...tasks];
    setTasks(updated);
    setNewTaskTitle("");
    void runRender({
      content: JSON.stringify(updated),
      version: Date.now(),
    });
  }, [newTaskTitle, newTaskCategory, tasks, runRender]);

  // Planner: 清理已完成任务
  const handleClearCompleted = useCallback(() => {
    const updated = tasks.filter((t) => !t.completed);
    setTasks(updated);
    void runRender({
      content: JSON.stringify(updated),
      version: Date.now(),
    });
  }, [tasks, runRender]);

  // VSCode Compat: 运行示例或自定义脚本转译
  const handleRunCompatSample = useCallback(
    (script: string) => {
      setCompatScript(script);
      void runRender({
        content: script,
        version: Date.now(),
      });
    },
    [runRender],
  );

  // 1. 初始化读取插件基础视图与 Planner 初始任务
  useEffect(() => {
    let cancelled = false;
    setViewFailed(false);
    void (async () => {
      try {
        const payload = await useExtensionStore.getState().viewFor(extensionId);
        if (!cancelled && payload) {
          setView(payload);
        }
      } catch {
        if (!cancelled) setViewFailed(true);
      }

      // Planner: 尝试读取工作区现有 planner.json
      if (isPlanner) {
        try {
          const exists = await desktopFileSystem.exists(".aurona/planner.json");
          if (exists) {
            const raw = await desktopFileSystem.readTextFile(".aurona/planner.json");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              setTasks(parsed);
            }
          }
        } catch {
          // 初始化时无 planner.json 属正常
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [extensionId, isPlanner]);

  // 2. 监听权限状态
  useEffect(() => {
    if (isStandalone) {
      setEditorPermission("granted");
      return;
    }
    let cancelled = false;
    const permissionName = "editor.current.read";
    void (async () => {
      try {
        const permState = await useExtensionStore
          .getState()
          .permissionFor(extensionId, permissionName);
        if (!cancelled) {
          setEditorPermission(permState);
          if (permState === "granted") {
            void refresh();
          }
        }
      } catch {
        // 权限查询失败时保持未知状态
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [extensionId, isStandalone, refresh]);

  // 3. 独立插件初次自动渲染与编辑器文档变更订阅
  useEffect(() => {
    if (isStandalone) {
      void refresh();
      return;
    }

    if (debounceTimer.current !== null) {
      window.clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (!activePath) {
      latestDocument.current = null;
      setRenderState(null);
      setRenderError(null);
      return;
    }
    void refresh();
    const unsubscribe = DocumentService.subscribe(activePath, (record) => {
      if (!record || record.content === undefined) {
        latestDocument.current = null;
        setRenderState(null);
        return;
      }
      const prev = latestDocument.current;
      latestDocument.current = { content: record.content, version: record.version };
      if (editorPermission === "granted") {
        if (!prev || prev.version === 0) {
          void runRender(latestDocument.current);
        } else {
          scheduleRender();
        }
      }
    });
    return unsubscribe;
  }, [activePath, editorPermission, isStandalone, refresh, runRender, scheduleRender]);

  useEffect(
    () => () => {
      if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (renderError) {
      showToast(`${t("extensions.renderError")}: ${renderError}`, "error");
    }
  }, [renderError, t]);

  const name = resolveExtensionName(descriptor, locale) || extensionId;
  const isPermissionGranted = isStandalone || editorPermission === "granted";

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (statusFilter === "pending" && t.completed) return false;
      if (statusFilter === "completed" && !t.completed) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return t.title.toLowerCase().includes(query) || t.category.toLowerCase().includes(query);
      }
      return true;
    });
  }, [tasks, statusFilter, searchQuery]);

  useEffect(() => {
    if (!isPlanner || editorPermission !== "granted") return;
    void runRender({
      content: JSON.stringify(filteredTasks),
      version: Date.now(),
    });
  }, [isPlanner, editorPermission, filteredTasks, runRender]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* 顶部标题栏 */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-3.5 pb-1.5 pt-2">
        <h2 className="truncate text-[13px] font-semibold text-[var(--color-text-highlight)]">
          {name}
        </h2>
        <div className="flex items-center gap-1">
          {isPlanner && tasks.some((t) => t.completed) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-red-400"
              title="清理已完成任务"
              onClick={handleClearCompleted}
            >
              <Icons.Trash size={13} className="mr-1 inline" />
              清理已完成
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="size-7 rounded-md p-0 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-highlight)]"
            title="刷新视图"
            onClick={() => void refresh()}
          >
            <Icons.Refresh size={14} stroke={1.75} />
          </Button>
        </div>
      </div>

      {/* VSCode Compat 专属操作栏 */}
      {isVsCodeCompat && (
        <div className="mx-2.5 mb-2 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 p-2 shadow-sm backdrop-blur-md">
            <span className="text-[11.5px] font-medium text-[var(--color-text-primary)]">
              转译示例测试
            </span>
            <div className="flex items-center gap-1">
              {VSCODE_SAMPLE_SCRIPTS.map((sample) => (
                <Button
                  key={sample.name}
                  size="sm"
                  variant="secondary"
                  className="h-6 px-2 text-[10.5px]"
                  onClick={() => handleRunCompatSample(sample.script)}
                >
                  {sample.name}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Planner 专属功能操作栏 */}
      {isPlanner && isPermissionGranted && (
        <div className="mx-2.5 mb-2 flex flex-col gap-2">
          {/* 快速新建任务栏 */}
          <div className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 p-1.5 shadow-sm backdrop-blur-md">
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddNewTask();
              }}
              placeholder="新建任务或测试项..."
              className="min-w-0 flex-1 bg-transparent px-2 text-[12px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
            />

            {/* 官方原生拟物分类选择器 */}
            <div className="w-24 shrink-0">
              <Select
                value={newTaskCategory}
                onChange={(val) => setNewTaskCategory(val)}
                options={CATEGORIES.map((c) => ({
                  label: c.name,
                  value: c.name,
                }))}
                className="h-7 min-w-[90px] text-[11px] px-2 py-0"
              />
            </div>

            <Button
              size="sm"
              onClick={handleAddNewTask}
              disabled={!newTaskTitle.trim()}
              className="h-7 shrink-0 px-2.5 text-[11px]"
            >
              <Icons.Plus size={13} className="mr-0.5" />
              添加
            </Button>
          </div>

          {/* 筛选与搜索 */}
          <div className="flex items-center justify-between gap-1.5 px-0.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all ${
                  statusFilter === "all"
                    ? "bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] shadow-sm"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                全部 ({tasks.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("pending")}
                className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all ${
                  statusFilter === "pending"
                    ? "bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] shadow-sm"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                待办 ({tasks.filter((t) => !t.completed).length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("completed")}
                className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all ${
                  statusFilter === "completed"
                    ? "bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] shadow-sm"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                已完成 ({tasks.filter((t) => t.completed).length})
              </button>
            </div>

            <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-2 py-0.5">
              <Icons.Search size={11} className="text-[var(--color-text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索任务..."
                className="w-16 bg-transparent text-[11px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)] focus:w-24 transition-all"
              />
            </div>
          </div>
        </div>
      )}

      {/* 核心内卡片容器：带边距与圆角矩形，内容完全居中对齐 */}
      <div className="relative mx-2.5 mb-2.5 flex min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/30 shadow-[inset_0_1px_1px_var(--material-inset)]">
        {!isStandalone && !isPermissionGranted ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--material-surface)] text-[var(--color-text-muted)]">
              <Icons.InfoCircle size={22} stroke={1.5} />
            </div>
            <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
              {t("extensions.permissionTitle")}
            </span>
            <p className="max-w-[220px] text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              {t("extensions.editorReadDescription")}
            </p>
            <Button size="sm" className="mt-2" onClick={() => setActiveSidebar(SIDEBAR_EXTENSIONS)}>
              {t("extensions.sidebarTitle")}
            </Button>
          </div>
        ) : viewFailed ? (
          <div className="flex h-full w-full flex-col items-center justify-center px-4 text-center text-xs text-[var(--color-text-muted)]">
            {t("extensions.viewFailed")}
          </div>
        ) : !isStandalone && !activePath ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--material-surface)] text-[var(--color-text-muted)]">
              <Icons.FileText size={20} stroke={1.5} />
            </div>
            <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
              {t("extensions.noActiveEditor")}
            </span>
            <p className="max-w-[220px] text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              {t("extensions.markdownOnlyPrompt")}
            </p>
          </div>
        ) : !isStandalone && !isMarkdownFile(activePath) ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--material-surface)] text-[var(--color-text-muted)]">
              <Icons.FileText size={20} stroke={1.5} />
            </div>
            <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
              {t("extensions.nonMarkdownFile")}
            </span>
            <p className="max-w-[220px] text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              {t("extensions.markdownOnlyPrompt")}
            </p>
          </div>
        ) : view ? (
          <ExtensionViewHost
            viewHtml={view.html}
            theme={currentTheme()}
            renderState={renderState}
            onAction={(actionId) => {
              showToast(`组件交互: ${actionId}`, "info");
            }}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center px-4 text-center text-xs text-[var(--color-text-muted)]">
            {t("extensions.loading")}
          </div>
        )}
      </div>
    </div>
  );
}
