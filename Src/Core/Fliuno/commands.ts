import { CommandRegistry } from "../../Extension/CommandRegistry";
import { EventBus } from "../../Foundation/EventBus";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { SIDEBAR_FLIUNO } from "../../Shared/Constants/Sidebar";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";

export function registerFliunoCommands(): () => void {
  const disposers = [
    CommandRegistry.register({
      id: "workbench.action.openFliuno",
      title: "打开 Fliuno",
      titleKey: "commands.openFliuno",
      category: "工作台",
      categoryKey: "commandCategories.workbench",
      keybindings: [{ key: "p", primary: true, shift: true, allowInInput: true }],
      handler: () => EventBus.emit("app:show-fliuno"),
    }),
    CommandRegistry.register({
      id: "workbench.action.openFliunoWorkspace",
      title: "打开 Fliuno 工作区",
      titleKey: "commands.openFliunoWorkspace",
      category: "工作台",
      categoryKey: "commandCategories.workbench",
      handler: () => {
        const workbench = useWorkbenchStore.getState();
        // 侧边栏模式下再次点击 = 收起（与其它 Activity 图标的 toggle 行为一致）
        if (workbench.activeSidebar === SIDEBAR_FLIUNO) {
          workbench.setActiveSidebar(null);
          return;
        }
        // 入口分流：默认在左侧侧边栏展示，可在设置中切换为编辑区标签页
        void UserConfigStore.get().then((config) => {
          if ((config.fliuno?.openMode ?? "sidebar") === "editorTab") {
            useWorkbenchStore.getState().openTab({
              id: "fliuno",
              type: "fliuno",
              title: "Fliuno 工作区",
              titleKey: "fliuno.workspaceTitle",
            });
          } else {
            useWorkbenchStore.getState().setActiveSidebar(SIDEBAR_FLIUNO);
          }
        });
      },
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
