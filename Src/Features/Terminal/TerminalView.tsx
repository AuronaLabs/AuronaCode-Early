import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { memo, useEffect, useRef, useState } from "react";
import { type ShellProfile, TerminalManager } from "../../Core/TerminalService";
import { EventBus } from "../../Foundation/EventBus";
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

interface PtyOutputPayload {
  id: string;
  data: string;
}

interface PtyExitPayload {
  id: string;
  reason: string;
}

const terminalTheme = (isDark: boolean) => ({
  background: "#00000000",
  foreground: isDark ? "#E6EDF3" : "#1F2937",
  cursor: isDark ? "#A78BFA" : "#4F46E5",
  cursorAccent: isDark ? "#111827" : "#FFFFFF",
  selectionBackground: isDark ? "#A78BFA55" : "#4F46E533",
  black: isDark ? "#111827" : "#1F2937",
  red: "#EF4444",
  green: "#22C55E",
  yellow: "#EAB308",
  blue: "#3B82F6",
  magenta: "#A855F7",
  cyan: "#06B6D4",
  white: isDark ? "#E5E7EB" : "#F9FAFB",
  brightBlack: isDark ? "#94A3B8" : "#6B7280",
  brightRed: "#F87171",
  brightGreen: "#4ADE80",
  brightYellow: "#FACC15",
  brightBlue: "#60A5FA",
  brightMagenta: "#C084FC",
  brightCyan: "#22D3EE",
  brightWhite: "#FFFFFF",
});

// 高性能 base64 解码，for 循环比 Uint8Array.from callback 在高频长输出下快约 30%
function decodeBase64(data: string): Uint8Array {
  const decoded = atob(data);
  const arr = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    arr[i] = decoded.charCodeAt(i);
  }
  return arr;
}

// xterm 滚动条样式，与 GlassManager 主题变量联动
const XTERM_SCROLLBAR_STYLE = `
  .xterm-viewport::-webkit-scrollbar { width: 10px; }
  .xterm-viewport::-webkit-scrollbar-track { background: transparent; }
  .xterm-viewport::-webkit-scrollbar-thumb {
    background-color: var(--GlassBorder);
    border-radius: 8px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  .xterm-viewport::-webkit-scrollbar-thumb:hover { background-color: var(--TextMuted); }
`;

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
      theme: terminalTheme(document.documentElement.classList.contains("dark")),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

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
      terminal.options.theme = terminalTheme(document.documentElement.classList.contains("dark"));
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
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
        unlistenOutput = await listen<PtyOutputPayload>("pty-output", ({ payload }) => {
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

        unlistenExit = await listen<PtyExitPayload>("pty-exit", ({ payload }) => {
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
    const timer = window.setTimeout(() => fitAddonRef.current?.fit(), 0);
    return () => window.clearTimeout(timer);
  }, [isActive]);

  return (
    <ContextMenuRoot>
      <ContextMenuTrigger asChild>
        <div className="terminal-host relative h-full w-full overflow-hidden bg-transparent">
          {/* xterm 自定义滚动条，与 GlassManager 主题变量联动 */}
          <style>{XTERM_SCROLLBAR_STYLE}</style>
          {status !== "ready" && (
            <span className="pointer-events-none absolute right-3 top-2 z-10 text-[11px] text-[var(--TextMuted)]">
              {status === "starting"
                ? "正在启动终端…"
                : status === "exited"
                  ? "终端已退出"
                  : "终端启动失败"}
            </span>
          )}
          <div ref={hostRef} className="h-full w-full p-2" />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem label="全选" onSelect={() => terminalRef.current?.selectAll()} />
        <ContextMenuItem
          label="复制"
          onSelect={() => {
            const terminal = terminalRef.current;
            if (!terminal?.hasSelection()) return;
            void navigator.clipboard.writeText(terminal.getSelection());
            terminal.clearSelection();
          }}
        />
        <ContextMenuItem
          label="粘贴"
          onSelect={() =>
            void navigator.clipboard.readText().then((text) => PtyIPC.write(id, text))
          }
        />
        <ContextMenuDivider />
        <ContextMenuItem label="清除显示" onSelect={() => terminalRef.current?.clear()} />
      </ContextMenuContent>
    </ContextMenuRoot>
  );
});
