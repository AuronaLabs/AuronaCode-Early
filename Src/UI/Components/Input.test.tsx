import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Input } from "./Input";

describe("Input", () => {
  it("renders as a textbox with the given controlled value", () => {
    render(<Input value="hello" onChange={vi.fn()} aria-label="名称" />);

    const input = screen.getByLabelText("名称") as HTMLInputElement;
    expect(input).toHaveValue("hello");
  });

  it("reports typed changes through onChange (controlled)", () => {
    // 受控组件：React 会在事件派发后把 DOM value 复位为受控值，
    // 因此在 handler 内同步捕获输入值
    const received: string[] = [];
    render(
      <Input value="" onChange={(event) => received.push(event.target.value)} aria-label="名称" />,
    );

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "abc" } });

    expect(received).toEqual(["abc"]);
  });

  it("does not report changes when disabled", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Input value="fixed" onChange={onChange} disabled aria-label="名称" />);

    const input = screen.getByLabelText("名称") as HTMLInputElement;
    expect(input).toBeDisabled();

    // user-event 尊重原生 disabled 语义（jsdom fireEvent.change 会绕过）
    await user.type(input, "changed");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders the leading icon inside the wrapper", () => {
    render(
      <Input
        value=""
        onChange={vi.fn()}
        aria-label="搜索"
        icon={<span data-testid="input-icon">⌕</span>}
      />,
    );

    expect(screen.getByTestId("input-icon")).toBeInTheDocument();
  });

  it("marks the inner input with the surface kind", () => {
    render(<Input value="" onChange={vi.fn()} surface="embedded" aria-label="嵌入" />);

    expect(screen.getByLabelText("嵌入")).toHaveAttribute("data-aurona-input", "embedded");
  });

  it("keeps placeholder on the inner input", () => {
    render(<Input value="" onChange={vi.fn()} placeholder="请输入" />);

    expect(screen.getByPlaceholderText("请输入")).toBeInTheDocument();
  });
});
