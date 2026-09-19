import { type ClassValue, clsx } from "clsx";
import React from "react";
import { twMerge } from "tailwind-merge";
import { computeGlassAccent } from "./glassConfig";
import { glassVariants } from "./variants";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface GlassContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  layer?: "base" | "raised" | "overlay";
  interactive?: boolean;
  /**
   * 实例级玻璃染色（iOS 26 liquid glass 语言）：传入 CSS 颜色（如状态令牌），
   * 经 computeGlassAccent 生成「极弱底染（6%）+ 边缘点缀（12%）」，配合
   * .glass-accent-halo 光斑使用。不传时行为与普通玻璃完全一致。
   * 纯 color-mix 实现，无额外合成层；变量走 --GlassInstance-* 命名空间。
   */
  tint?: string;
}

export const GlassContainer = React.forwardRef<HTMLDivElement, GlassContainerProps>(
  ({ className, layer, interactive, tint, style, ...props }, ref) => {
    const tintStyle = tint
      ? ({
          ["--GlassInstance-Tint" as string]: tint,
          ...computeGlassAccent("var(--GlassInstance-Tint)", "var(--GlassInstance-Tint)"),
        } as React.CSSProperties)
      : undefined;

    return (
      <div
        ref={ref}
        className={cn(glassVariants({ layer, interactive }), className)}
        style={{ ...style, ...tintStyle }}
        {...props}
      />
    );
  },
);
GlassContainer.displayName = "GlassContainer";
