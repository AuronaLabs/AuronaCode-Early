import { useEffect, useState } from "react";
import { CommandRegistry } from "../../Extension/CommandRegistry";
import { desktopApp, desktopWindow } from "../../Foundation/Desktop";
import { EventBus } from "../../Foundation/EventBus";
import { useLocale } from "../../Foundation/I18n";
import { isRunnable } from "../../Shared/Constants/RunConfig";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import {
  MenubarContent,
  MenubarDivider,
  MenubarItem,
  MenubarMenu,
  MenubarRoot,
  MenubarTrigger,
} from "../../UI/Components/Menubar";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";

const appWindow = desktopWindow;
const runCommand = (id: string) => void CommandRegistry.execute(id);

export function TitleBar() {
  const { t } = useLocale();
  const [isMaximized, setIsMaximized] = useState(false);
  const [hasUpdate, setHasUpdate] = useState(false);
  const isTerminalOpen = useWorkbenchStore((state) => state.isBottomPanelOpen);
  const activeFilePath = useWorkbenchStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab?.type === "file" ? (tab.path ?? null) : null;
  });

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);

    const unlisten = appWindow.onResized(async () => {
      setIsMaximized(await appWindow.isMaximized());
    });

    const unsubUpdate = EventBus.on("app:update-available", () => {
      setHasUpdate(true);
    });

    return () => {
      unlisten.then((dispose) => dispose());
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
      className="flex h-[var(--TitleBarHeight)] shrink-0 select-none items-center justify-between bg-transparent text-[var(--color-text-primary)] text-[13px] relative z-30"
    >
      <div className="flex h-full items-center pl-4 gap-3 min-w-0">
        <div
          className="pointer-events-none text-[15px] text-[var(--color-text-highlight)] flex items-center shrink-0"
          style={{ fontFamily: "'Righteous', sans-serif", fontWeight: 400, letterSpacing: "0.8px" }}
        >
          Aurona Code
        </div>
        <MenubarRoot className="flex h-full items-center space-x-0.5 min-w-0">
          <MenubarMenu>
            <MenubarTrigger>{t("menu.file")}</MenubarTrigger>
            <MenubarContent>
              <MenubarItem
                label={t("menu.newFile")}
                rightElement="Ctrl+N"
                onSelect={() => runCommand("workbench.action.files.newFile")}
              />
              <MenubarItem
                label={t("menu.newFolder")}
                onSelect={() => runCommand("workbench.action.files.newFolder")}
              />
              <MenubarDivider />
              <MenubarItem
                label={t("menu.openFile")}
                onSelect={() => runCommand("workbench.action.files.openFile")}
              />
              <MenubarItem
                label={t("menu.openFolder")}
                onSelect={() => runCommand("workbench.action.files.openFolder")}
              />
              <MenubarItem
                label={t("menu.save")}
                rightElement="Ctrl+S"
                onSelect={() => runCommand("workbench.action.files.save")}
              />
              <MenubarDivider />
              <MenubarItem
                label={t("menu.exit")}
                variant="danger"
                onSelect={() => appWindow.close()}
              />
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>{t("menu.edit")}</MenubarTrigger>
            <MenubarContent>
              <MenubarItem
                label={t("menu.undo")}
                onSelect={() => runCommand("editor.action.undo")}
              />
              <MenubarItem
                label={t("menu.redo")}
                onSelect={() => runCommand("editor.action.redo")}
              />
              <MenubarDivider />
              <MenubarItem label={t("menu.cut")} onSelect={() => runCommand("editor.action.cut")} />
              <MenubarItem
                label={t("menu.copy")}
                onSelect={() => runCommand("editor.action.copy")}
              />
              <MenubarItem
                label={t("menu.paste")}
                onSelect={() => runCommand("editor.action.paste")}
              />
              <MenubarDivider />
              <MenubarItem
                label={t("menu.selectAll")}
                onSelect={() => runCommand("editor.action.selectAll")}
              />
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>{t("menu.run")}</MenubarTrigger>
            <MenubarContent>
              <MenubarItem
                label={t("menu.runActive")}
                onSelect={() => runCommand("workbench.action.runActiveFile")}
              />
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>{t("menu.help")}</MenubarTrigger>
            <MenubarContent>
              <MenubarItem
                label={t("menu.forceRestart")}
                onSelect={async () => {
                  try {
                    if (import.meta.env.DEV) {
                      // Hide current main window
                      await desktopWindow.hide();
                      // Re-create splashscreen window
                      desktopWindow.createSplash();
                      // Wait a fraction of a second for the IPC command to reach Rust before destroying the JS context
                      setTimeout(() => {
                        window.location.reload();
                      }, 100);
                    } else {
                      await desktopApp.relaunch();
                    }
                  } catch (e) {
                    console.error("重启失败", e);
                  }
                }}
              />
              <MenubarItem
                label={t("menu.performanceTest")}
                onSelect={() => runCommand("workbench.action.openPerformance")}
              />
              <MenubarItem
                label={t("menu.devtools")}
                onSelect={() => {
                  void CommandRegistry.execute("workbench.action.openDevtools").then((result) => {
                    if (result.error) {
                      EventBus.emit("app:toast", {
                        type: "warning",
                        message: result.error.message,
                      });
                    }
                  });
                }}
              />
              <MenubarDivider />
              <MenubarItem
                label={t("menu.changelog")}
                onSelect={() => runCommand("workbench.action.openChangelog")}
              />
              <MenubarItem
                label={t("menu.about")}
                onSelect={() => runCommand("workbench.action.openAbout")}
              />
            </MenubarContent>
          </MenubarMenu>
        </MenubarRoot>
      </div>

      <div className="flex h-full items-center pr-3 gap-2 shrink-0">
        <Tooltip content={t("fliuno.titleBarTooltip")} delay={300} placement="bottom">
          <button
            type="button"
            className="mr-2 flex h-[26px] cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--material-surface)] px-2.5 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
            onClick={() => runCommand("workbench.action.openFliuno")}
          >
            <Icons.Search size={14} stroke={1.8} />
            Fliuno
          </button>
        </Tooltip>

        {activeFilePath && isRunnable(activeFilePath) && (
          <Tooltip content={t("titleBar.runActiveFile")} delay={300} placement="bottom">
            <button
              type="button"
              className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--material-interactive-hover)] text-[var(--color-text-highlight)] transition-colors mr-2"
              onClick={() => runCommand("workbench.action.runActiveFile")}
            >
              <Icons.Play size={16} stroke={2} />
            </button>
          </Tooltip>
        )}

        {hasUpdate && (
          <Tooltip content={t("titleBar.updateAvailable")} delay={300} placement="bottom">
            <button
              type="button"
              className="relative mr-1 flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-lg text-[var(--color-accent)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-accent-hover)]"
              onClick={() => EventBus.emit("app:show-update-modal")}
            >
              <Icons.Download size={16} stroke={2} />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse border border-white dark:border-zinc-900"></span>
            </button>
          </Tooltip>
        )}

        <Tooltip content={t("titleBar.togglePanel")} delay={500} placement="bottom">
          <button
            type="button"
            className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] transition-colors"
            onClick={() => runCommand("workbench.action.togglePanel")}
          >
            {isTerminalOpen ? (
              <Icons.BottomPanelFilled size={16} stroke={2} />
            ) : (
              <Icons.BottomPanel size={16} stroke={2} />
            )}
          </button>
        </Tooltip>
        <div className="w-px h-[14px] bg-[var(--border-subtle)] mx-0.5" />
        <Tooltip content={t("titleBar.minimize")} delay={500} placement="bottom">
          <button
            type="button"
            className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] transition-colors"
            onClick={() => appWindow.minimize()}
          >
            <Icons.Minimize size={15} stroke={2} />
          </button>
        </Tooltip>
        <Tooltip
          content={isMaximized ? t("titleBar.restore") : t("titleBar.maximize")}
          delay={500}
          placement="bottom"
        >
          <button
            type="button"
            className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] transition-colors"
            onClick={toggleMaximize}
          >
            {isMaximized ? (
              <Icons.Restore size={14} stroke={2} />
            ) : (
              <Icons.Maximize size={14} stroke={2} />
            )}
          </button>
        </Tooltip>
        <Tooltip content={t("titleBar.close")} delay={500} placement="bottom">
          <button
            type="button"
            className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--DiagError)] hover:text-white transition-colors"
            onClick={() => appWindow.close()}
          >
            <Icons.Close size={15} stroke={2} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
