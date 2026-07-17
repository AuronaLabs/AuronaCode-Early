import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";

export interface MacMenuActions {
  createFile(): void;
  createFolder(): void;
  openFile(): void;
  openFolder(): void;
  saveFile(): void;
  runActiveFile(): void;
  openChangelog(): void;
  openPerformance(): void;
  openDevtools(): void;
}

export async function setupMacApplicationMenu(actions: MacMenuActions): Promise<void> {
  const appMenu = await Submenu.new({
    text: "Aurona Code",
    items: [
      await PredefinedMenuItem.new({ item: { About: null } }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Services" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Hide" }),
      await PredefinedMenuItem.new({ item: "HideOthers" }),
      await PredefinedMenuItem.new({ item: "ShowAll" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Quit" }),
    ],
  });
  const fileMenu = await Submenu.new({
    text: "文件",
    items: [
      await MenuItem.new({
        text: "新建文件",
        accelerator: "CmdOrControl+N",
        action: actions.createFile,
      }),
      await MenuItem.new({ text: "新建文件夹", action: actions.createFolder }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({ text: "打开文件…", action: actions.openFile }),
      await MenuItem.new({ text: "打开文件夹…", action: actions.openFolder }),
      await MenuItem.new({ text: "保存", accelerator: "CmdOrControl+S", action: actions.saveFile }),
    ],
  });
  const editMenu = await Submenu.new({
    text: "编辑",
    items: [
      await PredefinedMenuItem.new({ item: "Undo" }),
      await PredefinedMenuItem.new({ item: "Redo" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Cut" }),
      await PredefinedMenuItem.new({ item: "Copy" }),
      await PredefinedMenuItem.new({ item: "Paste" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "SelectAll" }),
    ],
  });
  const runMenu = await Submenu.new({
    text: "运行",
    items: [await MenuItem.new({ text: "运行当前文件", action: actions.runActiveFile })],
  });
  const helpMenu = await Submenu.new({
    text: "帮助",
    items: [
      await MenuItem.new({ text: "版本更新记录", action: actions.openChangelog }),
      await MenuItem.new({ text: "性能测试", action: actions.openPerformance }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({ text: "开发者工具", action: actions.openDevtools }),
    ],
  });
  const menu = await Menu.new({ items: [appMenu, fileMenu, editMenu, runMenu, helpMenu] });
  await menu.setAsAppMenu();
}
