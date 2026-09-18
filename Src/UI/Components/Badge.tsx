import type { ReactNode } from "react";
import { cn } from "../../Shared/Utils/cn";

export type BadgeVariant = "tint" | "solid" | "neutral";

export interface BadgeProps {
  /** tint=状态染色胶囊（默认）；solid=实心强调计数；neutral=中性信息 */
  variant?: BadgeVariant;
  /** tint/solid 变体的颜色令牌（如 var(--StatusSuccess)）；tint 缺省用 accent */
  color?: string;
  className?: string;
  children: ReactNode;
}

/**
 * 统一徽章：全局唯一胶囊规格（rounded-full + text-[10px] font-semibold tracking-wide）。
 * - tint：半透明染色底 + 同色系文字（PREVIEW/Beta/最新 等状态徽章）
 * - solid：实心底白字（仅必须强调的计数）
 * - neutral：material 底 + muted 文字（basedOn 等信息徽章）
 */
export function Badge({ variant = "tint", color, className, children }: BadgeProps) {
  const tint = color ?? "var(--color-accent)";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none tracking-wide",
        variant === "neutral" && "bg-[var(--material-surface)] text-[var(--color-text-muted)]",
        variant === "tint" &&
          !color &&
          "bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-[var(--color-accent)]",
        variant === "solid" && "text-white",
        className,
      )}
      style={
        variant === "tint" && color
          ? {
              backgroundColor: `color-mix(in srgb, ${tint} 12%, transparent)`,
              color: tint,
            }
          : variant === "solid"
            ? { backgroundColor: tint }
            : undefined
      }
    >
      {children}
    </span>
  );
}
