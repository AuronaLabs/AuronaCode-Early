import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";
import { cn } from "../../Shared/Utils/cn";

export interface SliderMark {
  value: number;
  label: string;
}

export interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  /** 松手（或键盘提交）时触发；snapOnRelease 下值已吸附到 step 档位，适合持久化 */
  onValueCommit?: (value: number) => void;
  min?: number;
  max?: number;
  /** 提交粒度：snapOnRelease 时松手吸附到该步长档位；否则直接作为拖动步长 */
  step?: number;
  /** 拖动细 分步长（不传则取 step）：与提交档位解耦，让拖动过程连续跟手 */
  dragStep?: number;
  /** 轨道刻度点与下方标签（纯视觉锚点，不吸附；值接近时点亮） */
  marks?: SliderMark[];
  ariaLabel: string;
  disabled?: boolean;
  /** 自由拖动 + 松手吸附：拖动按 dragStep 连续跟手，松手吸附最近 step 档位 */
  snapOnRelease?: boolean;
}

/** 依 step 步长吸附并钳制到 [min, max]，按 step 的小数位消除浮点尾差 */
function snapToStep(raw: number, min: number, max: number, step: number): number {
  const snapped = Math.round((raw - min) / step) * step + min;
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Math.min(Math.max(Number(snapped.toFixed(decimals)), min), max);
}

/**
 * 玻璃滑杆（Radix Slider 封装）：
 * - 连续模式：不传 snapOnRelease 时按 step 自由调节，onValueCommit 供松手持久化；
 * - 档位模式：snapOnRelease 时拖动按 dragStep 细分跟手，松手吸附最近档位。
 * 视觉：玻璃轨道（inset 阴影 + rim 高光）+ accent 渐变填充 + 径向高光玻璃球
 * Thumb（拖动中微放大并泛出 accent 光晕）；marks 刻度点仅在提供时渲染。
 */
export const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  (
    {
      value,
      onValueChange,
      onValueCommit,
      min = 0,
      max = 100,
      step = 1,
      dragStep,
      marks = [],
      ariaLabel,
      disabled,
      snapOnRelease = false,
    },
    ref,
  ) => {
    const [dragging, setDragging] = React.useState(false);
    const dragGranularity = dragStep ?? step;

    // 刻度激活容差：取「相邻刻度最小间距一半」与「量程 2%」的较小值——
    // 档位模式下命中最邻近档即点亮，连续模式下仅贴近锚点才点亮
    const markTolerance = React.useMemo(() => {
      if (marks.length < 2) return Number.EPSILON;
      const values = marks.map((mark) => mark.value).sort((a, b) => a - b);
      let minGap = Infinity;
      for (let i = 1; i < values.length; i += 1) {
        minGap = Math.min(minGap, values[i] - values[i - 1]);
      }
      return Math.min(minGap / 2, ((max - min) * 2) / 100);
    }, [marks, min, max]);
    const isMarkActive = (markValue: number) =>
      Math.abs(value - markValue) <= markTolerance + Number.EPSILON;

    return (
      <div className="flex w-full min-w-[180px] flex-col gap-1.5">
        <SliderPrimitive.Root
          ref={ref}
          value={[value]}
          min={min}
          max={max}
          step={dragGranularity}
          disabled={disabled}
          className="relative flex h-6 w-full touch-none select-none items-center data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
          onValueChange={(values) => {
            const raw = values[0];
            if (raw === undefined) return;
            onValueChange(raw);
          }}
          onValueCommit={(values) => {
            const raw = values[0];
            if (raw === undefined) return;
            const committed = snapOnRelease ? snapToStep(raw, min, max, step) : raw;
            // 吸附档位与拖动细 分值不一致时回写一次，让 Thumb 精确落位
            if (committed !== raw) onValueChange(committed);
            onValueCommit?.(committed);
          }}
        >
          <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-[var(--material-surface)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.16),inset_0_-1px_0_color-mix(in_srgb,var(--GlassSurface-Rim)_75%,transparent),0_0_0_1px_color-mix(in_srgb,var(--GlassSurface-Rim)_30%,transparent)] backdrop-blur-[var(--glass-blur-raised)] backdrop-saturate-[var(--GlassSaturation)]">
            <SliderPrimitive.Range className="absolute h-full rounded-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--color-accent)_58%,transparent),var(--color-accent))] shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_1px_6px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]" />
          </SliderPrimitive.Track>
          {marks.map((mark) => {
            const active = isMarkActive(mark.value);
            return (
              <span
                key={mark.value}
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-200",
                  active
                    ? "bg-[var(--color-accent)] shadow-[0_0_8px_color-mix(in_srgb,var(--color-accent)_55%,transparent)]"
                    : "bg-[var(--material-overlay)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--GlassSurface-Rim)_65%,transparent)]",
                )}
                style={{ left: `${((mark.value - min) / (max - min)) * 100}%` }}
              />
            );
          })}
          <SliderPrimitive.Thumb
            aria-label={ariaLabel}
            onPointerDown={() => setDragging(true)}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
            onLostPointerCapture={() => setDragging(false)}
            onBlur={() => setDragging(false)}
            className={cn(
              "block size-5 cursor-grab touch-none rounded-full border border-[var(--GlassSurface-Rim)] bg-[var(--switch-thumb-surface)] [background-image:radial-gradient(circle_at_30%_28%,rgba(255,255,255,0.7),rgba(255,255,255,0.12)_55%,transparent_78%)] shadow-[0_1px_5px_rgba(0,0,0,0.22),0_0_0_3px_color-mix(in_srgb,var(--color-accent)_10%,transparent),inset_0_1px_1px_rgba(255,255,255,0.45)] backdrop-blur-[var(--glass-blur-overlay)] backdrop-saturate-[var(--GlassSaturation)] transition-[box-shadow,transform] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-text-muted)]/40",
              dragging &&
                "scale-110 cursor-grabbing shadow-[0_2px_10px_rgba(0,0,0,0.26),0_0_14px_color-mix(in_srgb,var(--color-accent)_55%,transparent),inset_0_1px_1px_rgba(255,255,255,0.5)]",
            )}
          />
        </SliderPrimitive.Root>
        {marks.length > 0 && (
          <div className="relative h-4 w-full">
            {marks.map((mark) => {
              const markPercent = ((mark.value - min) / (max - min)) * 100;
              const active = isMarkActive(mark.value);
              return (
                <span
                  key={mark.value}
                  className={`absolute -translate-x-1/2 whitespace-nowrap text-[11px] transition-colors ${
                    active
                      ? "font-semibold text-[var(--color-accent)]"
                      : "text-[var(--color-text-muted)]"
                  }`}
                  style={{ left: `${Math.min(Math.max(markPercent, 8), 92)}%` }}
                >
                  {mark.label}
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  },
);
Slider.displayName = "Slider";
