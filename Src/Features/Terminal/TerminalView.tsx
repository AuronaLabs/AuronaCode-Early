import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
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

export function TerminalView({ id, isActive, shellProfile }: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isSpawned, setIsSpawned] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);
  const isInitializingRef = useRef(true);

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

    const handleSettingsChange = () => {
      loadSettings();
    };
    return EventBus.on("settings:terminal-changed", handleSettingsChange);
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;

    const getTerminalTheme = () => {
      const computedStyle = getComputedStyle(document.body);
      const foregroundColor = computedStyle.getPropertyValue("--ColorTextHighlight").trim() || "#cccccc";
      const cursorColor = computedStyle.getPropertyValue("--ColorAccent").trim() || "#007acc";
      const backgroundColor = computedStyle.getPropertyValue("--ColorEditor").trim() || "#1e1e1e";
      const isDark = document.documentElement.classList.contains("dark");

      const ansiColors = isDark 
        ? {
            red: '#cd3131', brightRed: '#f14c4c',
            green: '#0DBC79', brightGreen: '#23d18b',
            yellow: '#e5e510', brightYellow: '#f5f543',
            blue: '#2472c8', brightBlue: '#3b8eea',
            magenta: '#bc3fbc', brightMagenta: '#d670d6',
            cyan: '#11a8cd', brightCyan: '#29b8db',
            white: '#e5e5e5', brightWhite: '#e5e5e5',
          }
        : {
            red: '#cd3131', brightRed: '#cd3131',
            green: '#008000', brightGreen: '#14ce14',
            yellow: '#949800', brightYellow: '#b5ba00',
            blue: '#0451a5', brightBlue: '#0451a5',
            magenta: '#bc05bc', brightMagenta: '#bc05bc',
            cyan: '#0598bc', brightCyan: '#0598bc',
            white: '#555555', brightWhite: '#a5a5a5',
          };

      return {
        background: backgroundColor,
        foreground: foregroundColor,
        cursor: cursorColor,
        cursorAccent: backgroundColor,
        black: backgroundColor,
        ...ansiColors
      };
    };

    const term = new Terminal({
      cursorBlink: terminalSettings.cursorBlink,
      fontSize: terminalSettings.fontSize,
      allowTransparency: true,
      fontFamily: "Consolas, 'Courier New', monospace",
      theme: {
        ...getTerminalTheme(),
        background: "transparent",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(terminalRef.current);
    fitAddon.fit();

    term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && e.type === 'keydown') {
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

    const onKeyDisposable = term.onKey(() => {
      isInitializingRef.current = false;
    });

    const onDataDisposable = term.onData((data) => {
      // Robust DA response suppression without timeout.
      // We strip out typical terminal report sequences until the user types something.
      if (isInitializingRef.current) {
        // Primary DA, Secondary DA, and Cursor Position Reports
        data = data.replace(/\x1b\[\??[>0-9;]*[cR]/g, '');
        // OSC color/palette responses
        data = data.replace(/\x1b\][0-9;]*;.*?(?:\x07|\x1b\\)/g, '');
        
        if (data.length === 0) {
          return; // Fully suppressed
        }
      }
      PtyIPC.write(id, data).catch(console.error);
    });

    const onResizeDisposable = term.onResize(({ cols, rows }) => {
      PtyIPC.resize(id, rows, cols).catch(console.error);
    });

    return () => {
      onKeyDisposable.dispose();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      term.dispose();
    };
  }, [id, terminalSettings.fontSize, terminalSettings.cursorBlink]); // Re-create terminal when settings change significantly since xterm.js doesn't nicely update some things dynamically, or we can just apply dynamically.

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupPty = async () => {
      if (isSpawned) return;
      try {
        const config = await StorageManager.getConfig();
        const cwd = config.lastOpenedPath || ".";
        
        // Listen for output before spawning to ensure we don't miss anything
        unlisten = await listen<{ id: string; data: number[] }>("pty-output", (event) => {
          if (event.payload.id === id && xtermRef.current) {
            const arr = new Uint8Array(event.payload.data);
            xtermRef.current.write(arr);
          }
        });

        await PtyIPC.spawn(id, cwd, shellProfile?.path);
        setIsSpawned(true);
      } catch (error) {
        console.error("Failed to spawn PTY", error);
        xtermRef.current?.write(`\x1b[31mFailed to spawn terminal: ${error}\x1b[0m\r\n`);
      }
    };

    setupPty();

    return () => {
      if (unlisten) unlisten();
    };
  }, [id, isSpawned]);

  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      // Need a slight delay to allow container layout to settle before fitting
      const timeoutId = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
        } catch (e) {
            // Ignore fit errors on resize
        }
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [isActive]);

  useEffect(() => {
    if (!terminalRef.current) return;
    const observer = new ResizeObserver(() => {
      if (isActive && fitAddonRef.current) {
         try {
            fitAddonRef.current.fit();
         } catch (e) {
             // Ignore
         }
      }
    });
    observer.observe(terminalRef.current);
    return () => observer.disconnect();
  }, [isActive]);

  useEffect(() => {
    // Attempt to observe theme changes on the html or body element to dynamically update xterm colors
    const observer = new MutationObserver(() => {
      if (xtermRef.current) {
        const computedStyle = getComputedStyle(document.body);
        const foregroundColor = computedStyle.getPropertyValue("--ColorTextHighlight").trim() || "#cccccc";
        const cursorColor = computedStyle.getPropertyValue("--ColorAccent").trim() || "#007acc";
        const backgroundColor = computedStyle.getPropertyValue("--ColorEditor").trim() || "#1e1e1e";
        const isDark = document.documentElement.classList.contains("dark");

        const ansiColors = isDark 
          ? {
              red: '#cd3131', brightRed: '#f14c4c',
              green: '#0DBC79', brightGreen: '#23d18b',
              yellow: '#e5e510', brightYellow: '#f5f543',
              blue: '#2472c8', brightBlue: '#3b8eea',
              magenta: '#bc3fbc', brightMagenta: '#d670d6',
              cyan: '#11a8cd', brightCyan: '#29b8db',
              white: '#e5e5e5', brightWhite: '#e5e5e5',
            }
          : {
              red: '#cd3131', brightRed: '#cd3131',
              green: '#008000', brightGreen: '#14ce14',
              yellow: '#949800', brightYellow: '#b5ba00',
              blue: '#0451a5', brightBlue: '#0451a5',
              magenta: '#bc05bc', brightMagenta: '#bc05bc',
              cyan: '#0598bc', brightCyan: '#0598bc',
              white: '#555555', brightWhite: '#a5a5a5',
            };
        
        xtermRef.current.options.theme = {
          ...xtermRef.current.options.theme,
          background: "transparent",
          foreground: foregroundColor,
          cursor: cursorColor,
          cursorAccent: backgroundColor,
          black: backgroundColor,
          ...ansiColors
        };
      }
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => observer.disconnect();
  }, []);

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
      `}</style>
      <div ref={terminalRef} className="h-full w-full" />
      
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
}
