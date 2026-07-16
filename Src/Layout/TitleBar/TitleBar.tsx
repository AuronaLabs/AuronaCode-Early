import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { useEffect, useState } from "react";
import { EventBus } from "../../Foundation/EventBus";
import { handleSmartRun, isRunnable } from "../../Shared/Constants/RunConfig";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";
import {
  MenubarRoot,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarDivider,
} from "../../UI/Components/Menubar";

const appWindow = getCurrentWindow();

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);

    const unlisten = appWindow.onResized(async () => {
      setIsMaximized(await appWindow.isMaximized());
    });

    const unsubTerminal = EventBus.on("app:terminal-state-changed", (isOpen: boolean) =>
      setIsTerminalOpen(isOpen),
    );
    const unsubFile = EventBus.on("app:active-file-changed", (path: string | null) =>
      setActiveFilePath(path),
    );
    const unsubUpdate = EventBus.on("app:update-available", () => {
      setHasUpdate(true);
    });

    return () => {
      unlisten.then((dispose) => dispose());
      unsubTerminal();
      unsubFile();
      unsubUpdate();
    };
  }, []);

  const toggleMaximize = async () => {
    if (isMaximized) await appWindow.unmaximize();
    else await appWindow.maximize();
  };

  return (
    <div
      data-tauri-drag-region
      className="flex h-[var(--TitleBarHeight)] shrink-0 select-none items-center justify-between bg-transparent text-[var(--TextPrimary)] text-[13px] relative z-30"
    >
      <div className="flex h-full items-center pl-4 gap-3 min-w-0">
        <div
          className="pointer-events-none text-[15px] text-[var(--TextHighlight)] flex items-center shrink-0"
          style={{ fontFamily: "'Righteous', sans-serif", fontWeight: 400, letterSpacing: "0.8px" }}
        >
          Aurona Code
        </div>

        <MenubarRoot className="flex h-full items-center space-x-0.5 min-w-0">
          <MenubarMenu>
            <MenubarTrigger>文件</MenubarTrigger>
            <MenubarContent>
              <MenubarItem
                label="新建文件"
                rightElement="Ctrl+N"
                onSelect={() => EventBus.emit("app:create-file-prompt")}
              />
              <MenubarItem
                label="新建文件夹"
                onSelect={() => EventBus.emit("app:create-folder-prompt")}
              />
              <MenubarDivider />
              <MenubarItem label="打开文件..." onSelect={() => EventBus.emit("app:open-file")} />
              <MenubarItem
                label="打开文件夹..."
                onSelect={() => EventBus.emit("app:open-folder")}
              />
              <MenubarItem
                label="保存"
                rightElement="Ctrl+S"
                onSelect={() => EventBus.emit("app:save-file")}
              />
              <MenubarDivider />
              <MenubarItem label="退出" variant="danger" onSelect={() => appWindow.close()} />
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>编辑</MenubarTrigger>
            <MenubarContent>
              <MenubarItem label="撤销" onSelect={() => EventBus.emit("editor:action", "undo")} />
              <MenubarItem label="重做" onSelect={() => EventBus.emit("editor:action", "redo")} />
              <MenubarDivider />
              <MenubarItem label="剪切" onSelect={() => EventBus.emit("editor:action", "cut")} />
              <MenubarItem label="复制" onSelect={() => EventBus.emit("editor:action", "copy")} />
              <MenubarItem label="粘贴" onSelect={() => EventBus.emit("editor:action", "paste")} />
              <MenubarDivider />
              <MenubarItem
                label="全选"
                onSelect={() => EventBus.emit("editor:action", "selectAll")}
              />
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>运行</MenubarTrigger>
            <MenubarContent>
              <MenubarItem
                label="运行"
                onSelect={() => {
                  if (activeFilePath && isRunnable(activeFilePath)) {
                    if (!isTerminalOpen) {
                      EventBus.emit("app:toggle-terminal", true);
                    }
                    setTimeout(() => {
                      handleSmartRun(activeFilePath);
                    }, 50);
                  }
                }}
              />
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>帮助</MenubarTrigger>
            <MenubarContent>
              <MenubarItem
                label="强制重启"
                onSelect={async () => {
                  try {
                    // @ts-expect-error
                    if (import.meta.env?.DEV || (import.meta as any).env?.DEV) {
                      // Hide current main window
                      await getCurrentWindow().hide();
                      // Re-create splashscreen window
                      new WebviewWindow("splashscreen", {
                        url: "/splash.html",
                        title: "Aurona Code Initializing",
                        width: 500,
                        height: 300,
                        decorations: false,
                        transparent: true,
                        resizable: false,
                        alwaysOnTop: true,
                        center: true,
                        skipTaskbar: true,
                      });
                      // Wait a fraction of a second for the IPC command to reach Rust before destroying the JS context
                      setTimeout(() => {
                        window.location.reload();
                      }, 100);
                    } else {
                      await relaunch();
                    }
                  } catch (e) {
                    console.error("重启失败", e);
                  }
                }}
              />
              <MenubarItem
                label="性能测试"
                onSelect={() =>
                  EventBus.emit("app:open-tab", {
                    id: "performance",
                    type: "performance",
                    title: "性能测试",
                  })
                }
              />
              <MenubarItem
                label="开发者工具"
                onSelect={() => {
                  invoke("open_devtools").catch((err) => {
                    EventBus.emit("app:toast", { type: "warning", message: err });
                  });
                }}
              />
              <MenubarDivider />
              <MenubarItem
                label="版本更新记录"
                onSelect={() =>
                  EventBus.emit("app:open-tab", {
                    id: "changelog",
                    type: "changelog",
                    title: "更新记录",
                  })
                }
              />
              <MenubarItem
                label="关于 Aurona Code"
                onSelect={() =>
                  EventBus.emit("app:open-tab", {
                    id: "about",
                    type: "about",
                    title: "关于 Aurona Code",
                  })
                }
              />
            </MenubarContent>
          </MenubarMenu>
        </MenubarRoot>
      </div>

      <div className="flex h-full items-center pr-3 gap-2 shrink-0">
        {activeFilePath && isRunnable(activeFilePath) && (
          <Tooltip content="运行当前文件" delay={300} placement="bottom">
            <button
              className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--GlassHover)] text-[var(--TextHighlight)] transition-colors mr-2"
              onClick={() => handleSmartRun(activeFilePath)}
            >
              <Icons.Play size={16} stroke={2} />
            </button>
          </Tooltip>
        )}

        {hasUpdate && (
          <Tooltip content="发现新版本" delay={300} placement="bottom">
            <button
              className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--GlassHover)] text-blue-500 hover:text-blue-400 transition-colors mr-1 relative"
              onClick={() => EventBus.emit("app:show-update-modal")}
            >
              <Icons.Download size={16} stroke={2} />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse border border-white dark:border-zinc-900"></span>
            </button>
          </Tooltip>
        )}

        <Tooltip content="切换底侧面板" delay={500} placement="bottom">
          <button
            className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--GlassHover)] hover:text-[var(--TextHighlight)] transition-colors"
            onClick={() => EventBus.emit("app:toggle-terminal")}
          >
            {isTerminalOpen ? (
              <Icons.BottomPanelFilled size={16} stroke={2} />
            ) : (
              <Icons.BottomPanel size={16} stroke={2} />
            )}
          </button>
        </Tooltip>
        <div className="w-px h-[14px] bg-[var(--GlassBorder)] mx-0.5" />
        <Tooltip content="最小化" delay={500} placement="bottom">
          <button
            className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--GlassHover)] hover:text-[var(--TextHighlight)] transition-colors"
            onClick={() => appWindow.minimize()}
          >
            <Icons.Minimize size={15} stroke={2} />
          </button>
        </Tooltip>
        <Tooltip content={isMaximized ? "向下还原" : "最大化"} delay={500} placement="bottom">
          <button
            className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--GlassHover)] hover:text-[var(--TextHighlight)] transition-colors"
            onClick={toggleMaximize}
          >
            {isMaximized ? (
              <Icons.Restore size={14} stroke={2} />
            ) : (
              <Icons.Maximize size={14} stroke={2} />
            )}
          </button>
        </Tooltip>
        <Tooltip content="关闭" delay={500} placement="bottom">
          <button
            className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-lg hover:bg-red-500 hover:text-white transition-colors"
            onClick={() => appWindow.close()}
          >
            <Icons.Close size={15} stroke={2} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
