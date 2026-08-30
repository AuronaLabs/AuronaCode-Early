import { Button } from "../../../UI/Components/Button";
import { GlassContainer } from "../../../UI/Core/GlassManager";
import { Icons } from "../../../UI/Icons/IconManager";

export interface DependencyInfo {
  name: string;
  version?: string;
  size?: string;
  type: "runtime" | "extension";
  description: string;
}

interface DependencyConfirmModalProps {
  isOpen: boolean;
  targetName: string;
  targetVersion?: string;
  targetType?: "lsp" | "extension";
  dependencies: DependencyInfo[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function DependencyConfirmModal({
  isOpen,
  targetName,
  targetVersion: _targetVersion,
  dependencies,
  onConfirm,
  onCancel,
}: DependencyConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-[var(--glass-blur-base)] transition-all animate-in fade-in duration-200 select-none">
      <GlassContainer
        layer="floating"
        className="w-full max-w-[320px] rounded-3xl p-6 shadow-[var(--shadow-overlay)] flex flex-col items-center text-center animate-in zoom-in-95 duration-200 border border-[var(--border-subtle)]"
      >
        {/* 顶部居中拟物化精致图标 */}
        <div className="flex size-13 items-center justify-center rounded-2xl bg-[var(--material-surface)] text-amber-400 border border-[var(--border-subtle)] mb-3.5 shadow-inner">
          <Icons.Terminal size={24} stroke={1.75} />
        </div>

        {/* 居中标题 */}
        <h3 className="text-[14.5px] font-semibold text-[var(--color-text-highlight)] tracking-tight leading-snug px-1">
          安装 “{targetName}”？
        </h3>

        {/* 极简说明 */}
        <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed mt-1.5 mb-3.5 px-1">
          该语言服务需要官方公共 Node.js 运行时环境，将为您一并下载并配置共享环境。
        </p>

        {/* 附带组件微型胶囊卡片 */}
        <div className="w-full space-y-2 mb-5">
          {dependencies.map((dep) => (
            <div
              key={`${dep.name}-${dep.version}`}
              className="p-2.5 rounded-2xl bg-[var(--material-interactive-hover)] border border-[var(--border-subtle)] flex items-center justify-between text-left gap-2.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="size-6 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0">
                  <Icons.Terminal size={13} />
                </div>
                <div className="min-w-0">
                  <div className="text-[11.5px] font-semibold text-[var(--color-text-highlight)] truncate">
                    {dep.name}
                  </div>
                  <div className="text-[9.5px] text-[var(--color-text-muted)] truncate">
                    系统公共共享 · 仅需下载一次
                  </div>
                </div>
              </div>
              {dep.size && (
                <span className="px-2 py-0.5 rounded-full bg-[var(--material-interactive-active)] text-[10px] font-mono text-amber-400 shrink-0 border border-amber-500/20">
                  {dep.size}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* 极简流线按钮组 */}
        <div className="flex w-full flex-col gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={onConfirm}
            className="h-9 w-full text-[12.5px] font-semibold rounded-xl shadow-md"
          >
            <Icons.Download size={13} className="mr-1.5 inline" />
            确认并附带安装
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="h-8.5 w-full text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] rounded-xl"
          >
            取消
          </Button>
        </div>
      </GlassContainer>
    </div>
  );
}
