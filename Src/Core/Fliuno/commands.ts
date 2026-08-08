import { CommandRegistry } from "../../Extension/CommandRegistry";
import { EventBus } from "../../Foundation/EventBus";
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
      handler: () =>
        useWorkbenchStore.getState().openTab({
          id: "fliuno",
          type: "fliuno",
          title: "Fliuno 工作区",
          titleKey: "fliuno.workspaceTitle",
        }),
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
