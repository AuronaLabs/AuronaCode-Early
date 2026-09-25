import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DocumentService } from "../../Core/DocumentService";
import { EditorAdapter } from "../../Core/Editor/EditorAdapter";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import {
  ExtensionIPC,
  type ExtensionPermissionState,
  type ExtensionViewPayload,
  parseExtensionError,
} from "../../Foundation/IPC/ExtensionCommands";
import { useExtensionStore } from "../../State/useExtensionStore";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import { Button } from "../../UI/Components/Button";
import { Card } from "../../UI/Components/Card";
import { Input } from "../../UI/Components/Input";
import { Select } from "../../UI/Components/Select";
import { showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../UI/Layouts/SidebarPage";
import {
  ExtensionPermissionPrompt,
  type PermissionResolveMode,
  permissionSegment,
} from "./ExtensionPermissionPrompt";
import { resolveExtensionName } from "./ExtensionUtils";
import { type ExtensionRenderState, ExtensionViewHost } from "./ExtensionViewHost";
import {
  type PlannerDocument,
  type PlannerPriority,
  PlannerService,
  type PlannerStatus,
  type PlannerTask,
  toPlannerPayload,
} from "./Planner/PlannerService";

const LARGE_DOCUMENT_BYTES = 512 * 1024;
const RENDER_DEBOUNCE_MS = 80;
const LARGE_DOCUMENT_DEBOUNCE_MS = 350;

const CATEGORIES = [
  { name: "开发", color: "bg-[var(--StatusInfo)]" },
  { name: "测试", color: "bg-[var(--VizIndigo)]" },
  { name: "文档", color: "bg-[var(--StatusSuccess)]" },
  { name: "优化", color: "bg-[var(--StatusWarning)]" },
  { name: "设计", color: "bg-[var(--VizFuchsia)]" },
];

function currentTheme(): string {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function currentExtensionAccent(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--AccentPrimary").trim();
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
  const title = resolveExtensionName(descriptor, locale) || descriptor?.name || extensionId;
  const tabs = useWorkbenchStore((state) => state.tabs);
  const activeTabId = useWorkbenchStore((state) => state.activeTabId);
  const activePath =
    tabs.find((tab) => tab.id === activeTabId && tab.type === "file")?.path ?? null;

  const isPlanner = extensionId === "auronalabs.planner";
  // VSIX 兼容型扩展（安装入口装载）：由后端注入主入口 JS 源码渲染，不依赖编辑器文档
  const isVsCodeType = extensionId.startsWith("vscode-") || extensionId.endsWith(".vsix");
  const isStandalone = isPlanner || isVsCodeType;

  // 权限按声明驱动（修复此前对 planner/vscode 系硬编码 granted 绕过权限系统的问题）：
  // 扩展 manifest 声明了 editor.current.read 才需要走授权流程；
  // 内置独立面板（兼容层/演示）不读编辑器内容，无需编辑器权限。
  const needsEditorRead = descriptor
    ? descriptor.permissions.includes("editor.current.read")
    : false;

  const [view, setView] = useState<ExtensionViewPayload | null>(null);
  const [viewFailed, setViewFailed] = useState(false);
  const [editorPermission, setEditorPermission] = useState<ExtensionPermissionState>(
    needsEditorRead ? "unknown" : "granted",
  );
  const [permissionLoaded, setPermissionLoaded] = useState(!needsEditorRead);
  // 通用授权弹窗：记录当前请求授权的权限（editor.current.read 之外也走同一弹窗）
  const [promptPermission, setPromptPermission] = useState<string | null>(null);
  const [renderState, setRenderState] = useState<ExtensionRenderState | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Planner 专属状态
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskCategory, setNewTaskCategory] = useState("开发");
  const [statusFilter, setStatusFilter] = useState<"all" | PlannerStatus>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | PlannerPriority>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [plannerSaveError, setPlannerSaveError] = useState<string | null>(null);

  const latestDocument = useRef<{ content: string; version: number } | null>(null);
  const debounceTimer = useRef<number | null>(null);
  const generation = useRef(0);
  const activePathRef = useRef(activePath);
  activePathRef.current = activePath;

  // 结构化错误分流（0.4.6）：permission.required → 弹通用授权弹窗并等待重授权后重渲染；
  // permission.denied / compat.* → 本地化文案；其余原样展示。
  const handleRenderFailure = useCallback(
    (error: unknown) => {
      const parsed = parseExtensionError(error);
      if (parsed.code?.startsWith("permission.required:")) {
        setPromptPermission(parsed.code.slice("permission.required:".length));
        setRenderError(null);
        return;
      }
      if (parsed.code?.startsWith("permission.denied:")) {
        const permission = parsed.code.slice("permission.denied:".length);
        setRenderError(
          t("extensions.errors.permissionDenied").replace(
            "{permission}",
            t(`extensions.permission.${permissionSegment(permission)}.name` as I18nKey),
          ),
        );
        return;
      }
      if (parsed.code === "compat.missing" || parsed.code === "compat.wasm.empty") {
        setRenderError(t("extensions.errors.compatNotReady"));
        return;
      }
      if (parsed.code === "api.unsupported") {
        setRenderError(parsed.detail);
        return;
      }
      setRenderError(parsed.detail);
    },
    [t],
  );

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
          selectionText: EditorAdapter.getSelectionText() || null,
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
        handleRenderFailure(error);
      }
    },
    [extensionId, isStandalone, locale, handleRenderFailure],
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

  // 交互回传（修复缺陷 #11：此前 onAction 只弹 toast，声明式组件交互无法回传扩展）。
  // 请求-响应模型：动作交给扩展，拿回下一帧渲染并替换当前视图。
  const runAction = useCallback(
    async (actionId: string, payload?: unknown) => {
      const currentGeneration = ++generation.current;
      const serializedPayload =
        typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
      try {
        const isBold = window.document.documentElement.getAttribute("data-bold-text") === "true";
        const fontSizeAttr =
          window.document.documentElement.getAttribute("data-font-size") || "default";
        const accentTheme =
          window.document.documentElement.getAttribute("data-accent-theme") || "aurora";
        const response = await ExtensionIPC.onAction({
          extensionId,
          actionId,
          payload: serializedPayload,
          activeEditorPath: isStandalone ? null : activePathRef.current,
          selectionText: EditorAdapter.getSelectionText() || null,
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
          revision: Date.now(),
        });
      } catch (error) {
        if (currentGeneration !== generation.current) return;
        const parsed = parseExtensionError(error);
        if (parsed.code?.startsWith("permission.required:")) {
          setPromptPermission(parsed.code.slice("permission.required:".length));
          return;
        }
        showToast(parsed.detail, "warning");
      }
    },
    [extensionId, isStandalone, locale],
  );

  const refresh = useCallback(async () => {
    if (isStandalone) {
      // Planner 由任务持久化驱动渲染；VSCode 型扩展由后端注入 js_source，markdown 内容不参与
      if (!isPlanner) {
        latestDocument.current = { content: "", version: Date.now() };
        await runRender(latestDocument.current);
      }
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
  }, [isStandalone, isPlanner, runRender]);

  // Planner: 添加新任务
  const persistPlannerTasks = useCallback(
    async (nextTasks: PlannerTask[]) => {
      const document: PlannerDocument = { schemaVersion: 2, tasks: nextTasks };
      try {
        await PlannerService.save(document);
        setPlannerSaveError(null);
      } catch (error) {
        setPlannerSaveError(error instanceof Error ? error.message : String(error));
      }
      void runRender({ content: toPlannerPayload(document), version: Date.now() });
    },
    [runRender],
  );

  const handleAddNewTask = useCallback(() => {
    const trimmed = newTaskTitle.trim();
    if (!trimmed) return;
    const timestamp = new Date().toISOString();
    const newTask: PlannerTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: trimmed,
      category: newTaskCategory,
      description: "",
      status: "todo",
      priority: "normal",
      tags: [],
      order: Date.now(),
      createdAt: timestamp,
      updatedAt: timestamp,
      completed: false,
    };
    const updated = [newTask, ...tasks];
    setTasks(updated);
    setNewTaskTitle("");
    void persistPlannerTasks(updated);
  }, [newTaskTitle, newTaskCategory, persistPlannerTasks, tasks]);

  // Planner: 清理已完成任务
  const handleClearCompleted = useCallback(() => {
    const updated = tasks.filter((t) => !t.completed);
    setTasks(updated);
    void persistPlannerTasks(updated);
  }, [persistPlannerTasks, tasks]);

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
          const result = await PlannerService.load();
          if (!cancelled) {
            setTasks(result.document.tasks);
            if (result.migrated) await PlannerService.save(result.document);
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

  // 2. 监听权限状态（仅当扩展声明了 editor.current.read 时走预授权流程；
  //    其余权限在运行期由结构化错误 permission.required 触发通用弹窗）
  useEffect(() => {
    if (!needsEditorRead) {
      setEditorPermission("granted");
      setPermissionLoaded(true);
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
          setPermissionLoaded(true);
          setPromptPermission(permState === "unknown" ? permissionName : null);
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
  }, [extensionId, needsEditorRead, refresh]);

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

  const isPermissionGranted = !needsEditorRead || editorPermission === "granted";

  // 通用授权处理：once（仅本次）/ workspace（此工作区）/ global（所有工作区）/ deny。
  // promptPermission 可为任意权限（editor.current.read 之外的由运行期错误触发）。
  const resolvePermission = useCallback(
    async (permission: string, mode: PermissionResolveMode) => {
      try {
        const nextState =
          mode === "once"
            ? await ExtensionIPC.setSessionPermission(extensionId, permission, true)
            : await useExtensionStore
                .getState()
                .setPermission(
                  extensionId,
                  permission,
                  mode !== "deny",
                  mode === "deny" ? "workspace" : mode,
                );
        if (permission === "editor.current.read") {
          setEditorPermission(nextState);
        }
        setPromptPermission(null);
        if (nextState === "granted") void refresh();
      } catch (error) {
        const parsed = parseExtensionError(error);
        showToast(parsed.detail, "warning");
      }
    },
    [extensionId, refresh],
  );

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return (
          t.title.toLowerCase().includes(query) ||
          t.category.toLowerCase().includes(query) ||
          t.description.toLowerCase().includes(query) ||
          t.tags.some((tag) => tag.toLowerCase().includes(query))
        );
      }
      return true;
    });
  }, [priorityFilter, searchQuery, statusFilter, tasks]);

  useEffect(() => {
    if (!isPlanner || editorPermission !== "granted") return;
    void runRender({
      content: toPlannerPayload({ schemaVersion: 2, tasks: filteredTasks }),
      version: Date.now(),
    });
  }, [isPlanner, editorPermission, filteredTasks, runRender]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-transparent">
      {promptPermission && permissionLoaded && (
        <ExtensionPermissionPrompt
          permission={promptPermission}
          title={title}
          onResolve={(mode) => void resolvePermission(promptPermission, mode)}
        />
      )}
      {/* 统一系统侧边栏头部 */}
      <SidebarPageHeader
        title={title}
        actions={
          <div className="flex items-center gap-0.5">
            {isPlanner && tasks.some((t) => t.completed) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--StatusError)]"
                aria-label="清理已完成任务"
                onClick={handleClearCompleted}
              >
                <Icons.Trash size={13} className="mr-1 inline" />
                清理已完成
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="size-8 rounded-control p-0 text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] transition-colors"
              aria-label="刷新视图"
              onClick={() => void refresh()}
            >
              <Icons.Refresh size={15} stroke={1.75} />
            </Button>
          </div>
        }
      />

      {/* Planner 专属功能操作栏 */}
      {isPlanner && isPermissionGranted && (
        <div className="mx-[var(--PanelPaddingX)] mb-2 flex flex-col gap-2.5">
          {/* 快速新建任务卡片 */}
          <Card className="flex items-center gap-1.5 rounded-control p-1.5 transition-[border-color,box-shadow] focus-within:border-[var(--color-text-muted)]/25 focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-text-muted)_14%,transparent)]">
            <input
              type="text"
              data-aurona-input="embedded"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddNewTask();
              }}
              placeholder="新建任务或测试项..."
              className="min-w-0 flex-1 bg-transparent px-2.5 text-[12px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
            />

            {/* 官方原生玻璃分类选择器 */}
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
              className="h-7 shrink-0 px-2.5 text-[11px] rounded-control shadow-sm"
            >
              <Icons.Plus size={13} className="mr-0.5" />
              添加
            </Button>
          </Card>

          {/* 筛选与搜索 (两行现代排版) */}
          <div className="flex flex-col gap-2">
            {/* 第一行：状态切换分段按钮 (3 列平分) */}
            <div className="grid grid-cols-3 gap-1 p-0.5 rounded-surface border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/80 shadow-2xs">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={`py-1 text-[11.5px] font-medium rounded-control transition-all cursor-pointer text-center ${
                  statusFilter === "all"
                    ? "bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] shadow-xs font-semibold"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                全部 ({tasks.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("todo")}
                className={`py-1 text-[11.5px] font-medium rounded-control transition-all cursor-pointer text-center ${
                  statusFilter === "todo"
                    ? "bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] shadow-xs font-semibold"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                待办 ({tasks.filter((t) => !t.completed).length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("done")}
                className={`py-1 text-[11.5px] font-medium rounded-control transition-all cursor-pointer text-center ${
                  statusFilter === "done"
                    ? "bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] shadow-xs font-semibold"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                已完成 ({tasks.filter((t) => t.completed).length})
              </button>
            </div>

            {/* 第二行：优先级选择器 + 搜索框 */}
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <Select
                  value={priorityFilter}
                  onChange={(value) => setPriorityFilter(value as "all" | PlannerPriority)}
                  options={[
                    { label: "全部优先级", value: "all" },
                    { label: "高优先级", value: "high" },
                    { label: "普通优先级", value: "normal" },
                    { label: "低优先级", value: "low" },
                  ]}
                  className="h-[28px] w-full min-w-0 text-[11.5px] px-2.5 py-0.5 rounded-control border-[var(--border-subtle)] bg-[var(--material-surface)]"
                />
              </div>
              <div className="flex-1 min-w-0">
                <Input
                  icon={<Icons.Search size={14} />}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索任务..."
                  inputSize="sm"
                  surface="glass"
                  fullWidth
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 核心内卡片容器：统一使用系统内边距 */}
      {isPlanner && plannerSaveError && (
        <div className="mx-[var(--PanelPaddingX)] mb-2 rounded-surface border border-[var(--StatusError)]/30 bg-[var(--StatusError)]/10 px-3 py-2 text-[11px] text-[var(--StatusError)]">
          Planner 保存失败：{plannerSaveError}
        </div>
      )}
      <div className="relative mx-[var(--PanelPaddingX)] mb-2.5 flex min-h-0 flex-1 overflow-hidden rounded-surface border border-[var(--color-border)] bg-[var(--color-surface-2)]/30 shadow-[inset_0_1px_1px_var(--material-inset)]">
        {!isStandalone && !isPermissionGranted ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center animate-in fade-in duration-200">
            <div className="flex size-12 items-center justify-center rounded-control bg-[var(--material-surface)] text-[var(--color-accent)] border border-[var(--border-subtle)] shadow-inner">
              <Icons.ShieldCheck size={26} stroke={1.75} />
            </div>
            <div className="flex flex-col gap-1 max-w-[240px]">
              <span className="text-[13.5px] font-bold text-[var(--color-text-highlight)]">
                需要访问当前文档权限
              </span>
              <p className="text-[11.5px] leading-relaxed text-[var(--color-text-secondary)]">
                “{title}” 需要读取活动编辑器中的内容以生成实时渲染与结构大纲。
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-[200px] mt-2">
              <Button
                size="sm"
                variant="primary"
                className="h-8 text-[12px] font-semibold rounded-control w-full"
                onClick={() => void resolvePermission("editor.current.read", "global")}
              >
                {t("extensions.permissionAllowAlways")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-8 text-[12px] rounded-control w-full"
                onClick={() => void resolvePermission("editor.current.read", "once")}
              >
                {t("extensions.permissionAllowOnce")}
              </Button>
            </div>
          </div>
        ) : viewFailed ? (
          <div className="flex h-full w-full flex-col items-center justify-center px-4 text-center text-xs text-[var(--color-text-muted)]">
            {t("extensions.viewFailed")}
          </div>
        ) : !isStandalone && !activePath ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-control bg-[var(--material-surface)] text-[var(--color-text-muted)]">
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
            <div className="flex size-10 items-center justify-center rounded-control bg-[var(--material-surface)] text-[var(--color-text-muted)]">
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
            accentColor={currentExtensionAccent()}
            fontSize={window.document.documentElement.getAttribute("data-font-size") || "default"}
            fontWeight={
              window.document.documentElement.getAttribute("data-bold-text") === "true"
                ? "bold"
                : "normal"
            }
            renderState={renderState}
            onAction={(actionId, payload) => void runAction(actionId, payload)}
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
