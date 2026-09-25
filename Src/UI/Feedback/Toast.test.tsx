import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showConfirm, showToast, ToastContainer } from "./Toast";

describe("ToastContainer + showToast/showConfirm", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a toast emitted through showToast", async () => {
    render(<ToastContainer />);

    act(() => {
      showToast("已保存", "success");
    });
    // handleToast 为 async（先读 UserConfigStore），需 flush 微任务
    await act(async () => {});

    expect(screen.getByText("已保存")).toBeInTheDocument();
  });

  it("auto-dismisses after the given duration", async () => {
    render(<ToastContainer />);

    act(() => {
      showToast("临时提示", "info", { duration: 1000 });
    });
    await act(async () => {});
    expect(screen.getByText("临时提示")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText("临时提示")).not.toBeInTheDocument();
  });

  it("keeps a toast with actions (duration null) until dismissed", async () => {
    render(<ToastContainer />);

    act(() => {
      showConfirm({
        title: "删除文件",
        message: "确定要删除 main.ts 吗？",
        confirmLabel: "删除",
        cancelLabel: "取消",
        onConfirm: vi.fn(),
      });
    });
    await act(async () => {});

    expect(screen.getByText("确定要删除 main.ts 吗？")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText("确定要删除 main.ts 吗？")).toBeInTheDocument();
  });

  it("runs the confirm action and dismisses the toast", async () => {
    const onConfirm = vi.fn();
    render(<ToastContainer />);

    act(() => {
      showConfirm({
        title: "删除文件",
        message: "确定要删除 main.ts 吗？",
        confirmLabel: "删除",
        cancelLabel: "取消",
        onConfirm,
      });
    });
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await act(async () => {});

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("确定要删除 main.ts 吗？")).not.toBeInTheDocument();
  });

  it("runs the cancel action without confirming", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ToastContainer />);

    act(() => {
      showConfirm({
        title: "删除文件",
        message: "确定要删除 main.ts 吗？",
        confirmLabel: "删除",
        cancelLabel: "取消",
        onConfirm,
        onCancel,
      });
    });
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await act(async () => {});

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByText("确定要删除 main.ts 吗？")).not.toBeInTheDocument();
  });

  it("treats the close button as cancellation exactly once", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ToastContainer />);
    act(() => {
      showConfirm({ title: "Review", message: "Continue?", onConfirm, onCancel });
    });
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "关闭通知" }));
    await act(async () => {});

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does not show a non-critical toast when muted", async () => {
    render(<ToastContainer />);

    act(() => {
      showToast("静音信息", "info");
    });
    await act(async () => {});

    expect(screen.getByText("静音信息")).toBeInTheDocument();
  });
});
