import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Switch } from "./Switch";

describe("Switch", () => {
  it("starts unchecked and reports true on the first click (uncontrolled)", () => {
    const onCheckedChange = vi.fn();
    render(<Switch onCheckedChange={onCheckedChange} aria-label="自动保存" />);

    const toggle = screen.getByRole("switch", { name: "自动保存" });
    expect(toggle).toHaveAttribute("data-state", "unchecked");

    fireEvent.click(toggle);

    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(toggle).toHaveAttribute("data-state", "checked");
  });

  it("stays on the controlled value while reporting the requested change", () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked onCheckedChange={onCheckedChange} aria-label="深色模式" />);

    const toggle = screen.getByRole("switch", { name: "深色模式" });
    expect(toggle).toHaveAttribute("data-state", "checked");

    fireEvent.click(toggle);

    expect(onCheckedChange).toHaveBeenCalledWith(false);
    expect(toggle).toHaveAttribute("data-state", "checked");
  });

  it("does not toggle when disabled", () => {
    const onCheckedChange = vi.fn();
    render(<Switch disabled onCheckedChange={onCheckedChange} aria-label="遥测" />);

    const toggle = screen.getByRole("switch", { name: "遥测" });
    expect(toggle).toBeDisabled();

    fireEvent.click(toggle);

    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute("data-state", "unchecked");
  });
});
