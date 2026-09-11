import {
  Component,
  type ComponentType,
  createContext,
  type ErrorInfo,
  type LazyExoticComponent,
  lazy,
  type ReactNode,
  useContext,
} from "react";
import { LocaleService } from "../Foundation/I18n";
import { Logger } from "../Foundation/Logger";
import { Button } from "../UI/Components/Button";
import { Icons } from "../UI/Icons/IconManager";

interface LazyChunkBoundaryProps {
  children: ReactNode;
  modulePath: string;
}

interface LazyChunkBoundaryState {
  error: Error | null;
  attempt: number;
}

const LazyChunkAttemptContext = createContext(0);

/**
 * Creates a lazy component whose loader can be recreated by the nearest
 * LazyChunkBoundary after a failed chunk request.
 */
export function lazyChunk<Props extends object>(
  loader: () => Promise<{ default: ComponentType<Props> }>,
): ComponentType<Props> {
  const components = new Map<number, LazyExoticComponent<ComponentType<Props>>>();
  return function RetryableLazyComponent(props: Props) {
    const attempt = useContext(LazyChunkAttemptContext);
    let LazyComponent = components.get(attempt);
    if (!LazyComponent) {
      LazyComponent = lazy(loader);
      components.set(attempt, LazyComponent);
    }
    const Element = LazyComponent as unknown as ComponentType<Props>;
    return <Element {...props} />;
  };
}

export class LazyChunkBoundary extends Component<LazyChunkBoundaryProps, LazyChunkBoundaryState> {
  public state: LazyChunkBoundaryState = { error: null, attempt: 0 };

  public static getDerivedStateFromError(error: Error): Partial<LazyChunkBoundaryState> {
    return { error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    Logger.error("Lazy module load failed", {
      modulePath: this.props.modulePath,
      error,
      errorInfo,
    });
  }

  private retry = (): void => {
    this.setState((state) => ({ error: null, attempt: state.attempt + 1 }));
  };

  private reload = (): void => {
    window.location.reload();
  };

  public render(): ReactNode {
    if (!this.state.error) {
      return (
        <LazyChunkAttemptContext.Provider value={this.state.attempt}>
          {this.props.children}
        </LazyChunkAttemptContext.Provider>
      );
    }
    return (
      <div className="flex h-full w-full items-center justify-center bg-transparent px-5 text-center">
        <div className="flex max-w-md flex-col items-center gap-3 text-[var(--color-text-muted)]">
          <Icons.Refresh size={24} className="text-[var(--StatusWarning)]" />
          <p className="text-[13px] font-medium text-[var(--color-text-highlight)]">
            {LocaleService.translate("errorBoundary.lazyTitle")}
          </p>
          <p className="text-[11px] leading-relaxed">
            {LocaleService.translate("errorBoundary.lazyDescription")}
          </p>
          <code className="max-w-full truncate border border-[var(--border-subtle)] px-2 py-1 text-[10px]">
            {this.props.modulePath}
          </code>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={this.retry}>
              {LocaleService.translate("errorBoundary.retry")}
            </Button>
            <Button size="sm" variant="secondary" onClick={this.reload}>
              {LocaleService.translate("errorBoundary.reload")}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
