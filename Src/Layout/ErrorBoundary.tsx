import { Component, ErrorInfo, ReactNode } from "react";
import { Logger } from "../Core/Logger";
import { Icons } from "../UI/Icons/IconManager";
import { Button } from "../UI/Components/Button";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    Logger.error("React ErrorBoundary Caught Exception", { error, errorInfo });
  }

  private handleReload = () => {
    import("../Core/EventBus").then(({ EventBus }) => {
      EventBus.emit("app:reboot");
    });
  };

  private handleCopyLog = async () => {
    try {
      const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
      const appLocalData = await appLocalDataDir();
      const logPath = await join(appLocalData, "logs", `${Logger.getLogId()}.log`);
      await navigator.clipboard.writeText(logPath);
      alert(`日志地址已复制：${logPath}`);
    } catch {
      alert("复制路径失败，日志位于 AppData/Local 目录下");
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center w-screen h-screen bg-[var(--ColorApp)] text-[var(--ColorTextHighlight)] select-none overflow-hidden px-6">
          <div className="flex flex-col items-center text-center gap-4 max-w-[520px]">
            <div className="text-[var(--ColorAccent)] mb-2">
              <Icons.AlertTriangle size={64} stroke={1.5} />
            </div>

            <h1 className="text-3xl font-bold tracking-tight">Aurona Code 出现异常</h1>
            <p className="text-sm text-[var(--ColorMuted)] leading-relaxed">
              工作区遇到了未处理错误你可以重启前端引擎，或复制日志地址继续排查
            </p>
            <p className="text-sm text-[var(--ColorMuted)] font-mono">CrashID: {Logger.getLogId()}</p>

            <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
              <Button variant="primary" onClick={this.handleReload} className="px-8 py-2">
                重启引擎
              </Button>
              <Button variant="secondary" onClick={this.handleCopyLog} className="px-8 py-2">
                复制日志地址
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
