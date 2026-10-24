import type { AgentPermissionLevel } from "../AiProfiles";
import type { AgentToolMetadata } from "./AgentTypes";

export type AgentToolAuthorization = "allow" | "confirm" | "deny";

export function resolveAgentToolAuthorization(
  permission: AgentPermissionLevel,
  tool: Pick<AgentToolMetadata, "permission" | "effects"> & {
    requiresConfirmation?: boolean;
  },
  options: { requireWriteApproval: boolean; requireCommandApproval: boolean },
): AgentToolAuthorization {
  const hasProcessEffect = tool.effects.some(
    (effect) => effect === "process.execute" || effect === "command.execute",
  );
  const hasWriteEffect = tool.effects.some((effect) =>
    ["filesystem.write", "workspace.modify", "workspace.change", "editor.modify"].includes(effect),
  );
  const hasUnclassifiedEffect = tool.effects.some((effect) => {
    const isProcess = effect === "process.execute" || effect === "command.execute";
    const isWrite = [
      "filesystem.write",
      "workspace.modify",
      "workspace.change",
      "editor.modify",
    ].includes(effect);
    return !effect.endsWith(".read") && !isProcess && !isWrite;
  });
  if (permission === "ask") return "confirm";
  if (
    permission === "read" &&
    (tool.permission !== "read" || hasProcessEffect || hasWriteEffect || hasUnclassifiedEffect)
  ) {
    return "deny";
  }
  if (permission === "read" && tool.permission === "read" && !tool.requiresConfirmation) {
    return "allow";
  }
  if (hasUnclassifiedEffect) return "confirm";
  if (!hasProcessEffect && !hasWriteEffect) {
    return tool.permission === "approval-required" || tool.requiresConfirmation
      ? "confirm"
      : "allow";
  }
  return (hasProcessEffect && options.requireCommandApproval) ||
    (hasWriteEffect && options.requireWriteApproval)
    ? "confirm"
    : "allow";
}

export function shouldCreateAgentCheckpoint(
  metadata: AgentToolMetadata | undefined,
  enabled: boolean,
): boolean {
  if (!enabled || !metadata) return false;
  if (metadata.checkpointPolicy === "always") return true;
  if (metadata.checkpointPolicy !== "before-write") return false;
  return metadata.effects.some((effect) =>
    ["filesystem.write", "workspace.modify", "workspace.change", "editor.modify"].includes(effect),
  );
}
