import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(
      <Modal isOpen={false} onClose={vi.fn()} title="关闭的弹窗">
        内容
      </Modal>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders title, children and footer through the portal when open", () => {
    render(
      <Modal
        isOpen
        onClose={vi.fn()}
        title="删除确认"
        footer={<button type="button">确认删除</button>}
      >
        此操作不可撤销
      </Modal>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("删除确认")).toBeInTheDocument();
    expect(screen.getByText("此操作不可撤销")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认删除" })).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title="删除确认">
        此操作不可撤销
      </Modal>,
    );

    // 弹窗内唯一按钮即右上角关闭按钮（本用例 footer 为空）
    const closeButton = screen.getByRole("dialog").querySelector("button");
    expect(closeButton).not.toBeNull();
    fireEvent.click(closeButton as Element);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title="删除确认">
        此操作不可撤销
      </Modal>,
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides the close button when no onClose is provided", () => {
    render(
      <Modal isOpen title="只读提示">
        无法关闭
      </Modal>,
    );

    expect(screen.getByRole("dialog").querySelector("button")).toBeNull();
  });
});
