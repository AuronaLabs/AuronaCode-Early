import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { PtyIPC } from "../../Foundation/IPC/PtyCommands";
import "@xterm/xterm/css/xterm.css";
import { StorageManager } from "../../Core/StorageManager";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { ShellProfile } from "../../Core/TerminalService";
import { EventBus } from "../../Core/EventBus";
import { ContextMenu, ContextMenuItem, ContextMenuDivider } from "../../UI/Components/ContextMenu";

interface TerminalViewProps {
  id: string;
  isActive: boolean;
  shellProfile?: ShellProfile;
}

const getModernTheme = (isDark: boolean) => {
  // 现代极客调色板，根据深浅色模式自动适配
  return isDark ? {
    background: "transparent",
    foreground: "#F8F8F2",
    cursor: "#BD93F9",
    cursorAccent: "#282A36",
    selectionBackground: "rgba(189, 147, 249, 0.3)",
    black: "#21222C",
    red: "#FF5555",
    green: "#50FA7B",
    yellow: "#F1FA8C",
    blue: "#BD93F9",
    magenta: "#FF79C6",
    cyan: "#8BE9FD",
    white: "#F8F8F2",
    brightBlack: "#6272A4",
    brightRed: "#FF6E6E",
    brightGreen: "#69FF94",
    brightYellow: "#FFFFA5",
    brightBlue: "#D6ACFF",
    brightMagenta: "#FF92DF",
    brightCyan: "#A4FFFF",
    brightWhite: "#FFFFFF"
  } : {
    background: "transparent",
    foreground: "#383A42",
    cursor: "#526FFF",
    cursorAccent: "#FAFAFA",
    selectionBackground: "rgba(82, 111, 255, 0.2)",
    black: "#383A42",
    red: "#E45649",
    green: "#50A14F",
    yellow: "#C18401",
    blue: "#4078F2",
    magenta: "#A626A4",
    cyan: "#0184BC",
    white: "#FAFAFA",
    brightBlack: "#A0A1A7",
    brightRed: "#E45649",
    brightGreen: "#50A14F",
    brightYellow: "#C18401",
    brightBlue: "#4078F2",
    brightMagenta: "#A626A4",
    brightCyan: "#0184BC",
    brightWhite: "#FFFFFF"
  };
};

import React from "react";
export const TerminalView = React.memo(function TerminalView({ id, isActive, shellProfile }: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const [isSpawned, setIsSpawned] = useState(false);
  const isSpawningRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);

  const [terminalSettings, setTerminalSettings] = useState({
    fontSize: 13,
    cursorBlink: true
  });

  useEffect(() => {
    const loadSettings = async () => {
      const config = await UserConfigStore.get();
      setTerminalSettings({
        fontSize: config.terminalFontSize || parseInt(localStorage.getItem("aurona-terminal-fontsize") || "13"),
        cursorBlink: config.terminalCursorBlink !== false && localStorage.getItem("aurona-terminal-cursorblink") !== "false"
      });
    };
    loadSettings();

    const handleSettingsChange = () => loadSettings();
    return EventBus.on("settings:terminal-changed", handleSettingsChange);
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;

    const isDark = document.documentElement.classList.contains("dark");

    const term = new Terminal({
      cursorBlink: terminalSettings.cursorBlink,
      fontSize: terminalSettings.fontSize,
      fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
      allowTransparency: true,
      theme: getModernTheme(isDark),
      rightClickSelectsWord: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(terminalRef.current);
    
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      term.loadAddon(webglAddon);
      webglAddonRef.current = webglAddon;
    } catch (e) {
      console.warn("WebGL addon could not be loaded, falling back to DOM/Canvas render", e);
    }

    fitAddon.fit();

    term.attachCustomKeyEventHandler((e) => {
      // 修复复制粘贴逻辑：支持 Ctrl+C / Ctrl+V 和 Cmd+C / Cmd+V
      if ((e.ctrlKey || e.metaKey) && e.type === 'keydown') {
        if (e.code === 'KeyC' && term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
          term.clearSelection();
          return false;
        }
        if (e.code === 'KeyV') {
          navigator.clipboard.readText().then(text => {
             PtyIPC.write(id, text).catch(console.error);
          });
          return false;
        }
      }
      return true;
    });

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const onDataDisposable = term.onData((data) => {
      // 过滤掉 xterm.js 自动回复给 PTY 的设备属性查询 (DA) 序列。
      // Windows ConPTY 会错误地将这些内部序列回显到屏幕上，导致出现垃圾字符 [?1;2c。
      const filtered = data.replace(/\x1b\[\??[>0-9;]*[cR]/g, '');
      if (filtered) {
        PtyIPC.write(id, filtered).catch(console.error);
      }
    });

    let resizeTimeout: ReturnType<typeof setTimeout>;
    const onResizeDisposable = term.onResize(({ cols, rows }) => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        PtyIPC.resize(id, rows, cols).catch(console.error);
      }, 100);
    });

    // 监听深浅色模式切换
    const observer = new MutationObserver(() => {
      if (xtermRef.current) {
        const dark = document.documentElement.classList.contains("dark");
        xtermRef.current.options.theme = getModernTheme(dark);
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      clearTimeout(resizeTimeout);
      observer.disconnect();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      term.dispose();
    };
  }, [id, terminalSettings.fontSize, terminalSettings.cursorBlink]); 

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let isMounted = true;

    const setupPty = async () => {
      if (isSpawned || isSpawningRef.current) return;
      isSpawningRef.current = true;
      try {
        const config = await StorageManager.getConfig();
        const cwd = config.lastOpenedPath || ".";
        
        const unlisten = await listen<{ id: string; data: string }>("pty-output", (event) => {
          if (event.payload.id === id && xtermRef.current) {
            const decoded = atob(event.payload.data);
            const arr = new Uint8Array(decoded.length);
            for (let i = 0; i < decoded.length; i++) {
              arr[i] = decoded.charCodeAt(i);
            }
            xtermRef.current.write(arr);
          }
        });
        
        if (!isMounted) {
          unlisten();
          return;
        }
        unlistenFn = unlisten;

        await PtyIPC.spawn(id, cwd, shellProfile?.path);
        if (isMounted) setIsSpawned(true);
      } catch (error) {
        console.error("Failed to spawn PTY", error);
        if (isMounted) xtermRef.current?.write(`\x1b[31m[Aurona PTY Engine] Failed to spawn terminal: ${error}\x1b[0m\r\n`);
      } finally {
        if (isMounted) isSpawningRef.current = false;
      }
    };

    setupPty();

    return () => {
      isMounted = false;
      if (unlistenFn) unlistenFn();
    };
  }, [id, isSpawned, shellProfile]);

  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      const timeoutId = setTimeout(() => {
        try { fitAddonRef.current?.fit(); } catch (e) {}
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [isActive]);

  useEffect(() => {
    if (!terminalRef.current) return;
    const observer = new ResizeObserver(() => {
      if (isActive && fitAddonRef.current) {
         try { fitAddonRef.current.fit(); } catch (e) {}
      }
    });
    observer.observe(terminalRef.current);
    return () => observer.disconnect();
  }, [isActive]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <div 
      className="h-full w-full overflow-hidden relative" 
      onContextMenu={handleContextMenu}
    >
      <style>{`
        .xterm, .xterm-viewport, .xterm-screen, .xterm-text-layer, .xterm-selection-layer {
          user-select: text !important;
          -webkit-user-select: text !important;
        }
        .xterm-viewport::-webkit-scrollbar {
          width: 12px;
          height: 12px;
        }
        .xterm-viewport::-webkit-scrollbar-track {
          background: transparent;
        }
        .xterm-viewport::-webkit-scrollbar-thumb {
          background-color: var(--ColorPanelBorder);
          border-radius: 10px;
          border: 3px solid transparent;
          background-clip: padding-box;
        }
        .xterm-viewport::-webkit-scrollbar-thumb:hover {
          background-color: var(--ColorMuted);
        }
      `}</style>
      <div ref={terminalRef} className="h-full w-full p-2" />
      
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
          <ContextMenuItem
            label="全选"
            onClick={() => {
              xtermRef.current?.selectAll();
              setContextMenu(null);
            }}
          />
          <ContextMenuItem
            label="复制"
            onClick={() => {
              if (xtermRef.current?.hasSelection()) {
                navigator.clipboard.writeText(xtermRef.current.getSelection());
                xtermRef.current.clearSelection();
              }
              setContextMenu(null);
            }}
          />
          <ContextMenuItem
            label="粘贴"
            onClick={() => {
              navigator.clipboard.readText().then(text => {
                PtyIPC.write(id, text).catch(console.error);
              });
              setContextMenu(null);
            }}
          />
          <ContextMenuDivider />
          <ContextMenuItem
            label="清除输出"
            onClick={() => {
              xtermRef.current?.clear();
              setContextMenu(null);
            }}
          />
        </ContextMenu>
      )}
    </div>
  );
});
