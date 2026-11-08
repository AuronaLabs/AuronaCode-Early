import { EventBus } from "../../Foundation/EventBus";
import type { SettingsSection } from "../../Foundation/Types/Settings";

// Retain a destination until settings mounts or becomes active.
let pendingSection: SettingsSection | undefined;

export function requestSettingsSection(section: SettingsSection): void {
  pendingSection = section;
  EventBus.emit("settings:nav", section);
}

export function takeSettingsSection(): SettingsSection | undefined {
  const section = pendingSection;
  pendingSection = undefined;
  return section;
}
