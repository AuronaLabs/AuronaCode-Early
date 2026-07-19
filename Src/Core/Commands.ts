import { type CommandContext, CommandRegistry } from "../Extension/CommandRegistry";
import { EditorAdapter } from "../Features/Editor/EditorAdapter";
import { invokeDesktop } from "../Foundation/Desktop";
import { EventBus } from "../Foundation/EventBus";
import { handleSmartRun } from "../Shared/Constants/RunConfig";
import { useWorkbenchStore } from "../State/useWorkspaceStore";

const context = (): CommandContext => {
  const state = useWorkbenchStore.getState();
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  const activeFilePath = activeTab?.type === "file" ? (activeTab.path ?? null) : null;
  const userAgent = navigator.userAgent;
  const platform = userAgent.includes("Mac")
    ? "macos"
    : userAgent.includes("Linux")
      ? "linux"
      : "windows";
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
      handler: () => invokeDesktop("open_devtools"),
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
