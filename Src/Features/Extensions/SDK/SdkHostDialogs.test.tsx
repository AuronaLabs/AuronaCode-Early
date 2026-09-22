import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SdkHostDialogs, showSdkInputBox, showSdkQuickPick } from "./SdkHostDialogs";

describe("SdkHostDialogs", () => {
  it("resolves quick-pick with the chosen item", async () => {
    render(<SdkHostDialogs />);
    let pending: Promise<{ label: string; description?: string } | undefined> | undefined;
    act(() => {
      pending = showSdkQuickPick(
        "demo.ext",
        [{ label: "Option A", description: "first" }, { label: "Option B" }],
        { title: "Pick one" },
      );
    });

    expect(await screen.findByText("Pick one")).toBeDefined();
    fireEvent.click(screen.getByText("Option A"));
    await expect(pending).resolves.toEqual({ label: "Option A", description: "first" });
  });

  it("submits input box value on Enter", async () => {
    render(<SdkHostDialogs />);
    let pending: Promise<string | undefined> | undefined;
    act(() => {
      pending = showSdkInputBox("demo.ext", { value: "seed", placeholder: "type-here" });
    });

    const input = (await screen.findByPlaceholderText("type-here")) as HTMLInputElement;
    expect(input.value).toBe("seed");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await expect(pending).resolves.toBe("hello");
  });

  it("resolves undefined when the dialog is cancelled", async () => {
    render(<SdkHostDialogs />);
    let pending: Promise<{ label: string } | undefined> | undefined;
    act(() => {
      pending = showSdkQuickPick("demo.ext", [{ label: "Only option" }]);
    });

    expect(await screen.findByText("Only option")).toBeDefined();
    fireEvent.keyDown(screen.getByText("Only option"), { key: "Escape" });
    await expect(pending).resolves.toBeUndefined();
  });
});
