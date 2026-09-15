import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { memo, useEffect, useRef, useState } from "react";
import { type ShellProfile, TerminalManager } from "../../Core/TerminalService";
import { EventBus } from "../../Foundation/EventBus";
import { useLocale } from "../../Foundation/I18n";
import { PtyIPC } from "../../Foundation/IPC/PtyCommands";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import {
  ContextMenuContent,
  ContextMenuDivider,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuTrigger,
} from "../../UI/Components/ContextMenu";

interface TerminalViewProps {
  id: string;
  isActive: boolean;
  shellProfile?: ShellProfile;
  cwd?: string;
}

function terminalTheme() {
  const styles = getComputedStyle(document.documentElement);
  const value = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    background: "rgba(0, 0, 0, 0)",
    foreground: value("--TerminalForeground", "#1F2937"),
    cursor: value("--TerminalCursor", "#4F46E5"),
    cursorAccent: value("--TerminalCursorAccent", "#FFFFFF"),
    selectionBackground: value("--TerminalSelection", "#4F46E533"),
    black: value("--TerminalBlack", "#1F2937"),
    red: value("--TerminalRed", "#EF4444"),
    green: value("--TerminalGreen", "#22C55E"),
    yellow: value("--TerminalYellow", "#EAB308"),
    blue: value("--TerminalBlue", "#3B82F6"),
    magenta: value("--TerminalMagenta", "#A855F7"),
    cyan: value("--TerminalCyan", "#06B6D4"),
    white: value("--TerminalWhite", "#F9FAFB"),
    brightBlack: value("--TerminalBrightBlack", "#6B7280"),
    brightRed: value("--TerminalBrightRed", "#F87171"),
    brightGreen: value("--TerminalBrightGreen", "#4ADE80"),
    brightYellow: value("--TerminalBrightYellow", "#FACC15"),
    brightBlue: value("--TerminalBrightBlue", "#60A5FA"),
    brightMagenta: value("--TerminalBrightMagenta", "#C084FC"),
    brightCyan: value("--TerminalBrightCyan", "#22D3EE"),
    brightWhite: value("--TerminalBrightWhite", "#FFFFFF"),
  };
}

// 高性能 base64 解码，for 循环比 Uint8Array.from callback 在高频长输出下快约 30%
function decodeBase64(data: string): Uint8Array {
  const decoded = atob(data);
  const arr = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    arr[i] = decoded.charCodeAt(i);
  }
  return arr;
}

export const TerminalView = memo(function TerminalView({
  id,
  isActive,
  shellProfile,
  cwd: customCwd,
}: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const spawnedRef = useRef(false);
  // generation 计数器：每次挂载递增，清理函数用于识别自己是否还是"当代"管理者
  const generationRef = useRef(0);
  const [status, setStatus] = useState<"starting" | "ready" | "exited" | "error">("starting");
  const { t } = useLocale();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      allowTransparency: true,
      // 不开 convertEol，由 Rust 端保证换行格式，避免 Shell banner 顶部多出空行
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
      fontSize: 13,
      rightClickSelectsWord: true,
      scrollback: 10_000,
      theme: terminalTheme(),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const syncTransparentSurface = () => {
      for (const element of host.querySelectorAll<HTMLElement>(
        ".xterm, .xterm-viewport, .xterm-screen",
      )) {
        element.style.background = "transparent";
        element.style.backgroundColor = "transparent";
      }
    };
    syncTransparentSurface();

    const fit = () => {
      try {
        fitAddon.fit();
        if (terminal.cols > 0 && terminal.rows > 0) {
          void PtyIPC.resize(id, terminal.rows, terminal.cols).catch(console.error);
        }
      } catch (error) {
        console.warn("Unable to fit terminal", error);
      }
    };
    requestAnimationFrame(fit);

    const dataDisposable = terminal.onData((data) => {
      void PtyIPC.write(id, data).catch((error) => {
        terminal.writeln(`\x1b[31m[Aurona Terminal] Input failed: ${String(error)}\x1b[0m`);
      });
    });
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      void PtyIPC.resize(id, rows, cols).catch(console.error);
    });
    terminal.attachCustomKeyEventHandler((event) => {
      if (!(event.ctrlKey || event.metaKey) || event.type !== "keydown") return true;
      if (event.code === "KeyC" && terminal.hasSelection()) {
        void navigator.clipboard.writeText(terminal.getSelection());
        terminal.clearSelection();
        return false;
      }
      if (event.code === "KeyV") {
        void navigator.clipboard.readText().then((text) => PtyIPC.write(id, text));
        return false;
      }
      return true;
    });

    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = terminalTheme();
      syncTransparentSurface();
      terminal.refresh(0, Math.max(0, terminal.rows - 1));
    });
    // 同时监听 class（明暗主题）与 data-accent（强调色），任一变化即时重建终端配色
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-accent"],
    });

    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      fitAddon.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [id]);

  useEffect(() => {
    const loadSettings = async () => {
      const config = await UserConfigStore.get();
      const terminal = terminalRef.current;
      if (!terminal) return;
      terminal.options.fontSize = config.terminalFontSize || 13;
      terminal.options.cursorBlink = config.terminalCursorBlink !== false;
      fitAddonRef.current?.fit();
    };
    void loadSettings();
    return EventBus.on("settings:terminal-changed", () => void loadSettings());
  }, []);

  useEffect(() => {
    let disposed = false;
    // 每次挂载时递增代号，用于在清理时判断是否为当代管理者
    const currentGeneration = ++generationRef.current;
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    const start = async () => {
      try {
        unlistenOutput = await PtyIPC.listenOutput((payload) => {
          if (payload.id !== id || disposed) return;
          try {
            terminalRef.current?.write(decodeBase64(payload.data));
          } catch (error) {
            console.error("Unable to decode terminal output", error);
          }
        });

        // 每次 await 后检查 disposed，防止 StrictMode 第一轮挂载在异步等待期
        // 已被卸载但仍继续执行到 spawn 导致双进程
        if (disposed) return;

        unlistenExit = await PtyIPC.listenExit((payload) => {
          if (payload.id !== id || disposed) return;
          // 守卫：只处理真正已启动的会话退出，忽略旧会话清理产生的幽灵 exit 事件
          if (!spawnedRef.current) return;
          setStatus("exited");
          terminalRef.current?.writeln(`\r\n\x1b[90m[Aurona Terminal] ${payload.reason}\x1b[0m`);
        });

        if (disposed) return;

        const config = await WorkspaceStore.get();
        const cwd = customCwd || config.lastOpenedPath || ".";

        if (disposed) return;

        await PtyIPC.spawn(id, cwd, shellProfile?.path);
        if (disposed) {
          // 只有当代管理者才可以关闭会话，防止误杀新挂载创建的会话
          if (generationRef.current === currentGeneration) {
            await PtyIPC.close(id);
          }
          return;
        }
        spawnedRef.current = true;
        TerminalManager.markTerminalReady(id);
        setStatus("ready");
        const terminal = terminalRef.current;
        if (terminal && terminal.cols > 0 && terminal.rows > 0) {
          await PtyIPC.resize(id, terminal.rows, terminal.cols);
        }
      } catch (error) {
        TerminalManager.markTerminalFailed(id, error);
        console.error("Failed to start PTY", error);
        setStatus("error");
        terminalRef.current?.writeln(`\x1b[31m[Aurona Terminal] ${String(error)}\x1b[0m`);
      }
    };

    void start();
    return () => {
      disposed = true;
      unlistenOutput?.();
      unlistenExit?.();
      // generation 守卫：只有当代管理者才能关闭会话
      // 防止 React StrictMode 第一次挂载的清理函数误杀第二次挂载创建的会话
      if (spawnedRef.current && generationRef.current === currentGeneration) {
        spawnedRef.current = false;
        void PtyIPC.close(id).catch(console.error);
      }
    };
  }, [customCwd, id, shellProfile?.path]);

  useEffect(() => {
    if (!isActive) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const terminal = terminalRef.current;
        const fitAddon = fitAddonRef.current;
        if (!terminal || !fitAddon) return;
        try {
          fitAddon.fit();
          terminal.refresh(0, Math.max(0, terminal.rows - 1));
          if (terminal.cols > 0 && terminal.rows > 0) {
            void PtyIPC.resize(id, terminal.rows, terminal.cols).catch(console.error);
          }
        } catch (error) {
          console.warn("Unable to restore terminal viewport", error);
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [id, isActive]);

  return (
    <ContextMenuRoot>
      <ContextMenuTrigger asChild>
        <div className="terminal-host relative h-full w-full overflow-hidden bg-transparent">
          {status !== "ready" && (
            <span className="pointer-events-none absolute right-3 top-2 z-10 text-[11px] text-[var(--color-text-muted)]">
              {status === "starting"
                ? t("terminal.starting")
                : status === "exited"
                  ? t("terminal.exited")
                  : t("terminal.failed")}
            </span>
          )}
          <div ref={hostRef} className="h-full w-full p-2" />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          label={t("menu.selectAll")}
          onSelect={() => terminalRef.current?.selectAll()}
        />
        <ContextMenuItem
          label={t("menu.copy")}
          onSelect={() => {
            const terminal = terminalRef.current;
            if (!terminal?.hasSelection()) return;
            void navigator.clipboard.writeText(terminal.getSelection());
            terminal.clearSelection();
          }}
        />
        <ContextMenuItem
          label={t("menu.paste")}
          onSelect={() =>
            void navigator.clipboard.readText().then((text) => PtyIPC.write(id, text))
          }
        />
        <ContextMenuDivider />
        <ContextMenuItem
          label={t("terminal.clearDisplay")}
          onSelect={() => terminalRef.current?.clear()}
        />
      </ContextMenuContent>
    </ContextMenuRoot>
  );
});
