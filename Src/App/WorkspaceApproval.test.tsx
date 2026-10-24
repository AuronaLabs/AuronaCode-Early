import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { ToastMessage } from "../Foundation/Notifications";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  closed: vi.fn(),
  resolve: vi.fn(),
  initialize: vi.fn(),
  cancel: vi.fn(),
  notify: vi.fn(),
  dismiss: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("../Core/WorkspaceService", () => ({
  WorkspaceService: { initialize: mocks.initialize, cancelInitialization: mocks.cancel },
}));
vi.mock("../Foundation/I18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
  LocaleService: { translate: (key: string) => key },
}));
vi.mock("../Foundation/IPC/FileSystemCommands", () => ({
  FileSystemCommands: {
    onWorkspaceApproval: mocks.listen,
    onWorkspaceApprovalClosed: mocks.closed,
    resolveWorkspaceApproval: mocks.resolve,
  },
}));
vi.mock("../UI/Feedback/Toast", () => ({
  showNotification: mocks.notify,
  dismissNotification: mocks.dismiss,
  showToast: mocks.toast,
}));

import { WorkspaceApproval } from "./WorkspaceApproval";

describe("workbench workspace approval", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listen.mockResolvedValue(vi.fn());
    mocks.closed.mockResolvedValue(vi.fn());
    mocks.resolve.mockResolvedValue(undefined);
    mocks.initialize.mockResolvedValue(undefined);
    mocks.cancel.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("waits for visible workbench and both listeners before restoring the workspace", async () => {
    const view = render(<WorkspaceApproval visible={false} />);
    expect(mocks.listen).not.toHaveBeenCalled();
    view.rerender(<WorkspaceApproval visible />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalledOnce());
    expect(mocks.closed).toHaveBeenCalledOnce();
    const receive = mocks.listen.mock.calls[0][0];
    act(() => receive({ id: "request-1", path: "C:/work" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const toast = mocks.notify.mock.calls[0][0] as ToastMessage;
    act(() => {
      void toast.actions?.[0].onClick?.();
    });
    expect(await screen.findByRole("dialog")).toHaveTextContent("C:/work");
    act(() => toast.onDismiss?.());
    expect(mocks.resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "workspaceApproval.allow" }));
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledWith("request-1", true));
  });

  it("cleans partial listener setup and releases startup when a registration fails", async () => {
    const dispose = vi.fn();
    mocks.listen.mockResolvedValue(dispose);
    mocks.closed.mockRejectedValue(new Error("listener failed"));
    render(<WorkspaceApproval visible />);
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledOnce());
    expect(dispose).toHaveBeenCalledOnce();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("does not restore twice under StrictMode", async () => {
    render(
      <StrictMode>
        <WorkspaceApproval visible />
      </StrictMode>,
    );
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalledOnce());
  });
});
