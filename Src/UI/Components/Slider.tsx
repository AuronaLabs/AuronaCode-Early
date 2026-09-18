import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";

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
}

/**
 * 三档/多档吸附滑杆（Radix Slider 封装）：轨道常驻刻度点 + 下方标签行。
 * 用于「Aurona 玻璃效果」等档位选择场景——指针只在刻度停，不做连续旋钮。
 */
export const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  ({ value, onValueChange, min = 1, max = 3, step = 1, marks = [], ariaLabel, disabled }, ref) => {
    const percent = ((value - min) / (max - min)) * 100;
    return (
      <div className="flex w-full min-w-[180px] flex-col gap-1">
        <SliderPrimitive.Root
          ref={ref}
          value={[value]}
          onValueChange={(values) => onValueChange(values[0] ?? value)}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-label={ariaLabel}
          className="relative flex h-5 w-full touch-none select-none items-center data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
        >
          <SliderPrimitive.Track className="relative h-1.5 w-full grow rounded-full bg-[var(--material-interactive-active)] shadow-[inset_0_1px_1px_var(--material-inset)]">
            <SliderPrimitive.Range className="absolute h-full rounded-full bg-[var(--color-accent)]/70" />
            {marks.map((mark) => (
              <span
                key={mark.value}
                aria-hidden="true"
                className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--border-subtle)] bg-[var(--material-panel)] shadow-sm"
                style={{ left: `${((mark.value - min) / (max - min)) * 100}%` }}
              />
            ))}
            <SliderPrimitive.Thumb className="block h-4 w-4 cursor-pointer rounded-full border border-[var(--border-subtle)] bg-[var(--color-accent)] shadow-[0_2px_8px_color-mix(in_srgb,var(--color-accent)_45%,transparent)] transition-[box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-text-muted)]/40" />
          </SliderPrimitive.Track>
        </SliderPrimitive.Root>
        {marks.length > 0 && (
          <div className="relative h-4 w-full">
            {marks.map((mark) => {
              const markPercent = ((mark.value - min) / (max - min)) * 100;
              const active = Math.abs(value - mark.value) < Number.EPSILON;
              return (
                <span
                  key={mark.value}
                  className={`absolute -translate-x-1/2 whitespace-nowrap text-[10.5px] transition-colors ${
                    active
                      ? "font-semibold text-[var(--color-text-highlight)]"
                      : "text-[var(--color-text-muted)]"
                  }`}
                  style={{ left: `${Math.min(Math.max(markPercent, 8), 92)}%` }}
                >
                  {mark.label}
                </span>
              );
            })}
            <span
              aria-hidden="true"
              className="absolute -top-0.5 h-px w-2 bg-[var(--border-subtle)]"
              style={{ left: `${percent}%` }}
            />
          </div>
        )}
      </div>
    );
  },
);
Slider.displayName = "Slider";
