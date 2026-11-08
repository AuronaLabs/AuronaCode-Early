import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionDescriptor } from "../../Foundation/IPC/ExtensionCommands";

const mocks = vi.hoisted(() => ({
  pick: vi.fn(),
  install: vi.fn(),
  installVscode: vi.fn(),
  uninstall: vi.fn(),
  listToolchains: vi.fn(),
  installToolchain: vi.fn(),
  uninstallToolchain: vi.fn(),
  uninstallRuntime: vi.fn(),
  refresh: vi.fn(),
  hide: vi.fn(),
  restore: vi.fn(),
  openTab: vi.fn(),
  toast: vi.fn(),
  descriptors: [] as ExtensionDescriptor[],
  hidden: [] as string[],
}));

vi.mock("../../Foundation/I18n", () => ({
  useLocale: () => ({ locale: "en", t: (key: string) => key }),
}));
vi.mock("../../State/useExtensionStore", () => ({
  useExtensionStore: (selector: (state: unknown) => unknown) =>
    selector({
      descriptors: mocks.descriptors,
      hiddenExtensionIds: mocks.hidden,
      refresh: mocks.refresh,
      hideExtension: mocks.hide,
      restoreExtension: mocks.restore,
    }),
}));
vi.mock("../../State/Workbench/useWorkbenchStore", () => ({
  useWorkbenchStore: { getState: () => ({ openTab: mocks.openTab }) },
}));
vi.mock("../../Foundation/IPC/NetworkCommands", () => ({
  NetworkIPC: { pickArtifact: mocks.pick },
}));
vi.mock("../../Foundation/IPC/ExtensionCommands", () => ({
  ExtensionIPC: {
    install: mocks.install,
    installVscode: mocks.installVscode,
    uninstall: mocks.uninstall,
  },
}));
vi.mock("../../Foundation/IPC/LanguageServerCommands", () => ({
  LanguageServerIPC: {
    listToolchains: mocks.listToolchains,
    installToolchain: mocks.installToolchain,
    uninstallToolchain: mocks.uninstallToolchain,
    uninstallToolchainRuntime: mocks.uninstallRuntime,
  },
}));
vi.mock("../../UI/Feedback/Toast", () => ({ showToast: mocks.toast }));

import { EventBus } from "../../Foundation/EventBus";
import { ExtensionsPanel } from "./ExtensionsPanel";

describe("local extension management", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.descriptors = [
      {
        id: "demo.one",
        name: "Local One",
        version: "1.0.0",
        publisher: "demo",
        description: "Local package",
      } as ExtensionDescriptor,
      {
        id: "other.two",
        name: "Other Two",
        version: "2.0.0",
        publisher: "other",
        description: "Another package",
      } as ExtensionDescriptor,
    ];
    mocks.hidden = [];
    mocks.listToolchains.mockResolvedValue({ servers: [], runtimes: [], totalBytes: 0 });
    mocks.pick.mockResolvedValue({ artifactId: "local-artifact" });
    mocks.refresh.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("searches installed packages and changes sidebar visibility", async () => {
    render(<ExtensionsPanel />);
    await waitFor(() => expect(mocks.listToolchains).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "demo" } });
    expect(screen.getByRole("heading", { name: "Local One" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Other Two" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: /Local One/ }));
    expect(mocks.hide).toHaveBeenCalledWith("demo.one");
  });

  it.each([
    ["importAurx", "extension", mocks.install],
    ["importVsix", "vscode", mocks.installVscode],
    ["importToolchain", "toolchain", mocks.installToolchain],
  ] as const)("imports %s through the local picker", async (label, kind, install) => {
    render(<ExtensionsPanel />);
    fireEvent.click(screen.getByRole("button", { name: `extensions.manager.${label}` }));
    await waitFor(() => expect(install).toHaveBeenCalledWith("local-artifact"));
    expect(mocks.pick).toHaveBeenCalledWith(kind);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  });

  it("cancels without installing or reporting success", async () => {
    mocks.pick.mockResolvedValue(null);
    render(<ExtensionsPanel />);
    const button = screen.getByRole("button", { name: "extensions.manager.importAurx" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("does not open a second picker while an import is pending", async () => {
    let finish!: (value: null) => void;
    mocks.pick.mockReturnValue(
      new Promise<null>((resolve) => {
        finish = resolve;
      }),
    );
    render(<ExtensionsPanel />);
    const button = screen.getByRole("button", { name: "extensions.manager.importAurx" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.pick).toHaveBeenCalledOnce();
    finish(null);
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("requires uninstall confirmation and preserves a failed uninstall for retry", async () => {
    mocks.uninstall.mockRejectedValue(new Error("package in use"));
    render(<ExtensionsPanel />);
    fireEvent.click(screen.getAllByRole("button", { name: "extensions.manager.uninstall" })[0]);
    expect(mocks.uninstall).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "extensions.manager.uninstall" }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining("package in use"), "error"),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "common.cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["server", "runtime"] as const)(
    "uninstalls a local %s after confirmation",
    async (kind) => {
      mocks.listToolchains.mockResolvedValue({
        servers: [{ id: "test.server", name: "Test Server", version: "1" }],
        runtimes: [{ runtimeType: "node", version: "22" }],
        totalBytes: 0,
      });
      render(<ExtensionsPanel />);
      const name = kind === "server" ? /Test Server/ : /node · 22/;
      const label = await screen.findByText(name);
      const row = label.closest("div");
      expect(row).not.toBeNull();
      fireEvent.click(
        within(row as HTMLElement).getByRole("button", { name: "extensions.manager.uninstall" }),
      );
      const uninstall = kind === "server" ? mocks.uninstallToolchain : mocks.uninstallRuntime;
      expect(uninstall).not.toHaveBeenCalled();
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "extensions.manager.uninstall",
        }),
      );
      await waitFor(() =>
        expect(uninstall).toHaveBeenCalledWith(kind === "server" ? "test.server" : "node"),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(mocks.refresh).toHaveBeenCalledOnce();
    },
  );

  it("opens extension permission settings", () => {
    const nav = vi.fn();
    const stop = EventBus.on("settings:nav", nav);
    render(<ExtensionsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "extensions.manager.permissions" }));
    expect(mocks.openTab).toHaveBeenCalledWith(expect.objectContaining({ type: "settings" }));
    expect(nav).toHaveBeenCalledWith("extensions");
    stop();
  });
});
