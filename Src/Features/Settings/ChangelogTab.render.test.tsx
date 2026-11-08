import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../Foundation/I18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

import { ChangelogTab } from "./ChangelogTab";

describe("changelog release status", () => {
  afterEach(cleanup);

  it("starts a new release history at Alpha1", () => {
    render(<ChangelogTab />);
    const current = screen.getByRole("button", { name: /0\.5\.0 Alpha1/ });
    expect(within(current).getByText("changelog.latest")).toBeInTheDocument();
    expect(within(current).getByText("2026-11-08")).toBeInTheDocument();
    expect(within(current).queryByText("changelog.unreleased")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /0\.4\./ })).not.toBeInTheDocument();
    expect(current).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: "阶段性精简" })).toBeInTheDocument();
    fireEvent.click(current);
    expect(current).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "阶段性精简" })).not.toBeInTheDocument();
    fireEvent.click(current);
  });

  it("can clear an empty search and restore the current release", () => {
    render(<ChangelogTab />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "no-such-change" } });
    expect(screen.queryByRole("button", { name: /0\.5\.0 Alpha1/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "changelog.clearSearch" }));
    expect(screen.getByRole("button", { name: /0\.5\.0 Alpha1/ })).toBeInTheDocument();
  });

  it("can find the current release by its change summary", () => {
    render(<ChangelogTab />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "过渡版本" } });
    expect(screen.getByRole("button", { name: /0\.5\.0 Alpha1/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /0\.4\.17/ })).not.toBeInTheDocument();
  });
});
