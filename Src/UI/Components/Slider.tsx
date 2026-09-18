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
  min?: number;
  max?: number;
  step?: number;
  /** 轨道上的常驻刻度点与标签（value 落点决定水平位置） */
  marks?: SliderMark[];
  ariaLabel: string;
  disabled?: boolean;
  /**
   * 自由拖动 + 松手吸附：拖动过程视觉连续跟手（内部细分为 1），松手（commit）时
   * 吸附到最近档位再回调 onValueChange。键盘与无障碍行为不受影响。
   */
  snapOnRelease?: boolean;
}

/**
 * 玻璃滑杆（Radix Slider 封装）：玻璃轨道 + 玻璃球 Thumb + 常驻刻度点 + 下方标签行。
 * 用于「Aurona 玻璃强度」等档位选择场景。
 */
export const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  (
    {
      value,
      onValueChange,
      min = 1,
      max = 3,
      step = 1,
      marks = [],
      ariaLabel,
      disabled,
      snapOnRelease = false,
    },
    ref,
  ) => {
    const [dragging, setDragging] = React.useState(false);

    // 自由拖动：内部以 1 为步长细分，视觉连续跟手；回调时吸附最近档位。
    const dragStep = snapOnRelease ? 1 : step;
    const snap = (raw: number) => {
      const snapped = Math.round((raw - min) / step) * step + min;
      return Math.min(Math.max(snapped, min), max);
    };

    return (
      <div className="flex w-full min-w-[180px] flex-col gap-1.5">
        <SliderPrimitive.Root
          ref={ref}
          value={[value]}
          onValueChange={(values) => {
            const raw = values[0];
            if (raw === undefined) return;
            onValueChange(snapOnRelease ? snap(raw) : raw);
          }}
          min={min}
          max={max}
          step={dragStep}
          disabled={disabled}
          aria-label={ariaLabel}
          className="relative flex h-6 w-full touch-none select-none items-center data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
        >
          <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full border border-[var(--GlassSurface-Rim)] bg-[var(--switch-track-off)] shadow-[var(--switch-track-shadow)] backdrop-blur-[var(--glass-blur-raised)] backdrop-saturate-[var(--GlassSaturation)]">
            <SliderPrimitive.Range className="absolute h-full rounded-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--color-accent)_55%,transparent),var(--color-accent))] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]" />
          </SliderPrimitive.Track>
          {marks.map((mark) => {
            const active = Math.abs(value - mark.value) < Number.EPSILON;
            return (
              <span
                key={mark.value}
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full backdrop-blur-[var(--glass-blur-overlay)] transition-colors duration-200",
                  active
                    ? "bg-[var(--color-accent)] shadow-[0_0_6px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]"
                    : "border border-[var(--border-subtle)] bg-[var(--material-overlay)] shadow-[var(--switch-thumb-shadow)]",
                )}
                style={{ left: `${((mark.value - min) / (max - min)) * 100}%` }}
              />
            );
          })}
          <SliderPrimitive.Thumb
            onPointerDown={() => setDragging(true)}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
            onBlur={() => setDragging(false)}
            className={cn(
              "block size-[18px] cursor-grab rounded-full border border-[var(--GlassSurface-Rim)] bg-[var(--switch-thumb-surface)] shadow-[var(--switch-thumb-shadow),var(--switch-track-shadow),0_2px_8px_color-mix(in_srgb,var(--color-accent)_35%,transparent)] backdrop-blur-[var(--glass-blur-overlay)] backdrop-saturate-[var(--GlassSaturation)] transition-[box-shadow,transform] duration-150 outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-[var(--color-text-muted)]/40",
              dragging &&
                "scale-110 shadow-[var(--switch-thumb-shadow),var(--switch-track-shadow),0_0_14px_color-mix(in_srgb,var(--color-accent)_55%,transparent)]",
            )}
          />
        </SliderPrimitive.Root>
        {marks.length > 0 && (
          <div className="relative h-4 w-full">
            {marks.map((mark) => {
              const markPercent = ((mark.value - min) / (max - min)) * 100;
              const active = Math.abs(value - mark.value) < Number.EPSILON;
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
