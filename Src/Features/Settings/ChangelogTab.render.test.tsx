import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../Foundation/I18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

import { ChangelogTab } from "./ChangelogTab";

describe("changelog release status", () => {
  afterEach(cleanup);

  it("shows the latest published release and the previous release date", () => {
    render(<ChangelogTab />);
    const current = screen.getByRole("button", { name: /0\.4\.18/ });
    expect(within(current).getByText("changelog.latest")).toBeInTheDocument();
    expect(within(current).getByText("2026-11-07")).toBeInTheDocument();
    expect(within(current).queryByText("changelog.unreleased")).not.toBeInTheDocument();
    const previous = screen.getByRole("button", { name: /0\.4\.17/ });
    expect(within(previous).queryByText("changelog.latest")).not.toBeInTheDocument();
    expect(within(previous).getByText("2026-10-25")).toBeInTheDocument();
  });

  it("can find the current release by its change summary", () => {
    render(<ChangelogTab />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "资源生命周期" } });
    expect(screen.getByRole("button", { name: /0\.4\.18/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /0\.4\.17/ })).not.toBeInTheDocument();
  });
});
