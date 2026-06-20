import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EventBus } from "../../Core/EventBus";
import { Icons } from "../../UI/Icons/IconManager";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { TerminalManager } from "../../Core/TerminalService";

type MenuName = "文件" | "编辑" | "帮助";

export function TitleBar() {
  const appWindow = getCurrentWindow();
  const [activeMenu, setActiveMenu] = useState<MenuName | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);

    const unlisten = appWindow.onResized(async () => {
      setIsMaximized(await appWindow.isMaximized());
    });

    const unsubTerminal = EventBus.on("app:terminal-state-changed", (isOpen: boolean) => setIsTerminalOpen(isOpen));
    const unsubFile = EventBus.on("app:active-file-changed", (path: string | null) => setActiveFilePath(path));

    return () => {
      unlisten.then((dispose) => dispose());
      unsubTerminal();
      unsubFile();
    };
  }, [appWindow]);

  const toggleMaximize = async () => {
    if (isMaximized) await appWindow.unmaximize();
    else await appWindow.maximize();
  };

  const menuItemClass = "flex w-full cursor-pointer items-center justify-between gap-8 rounded px-3 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10 text-[var(--ColorText)] hover:text-[var(--ColorTextHighlight)]";

  return (
    <div
      data-tauri-drag-region
      className="flex h-[var(--TitleBarHeight)] shrink-0 select-none items-center justify-between bg-transparent text-[var(--ColorTitleBarText)] text-[13px] relative z-30"
    >
      <div className="flex h-full items-center pl-4 gap-3 min-w-0">
        <div
          className="pointer-events-none text-[16px] text-[var(--ColorTextHighlight)] flex items-center shrink-0"
          style={{ fontFamily: "'Righteous', sans-serif", fontWeight: 400, letterSpacing: "0.5px" }}
        >
          Aurona Code
        </div>

        <div className="flex h-full items-center space-x-0.5 min-w-0">
          {(["文件", "编辑", "帮助"] as MenuName[]).map((menu) => (
            <div key={menu} className="relative h-full flex items-center">
              <div
                className={`flex h-[26px] cursor-pointer items-center rounded-md px-2.5 hover:bg-black/5 dark:hover:bg-white/10 hover:text-[var(--ColorTextHighlight)] transition-colors relative z-50 ${
                  activeMenu === menu ? "bg-black/5 dark:bg-white/10 text-[var(--ColorTextHighlight)]" : ""
                }`}
                onClick={() => setActiveMenu(activeMenu === menu ? null : menu)}
                onMouseEnter={() => {
                  if (activeMenu && activeMenu !== menu) setActiveMenu(menu);
                }}
              >
                {menu}
              </div>

              {activeMenu === menu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setActiveMenu(null)} />
                  <div className="absolute top-[32px] left-0 w-52 rounded-lg border border-[var(--ColorPanelBorder)] bg-[var(--ColorTitleBar)] p-1 shadow-lg z-50 text-[12px]">
                    {menu === "文件" && (
                      <>
                        <button
                          className={menuItemClass}
                          onClick={() => {
                            setActiveMenu(null);
                            EventBus.emit("app:open-file");
                          }}
                        >
                          <span>打开文件...</span>
                        </button>
                        <button
                          className={menuItemClass}
                          onClick={() => {
                            setActiveMenu(null);
                            EventBus.emit("app:open-folder");
                          }}
                        >
                          <span>打开文件夹...</span>
                        </button>
                        <button
                          className={menuItemClass}
                          onClick={() => {
                            setActiveMenu(null);
                            EventBus.emit("app:save-file");
                          }}
                        >
                          <span>保存</span>
                          <span className="text-[var(--ColorMuted)]">Ctrl+S</span>
                        </button>
                        <div className="my-1 h-px w-full bg-[var(--ColorPanelBorder)]" />
                        <button className={`${menuItemClass} hover:bg-red-500/10 hover:text-red-600`} onClick={() => appWindow.close()}>
                          <span>退出</span>
                        </button>
                      </>
                    )}

                    {menu === "编辑" && (
                      <>
                        <button className={menuItemClass} onClick={() => { setActiveMenu(null); EventBus.emit("editor:action", "undo"); }}>
                          <span>撤销</span>
                        </button>
                        <button className={menuItemClass} onClick={() => { setActiveMenu(null); EventBus.emit("editor:action", "redo"); }}>
                          <span>重做</span>
                        </button>
                        <div className="my-1 h-px w-full bg-[var(--ColorPanelBorder)]" />
                        <button className={menuItemClass} onClick={() => { setActiveMenu(null); EventBus.emit("editor:action", "cut"); }}>
                          <span>剪切</span>
                        </button>
                        <button className={menuItemClass} onClick={() => { setActiveMenu(null); EventBus.emit("editor:action", "copy"); }}>
                          <span>复制</span>
                        </button>
                        <button className={menuItemClass} onClick={() => { setActiveMenu(null); EventBus.emit("editor:action", "paste"); }}>
                          <span>粘贴</span>
                        </button>
                        <div className="my-1 h-px w-full bg-[var(--ColorPanelBorder)]" />
                        <button className={menuItemClass} onClick={() => { setActiveMenu(null); EventBus.emit("editor:action", "selectAll"); }}>
                          <span>全选</span>
                        </button>
                      </>
                    )}

                    {menu === "帮助" && (
                      <>
                        <button
                          className={menuItemClass}
                          onClick={() => {
                            setActiveMenu(null);
                            EventBus.emit("app:open-tab", { id: "changelog", type: "changelog", title: "更新记录" });
                          }}
                        >
                          <span>版本更新记录</span>
                        </button>
                        <button
                          className={menuItemClass}
                          onClick={() => {
                            setActiveMenu(null);
                            EventBus.emit("app:open-tab", { id: "about", type: "about", title: "关于 Aurona Code" });
                          }}
                        >
                          <span>关于 Aurona Code</span>
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex h-full items-center pr-3 gap-2 shrink-0">
        {activeFilePath && isRunnable(activeFilePath) && (
          <Tooltip content="运行当前文件" delay={300}>
            <button
              className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-md hover:bg-black/10 dark:hover:bg-white/10 text-[var(--ColorTextHighlight)] transition-colors mr-2"
              onClick={() => handleSmartRun(activeFilePath)}
            >
              <Icons.Play size={16} stroke={2} />
            </button>
          </Tooltip>
        )}
        <Tooltip content="切换底侧面板" delay={500}>
          <button
            className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-md hover:bg-black/10 dark:hover:bg-white/10 hover:text-[var(--ColorTextHighlight)] transition-colors"
            onClick={() => EventBus.emit("app:toggle-terminal")}
          >
            {isTerminalOpen ? <Icons.BottomPanelFilled size={16} stroke={2} /> : <Icons.BottomPanel size={16} stroke={2} />}
          </button>
        </Tooltip>
        <div className="w-px h-[14px] bg-[var(--ColorPanelBorder)] mx-0.5" />
        <Tooltip content="最小化" delay={500}>
          <button
            className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-md hover:bg-black/10 dark:hover:bg-white/10 hover:text-[var(--ColorTextHighlight)] transition-colors"
            onClick={() => appWindow.minimize()}
          >
            <Icons.Minimize size={15} stroke={2} />
          </button>
        </Tooltip>
        <Tooltip content={isMaximized ? "向下还原" : "最大化"} delay={500}>
          <button
            className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-md hover:bg-black/10 dark:hover:bg-white/10 hover:text-[var(--ColorTextHighlight)] transition-colors"
            onClick={toggleMaximize}
          >
            {isMaximized ? <Icons.Restore size={14} stroke={2} /> : <Icons.Maximize size={14} stroke={2} />}
          </button>
        </Tooltip>
        <Tooltip content="关闭" delay={500}>
          <button
            className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-md hover:bg-red-500 hover:text-white transition-colors"
            onClick={() => appWindow.close()}
          >
            <Icons.Close size={15} stroke={2} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function isRunnable(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase();
  return ['js', 'ts', 'py', 'rs', 'go'].includes(ext || '');
}

function handleSmartRun(path: string) {
  const ext = path.split('.').pop()?.toLowerCase();
  let cmd = '';
  // Since we might be on Windows, wrap path in quotes
  const safePath = `"${path}"`;
  
  switch(ext) {
    case 'js': cmd = `node ${safePath}`; break;
    case 'ts': cmd = `ts-node ${safePath}`; break;
    case 'py': cmd = `python ${safePath}`; break;
    case 'go': cmd = `go run ${safePath}`; break;
    case 'rs': cmd = `rustc ${safePath} -o "temp.exe" ; if ($?) { .\\temp.exe }`; break;
  }
  
  if (cmd) {
    TerminalManager.executeCommand(null, cmd);
  }
}
