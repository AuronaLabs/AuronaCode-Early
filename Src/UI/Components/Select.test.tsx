import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Select } from "./Select";

const OPTIONS = [
  { value: "stable", label: "Stable" },
  { value: "beta", label: "Beta" },
  { value: "legacy", label: "Legacy", disabled: true },
];

describe("Select", () => {
  beforeAll(() => {
    // Radix Select 在 jsdom 下依赖的指针捕获/滚动 API（不会真正触发布局）
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window.HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => false),
    });
    Object.defineProperty(window.HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("shows the selected value on the trigger", () => {
    render(<Select options={OPTIONS} value="beta" onChange={vi.fn()} ariaLabel="更新通道" />);

    expect(screen.getByRole("combobox", { name: "更新通道" })).toHaveTextContent("Beta");
  });

  it("opens the option list and reports the picked option through onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Select options={OPTIONS} value="stable" onChange={onChange} ariaLabel="更新通道" />);

    await user.click(screen.getByRole("combobox", { name: "更新通道" }));

    // 选项通过 Portal 渲染在 body 下
    const listbox = await screen.findByRole("listbox");
    expect(listbox).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Beta" })).toBeInTheDocument();
    // Radix 用 aria-disabled/data-disabled 表达选项禁用（渲染为 div 而非原生 disabled）
    expect(screen.getByRole("option", { name: "Legacy" })).toHaveAttribute("aria-disabled", "true");

    await user.click(screen.getByRole("option", { name: "Beta" }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("beta");
    });
  });

  it("does not open when disabled", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Select options={OPTIONS} value="stable" onChange={onChange} ariaLabel="更新通道" disabled />,
    );

    const trigger = screen.getByRole("combobox", { name: "更新通道" });
    expect(trigger).toBeDisabled();

    await user.click(trigger);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
