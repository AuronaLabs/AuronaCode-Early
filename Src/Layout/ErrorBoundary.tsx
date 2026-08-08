import { Component, type ErrorInfo, type ReactNode } from "react";
import { desktopApp } from "../Foundation/Desktop";
import { EventBus } from "../Foundation/EventBus";
import { Logger } from "../Foundation/Logger";
import { Button } from "../UI/Components/Button";
import { Icons } from "../UI/Icons/IconManager";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  logPath: string | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    logPath: null,
    copied: false,
  };

  public static getDerivedStateFromError(error: Error): Pick<State, "hasError" | "error"> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    Logger.error("React ErrorBoundary Caught Exception", { error, errorInfo });
    void desktopApp
      .logFilePath()
      .then((logPath) => this.setState({ logPath }))
      .catch(() => this.setState({ logPath: null }));
  }

  private handleReload = () => {
    EventBus.emit("app:reboot");
  };

  private handleCopyLog = async () => {
    const logPath = this.state.logPath;
    if (!logPath) return;
    try {
      await navigator.clipboard.writeText(logPath);
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // 剪贴板不可用时保持按钮可用，不弹原生对话框。
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex w-screen h-screen flex-col items-center justify-center overflow-hidden px-6 select-none text-[var(--color-text-highlight)]"
          style={{ background: "var(--AppBackground)" }}
        >
          <div className="flex max-w-[560px] flex-col items-center gap-4 text-center">
            <div className="mb-2 text-[var(--color-accent)]">
              <Icons.AlertTriangle size={60} stroke={1.5} />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Aurona Code 出现异常</h1>
            <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
              工作区遇到了未处理错误
              <br />
              你可以重启前端引擎；如果问题持续，请把日志地址发给开发团队
            </p>
            {this.state.logPath && (
              <p className="max-w-full truncate rounded-lg border border-[var(--border-subtle)] bg-[var(--material-surface)] px-3 py-2 font-mono text-[11px] text-[var(--color-text-muted)]">
                {this.state.logPath}
              </p>
            )}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button variant="primary" onClick={this.handleReload} className="px-8 py-2">
                重启引擎
              </Button>
              {this.state.logPath && (
                <Button variant="secondary" onClick={this.handleCopyLog} className="px-8 py-2">
                  {this.state.copied ? "已复制" : "复制日志地址"}
                </Button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
