import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("applies default primary variant and default size classes", () => {
    render(<Button>保存</Button>);

    const button = screen.getByRole("button", { name: "保存" });
    expect(button).toHaveClass("bg-[var(--color-accent)]");
    expect(button).toHaveClass("h-8");
  });

  it("applies explicit variant and size classes", () => {
    render(
      <Button variant="danger" size="lg">
        删除
      </Button>,
    );

    const button = screen.getByRole("button", { name: "删除" });
    expect(button).toHaveClass("bg-[var(--DiagError)]/90");
    expect(button).toHaveClass("h-10");
  });

  it("applies sm size classes", () => {
    render(<Button size="sm">小按钮</Button>);

    expect(screen.getByRole("button")).toHaveClass("h-7");
  });

  it("fires onClick on click", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>点我</Button>);

    fireEvent.click(screen.getByRole("button", { name: "点我" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        禁用
      </Button>,
    );

    const button = screen.getByRole("button", { name: "禁用" });
    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  it("merges variant classes onto the child element with asChild", () => {
    render(
      <Button asChild variant="secondary">
        <a href="#secondary">链接按钮</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "链接按钮" });
    expect(link).toHaveClass("bg-[var(--material-interactive-hover)]");
  });
});
