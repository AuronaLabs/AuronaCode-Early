import { type CommandContext, CommandRegistry } from "../Extension/CommandRegistry";
import { EditorAdapter } from "../Features/Editor/EditorAdapter";
import { LspClient, type LspFeature } from "../Features/Editor/LspClient";
import { EventBus } from "../Foundation/EventBus";
import { AppLifecycleIPC } from "../Foundation/IPC/AppLifecycleCommands";
import { PlatformService } from "../Foundation/Platform";
import { handleSmartRun } from "../Shared/Constants/RunConfig";
import { SIDEBAR_DEBUG } from "../Shared/Constants/Sidebar";
import { useDebugStore } from "../State/useDebugStore";
import { useEditorStore } from "../State/useEditorStore";
import { useWorkbenchStore } from "../State/useWorkspaceStore";
import { DebugConfigurationService } from "./DebugConfigurationService";
import { DebugService } from "./DebugService";
import { LanguageFeatureService } from "./LanguageFeatureService";
import { OutputService } from "./OutputService";

const context = (): CommandContext => {
  const state = useWorkbenchStore.getState();
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  const activeFilePath = activeTab?.type === "file" ? (activeTab.path ?? null) : null;
  const platform = PlatformService.current();
  const activeElement = document.activeElement;
  return {
    activeFilePath,
    hasActiveEditor: activeFilePath !== null,
    textInputFocused:
      activeElement instanceof HTMLElement &&
      (activeElement.isContentEditable ||
        activeElement.matches("input, textarea, [role='textbox']")),
    platform,
    bottomPanelOpen: state.isBottomPanelOpen,
  };
};

export function registerWorkbenchCommands(): () => void {
  const canDebugActiveFile = (current: CommandContext) => {
    if (!current.activeFilePath) return false;
    const configurations = useDebugStore.getState().configurations;
    if (configurations.length === 0) return /\.pyw?$/i.test(current.activeFilePath);
    return configurations.some(
      (configuration) =>
        DebugConfigurationService.getApplicability(
          configuration,
          current.activeFilePath ?? undefined,
        ).supported,
    );
  };
  const languageFeatureAvailable = (feature: LspFeature) => (current: CommandContext) => {
    if (!current.hasActiveEditor) return false;
    return LspClient.getInstance().supports(
      useEditorStore.getState().editorStatus.language,
      feature,
    );
  };
  const languageFeatureReason = (feature: LspFeature) => (current: CommandContext) => {
    if (!current.hasActiveEditor) return "没有活动编辑器";
    const status = useEditorStore.getState().editorStatus;
    const server = LspClient.getInstance().getState(status.language);
    if (!server) return "当前语言未配置服务器";
    if (server.status !== "running") return `语言服务器状态：${server.status}`;
    return LspClient.getInstance().supports(status.language, feature)
      ? undefined
      : "当前服务器不支持此能力";
  };
  const activeLanguageLocation = (current: CommandContext) => {
    const status = useEditorStore.getState().editorStatus;
    if (!current.activeFilePath) throw new Error("没有活动文件");
    return {
      path: current.activeFilePath,
      language: status.language,
      line: Math.max(0, status.line - 1),
      character: Math.max(0, status.column - 1),
    };
  };
  const disposers = [
    CommandRegistry.setContextProvider(context),
    CommandRegistry.register({
      id: "workbench.action.openFliuno",
      title: "打开 Fliuno",
      category: "工作台",
      keybindings: [{ key: "p", primary: true, shift: true, allowInInput: true }],
      handler: () => EventBus.emit("app:show-fliuno"),
    }),
    CommandRegistry.register({
      id: "workbench.action.files.openFile",
      title: "打开文件…",
      category: "文件",
      keybindings: [{ key: "o", primary: true }],
      handler: () => EventBus.emit("app:open-file"),
    }),
    CommandRegistry.register({
      id: "workbench.action.files.openFolder",
      title: "打开文件夹…",
      category: "文件",
      handler: () => EventBus.emit("app:open-folder"),
    }),
    CommandRegistry.register({
      id: "workbench.action.files.newFile",
      title: "新建文件",
      category: "文件",
      keybindings: [{ key: "n", primary: true }],
      handler: () => EventBus.emit("app:create-file-prompt"),
    }),
    CommandRegistry.register({
      id: "workbench.action.files.newFolder",
      title: "新建文件夹",
      category: "文件",
      handler: () => EventBus.emit("app:create-folder-prompt"),
    }),
    CommandRegistry.register({
      id: "workbench.action.files.save",
      title: "保存活动文件",
      category: "文件",
      keybindings: [{ key: "s", primary: true }],
      canExecute: (current) => current.hasActiveEditor,
      handler: () => EventBus.emit("app:save-file"),
    }),
    CommandRegistry.register({
      id: "workbench.action.debug.start",
      title: "开始调试",
      category: "运行和调试",
      source: "core",
      keybindings: [{ key: "F5" }],
      canExecute: canDebugActiveFile,
      disabledReason: (current) =>
        current.hasActiveEditor ? "当前文件没有可用的调试配置" : "没有活动代码文件",
      handler: async (_args, current) => {
        const workbench = useWorkbenchStore.getState();
        workbench.setActiveSidebar(SIDEBAR_DEBUG);
        const debug = useDebugStore.getState();
        if (debug.state === "paused") {
          await DebugService.request("continue");
          return;
        }
        if (["starting", "running", "stopping"].includes(debug.state)) return;
        await DebugService.initialize(current.activeFilePath ?? undefined);
        const latest = useDebugStore.getState();
        const configuration = latest.configurations.find(
          (item) => item.name === latest.selectedConfiguration,
        );
        if (!configuration) throw new Error("未检测到适用于当前文件的调试配置");
        await DebugService.start(configuration, current.activeFilePath ?? undefined);
      },
    }),
    CommandRegistry.register({
      id: "workbench.action.debug.stop",
      title: "停止调试",
      category: "运行和调试",
      source: "core",
      keybindings: [{ key: "F5", shift: true }],
      canExecute: () => useDebugStore.getState().sessionId !== null,
      disabledReason: () =>
        useDebugStore.getState().sessionId === null ? "当前没有正在运行的调试会话" : undefined,
      handler: () => DebugService.stop(),
    }),
    ...(["undo", "redo", "cut", "copy", "paste", "selectAll"] as const).map((action) =>
      CommandRegistry.register({
        id: `editor.action.${action}`,
        title: {
          undo: "撤销",
          redo: "重做",
          cut: "剪切",
          copy: "复制",
          paste: "粘贴",
          selectAll: "全选",
        }[action],
        category: "编辑",
        canExecute: (current) => current.hasActiveEditor,
        handler: () => EditorAdapter.executeAction(action),
      }),
    ),
    CommandRegistry.register({
      id: "editor.action.goToDefinition",
      title: "转到定义",
      category: "语言服务",
      source: "core",
      keybindings: [{ key: "F12" }],
      canExecute: languageFeatureAvailable("definition"),
      disabledReason: languageFeatureReason("definition"),
      handler: async (_args, current) => {
        const location = activeLanguageLocation(current);
        await LanguageFeatureService.goToDefinition(
          location.path,
          location.language,
          location.line,
          location.character,
        );
      },
    }),
    CommandRegistry.register({
      id: "editor.action.findReferences",
      title: "查找所有引用",
      category: "语言服务",
      source: "core",
      keybindings: [{ key: "F12", shift: true }],
      canExecute: languageFeatureAvailable("references"),
      disabledReason: languageFeatureReason("references"),
      handler: async (_args, current) => {
        const location = activeLanguageLocation(current);
        await LanguageFeatureService.findReferences(
          location.path,
          location.language,
          location.line,
          location.character,
        );
        useWorkbenchStore.getState().setActiveBottomPanel("output");
      },
    }),
    CommandRegistry.register({
      id: "editor.action.formatDocument",
      title: "格式化文档",
      category: "语言服务",
      source: "core",
      keybindings: [{ key: "f", primary: true, shift: true }],
      canExecute: languageFeatureAvailable("formatting"),
      disabledReason: languageFeatureReason("formatting"),
      handler: async (_args, current) => {
        const location = activeLanguageLocation(current);
        await LanguageFeatureService.formatDocument(location.path, location.language);
      },
    }),
    CommandRegistry.register({
      id: "editor.action.rename",
      title: "重命名符号",
      category: "语言服务",
      source: "core",
      keybindings: [{ key: "F2" }],
      canExecute: languageFeatureAvailable("rename"),
      disabledReason: languageFeatureReason("rename"),
      handler: (_args, current) => {
        const location = activeLanguageLocation(current);
        EventBus.emit("language:rename-request", location);
      },
    }),
    CommandRegistry.register({
      id: "editor.action.codeAction",
      title: "显示代码操作",
      category: "语言服务",
      source: "core",
      keybindings: [{ key: ".", primary: true }],
      canExecute: languageFeatureAvailable("codeAction"),
      disabledReason: languageFeatureReason("codeAction"),
      handler: (_args, current) => {
        EventBus.emit("language:code-actions-request", activeLanguageLocation(current));
      },
    }),
    CommandRegistry.register({
      id: "editor.action.documentSymbols",
      title: "显示文档符号",
      category: "语言服务",
      source: "core",
      canExecute: languageFeatureAvailable("documentSymbols"),
      disabledReason: languageFeatureReason("documentSymbols"),
      handler: async (_args, current) => {
        const location = activeLanguageLocation(current);
        const symbols = await LspClient.getInstance().getDocumentSymbols(
          location.language,
          location.path,
        );
        OutputService.append(
          "language-server",
          `Document symbols for ${location.path}\n${JSON.stringify(symbols, null, 2)}`,
        );
        useWorkbenchStore.getState().setActiveBottomPanel("output");
      },
    }),
    CommandRegistry.register({
      id: "workbench.action.languageServer.restart",
      title: "重启当前语言服务器",
      category: "语言服务",
      source: "core",
      canExecute: (current) => current.hasActiveEditor,
      handler: async () => {
        await LspClient.getInstance().restartServer(
          useEditorStore.getState().editorStatus.language,
        );
      },
    }),
    CommandRegistry.register({
      id: "workbench.action.languageServer.stop",
      title: "停止当前语言服务器",
      category: "语言服务",
      source: "core",
      canExecute: (current) => current.hasActiveEditor,
      handler: async () => {
        await LspClient.getInstance().stopServer(useEditorStore.getState().editorStatus.language);
      },
    }),
    CommandRegistry.register({
      id: "workbench.action.languageServer.openLog",
      title: "打开语言服务器输出",
      category: "语言服务",
      source: "core",
      handler: () => useWorkbenchStore.getState().setActiveBottomPanel("output"),
    }),
    CommandRegistry.register({
      id: "workbench.action.togglePanel",
      title: "切换底部面板",
      category: "视图",
      handler: () => useWorkbenchStore.getState().toggleBottomPanel(),
    }),
    CommandRegistry.register({
      id: "workbench.action.terminal.toggleTerminal",
      title: "切换终端",
      category: "终端",
      handler: () => EventBus.emit("app:toggle-terminal"),
    }),
    CommandRegistry.register({
      id: "workbench.action.runActiveFile",
      title: "运行活动文件",
      category: "运行",
      canExecute: (current) => current.activeFilePath !== null,
      handler: (_args, current) => {
        if (current.activeFilePath) return handleSmartRun(current.activeFilePath);
      },
    }),
    CommandRegistry.register({
      id: "workbench.action.openSettings",
      title: "打开设置",
      category: "工作台",
      handler: () =>
        useWorkbenchStore.getState().openTab({ id: "settings", type: "settings", title: "设置" }),
    }),
    CommandRegistry.register({
      id: "workbench.action.openChangelog",
      title: "打开更新记录",
      category: "帮助",
      handler: () =>
        useWorkbenchStore
          .getState()
          .openTab({ id: "changelog", type: "changelog", title: "更新记录" }),
    }),
    CommandRegistry.register({
      id: "workbench.action.openPerformance",
      title: "打开性能测试",
      category: "帮助",
      handler: () =>
        useWorkbenchStore
          .getState()
          .openTab({ id: "performance", type: "performance", title: "性能测试" }),
    }),
    CommandRegistry.register({
      id: "workbench.action.openAbout",
      title: "关于 Aurona Code",
      category: "帮助",
      handler: () =>
        useWorkbenchStore
          .getState()
          .openTab({ id: "about", type: "about", title: "关于 Aurona Code" }),
    }),
    CommandRegistry.register({
      id: "workbench.action.openDevtools",
      title: "打开开发者工具",
      category: "开发者",
      handler: () => AppLifecycleIPC.openDevtools(),
    }),
    CommandRegistry.register({
      id: "workbench.action.reloadWindow",
      title: "重新加载窗口",
      category: "开发者",
      handler: () => window.location.reload(),
    }),
  ];
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
