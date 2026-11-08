import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../Foundation/EventBus";
import { requestSettingsSection, takeSettingsSection } from "./SettingsNavigation";

describe("settings destinations", () => {
  afterEach(() => {
    takeSettingsSection();
  });

  it("retains an AI destination until the settings view mounts", () => {
    requestSettingsSection("ai");
    expect(takeSettingsSection()).toBe("ai");
    expect(takeSettingsSection()).toBeUndefined();
  });

  it("notifies an already active view and keeps only the latest request", () => {
    const listener = vi.fn();
    const unsubscribe = EventBus.on("settings:nav", listener);
    requestSettingsSection("general");
    requestSettingsSection("ai");
    expect(listener).toHaveBeenLastCalledWith("ai");
    expect(takeSettingsSection()).toBe("ai");
    unsubscribe();
  });
});
