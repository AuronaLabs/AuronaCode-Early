import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders children in a pill", () => {
    render(<Badge>Beta</Badge>);

    const badge = screen.getByText("Beta");
    expect(badge).toHaveClass("rounded-full");
    expect(badge).toHaveClass("text-[10px]");
  });

  it("uses the accent tint by default (tint variant without color)", () => {
    render(<Badge>最新</Badge>);

    const badge = screen.getByText("最新");
    expect(badge).toHaveClass("bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]");
    expect(badge).toHaveClass("text-[var(--color-accent)]");
    expect(badge).not.toHaveAttribute("style");
  });

  it("colors the tint variant inline when a color token is given", () => {
    render(<Badge color="var(--StatusSuccess)">通过</Badge>);

    const badge = screen.getByText("通过");
    expect(badge.style.backgroundColor).toBe(
      "color-mix(in srgb, var(--StatusSuccess) 12%, transparent)",
    );
    expect(badge.style.color).toBe("var(--StatusSuccess)");
  });

  it("renders the solid variant with white text and the color as background", () => {
    render(
      <Badge variant="solid" color="var(--StatusError)">
        3
      </Badge>,
    );

    const badge = screen.getByText("3");
    expect(badge).toHaveClass("text-white");
    expect(badge.style.backgroundColor).toBe("var(--StatusError)");
  });

  it("renders the neutral variant with the material surface", () => {
    render(<Badge variant="neutral">v1.2.0</Badge>);

    const badge = screen.getByText("v1.2.0");
    expect(badge).toHaveClass("bg-[var(--material-surface)]");
    expect(badge).toHaveClass("text-[var(--color-text-muted)]");
    expect(badge).not.toHaveAttribute("style");
  });
});
