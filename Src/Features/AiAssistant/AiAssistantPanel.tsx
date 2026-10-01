import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AgentService } from "../../Core/Agent/AgentService";
import type { AgentEvent, AgentTaskSnapshot, AgentTaskStatus } from "../../Core/Agent/AgentTypes";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import { Button } from "../../UI/Components/Button";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "../../UI/Components/DropdownMenu";
import { GlassList, glassListRowStyles } from "../../UI/Components/GlassList";
import { Icons } from "../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../UI/Layouts/SidebarPage";
import { AgentMarkdown } from "./AgentMarkdown";
import { syncAgentExecutorRegistration } from "./AgentToolExecutor";
import "./AiAssistantPanel.css";

type ConversationItem =
  | { type: "user"; id: string; content: string }
  | { type: "assistant"; id: string; content: string }
  | {
      type: "tool";
      id: string;
      name: string;
      status: "running" | "completed" | "failed";
      detail?: string;
      startedAt?: number;
      completedAt?: number;
    }
  | {
      type: "run-summary";
      id: string;
      status: "completed" | "failed" | "aborted";
      tools: Array<Extract<ConversationItem, { type: "tool" }>>;
      durationMs: number;
    }
  | { type: "error"; id: string; content: string };

function isBusy(status: AgentTaskStatus): boolean {
  return status === "planning" || status === "running" || status === "waiting_approval";
}

function eventText(event: AgentEvent): string {
  if (typeof event.payload.content === "string") return event.payload.content;
  if (typeof event.payload.message === "string") return event.payload.message;
  return "";
}

function toolName(event: AgentEvent): string {
  return typeof event.payload.name === "string" && event.payload.name.trim()
    ? event.payload.name.trim()
    : "tool";
}

function buildConversation(task: AgentTaskSnapshot): ConversationItem[] {
  const items: ConversationItem[] = [];
  const assistantByStep = new Map<string, ConversationItem & { type: "assistant" }>();
  const toolByStep = new Map<string, ConversationItem & { type: "tool" }>();

  let hasUserEvent = false;
  for (const event of task.events) {
    if (event.type === "task.created" && eventText(event)) {
      items.push({ type: "user", id: event.id, content: eventText(event) });
      hasUserEvent = true;
      continue;
    }
    if (event.type === "step.delta" && event.stepId) {
      let item = assistantByStep.get(event.stepId);
      if (!item) {
        item = { type: "assistant", id: `assistant-${event.stepId}`, content: "" };
        assistantByStep.set(event.stepId, item);
        items.push(item);
      }
      item.content += eventText(event);
      continue;
    }
    if (
      event.type === "step.completed" &&
      event.stepId &&
      !toolByStep.has(event.stepId) &&
      typeof event.payload.content === "string"
    ) {
      let item = assistantByStep.get(event.stepId);
      if (!item) {
        item = { type: "assistant", id: `assistant-${event.stepId}`, content: "" };
        assistantByStep.set(event.stepId, item);
        items.push(item);
      }
      if (!item.content) item.content = event.payload.content;
      continue;
    }
    if (event.type === "tool.requested" && event.stepId) {
      const item: ConversationItem & { type: "tool" } = {
        type: "tool",
        id: `tool-${event.stepId}`,
        name: toolName(event),
        status: "running",
        startedAt: event.timestamp,
      };
      toolByStep.set(event.stepId, item);
      items.push(item);
      continue;
    }
    if (event.type === "tool.started" && event.stepId) {
      const item = toolByStep.get(event.stepId);
      if (item) item.status = "running";
      continue;
    }
    if (event.type === "tool.completed" && event.stepId) {
      const item = toolByStep.get(event.stepId);
      if (item) {
        item.status = event.payload.isError === true ? "failed" : "completed";
        item.completedAt = event.timestamp;
        if (item.status === "failed" && typeof event.payload.content === "string") {
          item.detail = event.payload.content.slice(0, 220);
        }
      }
      continue;
    }
    if ((event.type === "task.queued" || event.type === "task.steered") && eventText(event)) {
      items.push({ type: "user", id: event.id, content: eventText(event) });
      continue;
    }
    if (event.type === "task.failed") {
      const message = eventText(event);
      if (message) items.push({ type: "error", id: event.id, content: message });
    }
  }

  if (!hasUserEvent && task.input.trim()) {
    items.unshift({ type: "user", id: `${task.id}-input`, content: task.input });
  }

  // Keep the complete persisted conversation available for scrolling. The session store
  // already applies the event retention policy; trimming again here made older messages
  // disappear as soon as a conversation grew beyond the UI limit.
  const visibleItems = items.filter((item) => item.type !== "assistant" || item.content.trim());
  const toolItems = visibleItems.filter(
    (item): item is Extract<ConversationItem, { type: "tool" }> => item.type === "tool",
  );
  const isTerminal =
    task.status === "completed" || task.status === "failed" || task.status === "aborted";
  if (isTerminal && toolItems.length > 0) {
    const firstToolIndex = visibleItems.findIndex((item) => item.type === "tool");
    const start =
      task.events.find((item) => item.type === "task.created")?.timestamp ?? task.createdAt;
    const end =
      [...task.events]
        .reverse()
        .find((item) => ["task.completed", "task.failed", "task.aborted"].includes(item.type))
        ?.timestamp ?? task.updatedAt;
    const terminalStatus: "completed" | "failed" | "aborted" =
      task.status === "completed" ? "completed" : task.status === "failed" ? "failed" : "aborted";
    const summary: ConversationItem = {
      type: "run-summary",
      id: `${task.id}-run-summary`,
      status: terminalStatus,
      tools: toolItems,
      durationMs: Math.max(0, end - start),
    };
    return [
      ...visibleItems.slice(0, firstToolIndex).filter((item) => item.type !== "tool"),
      summary,
      ...visibleItems.slice(firstToolIndex).filter((item) => item.type !== "tool"),
    ];
  }
  return visibleItems;
}

function toolStatusLabel(
  item: ConversationItem & { type: "tool" },
  t: (key: I18nKey) => string,
): string {
  if (item.status === "failed") return t("ai.agentUi.eventToolFailed");
  if (item.status === "completed") return t("ai.agentUi.eventToolCompleted");
  return t("ai.agentUi.eventToolRunning");
}

function formatDuration(durationMs: number): { minutes: number; seconds: number } {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  return { minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 };
}

export function AiAssistantPanel() {
  const snapshot = useSyncExternalStore(AgentService.subscribe, AgentService.getSnapshot);
  const { t } = useLocale();
  const [draft, setDraft] = useState("");
  const task = snapshot.activeTask;
  const busy = isBusy(task.status);
  const canResume =
    task.status === "paused" || task.status === "aborted" || task.status === "failed";
  const activeProfile = snapshot.profiles.find(
    (profile) => profile.id === snapshot.activeProfileId,
  );
  const conversation = useMemo(() => buildConversation(task), [task]);

  useEffect(() => {
    void syncAgentExecutorRegistration();
    void AgentService.refreshConfig();
  }, []);

  const submit = useCallback(async () => {
    const value = draft.trim();
    if (!value || !snapshot.configured) return;
    setDraft("");
    await syncAgentExecutorRegistration();
    void AgentService.send(value);
  }, [draft, snapshot.configured]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const handleAction = () => {
    if (busy) {
      void AgentService.abort();
      return;
    }
    if (canResume && !draft.trim()) {
      void AgentService.resume();
      return;
    }
    void submit();
  };

  const actionLabel = busy
    ? t("ai.agentUi.stopTask")
    : canResume && !draft.trim()
      ? t("ai.agentUi.resumeTask")
      : t("ai.agentUi.sendTask");

  return (
    <div className="agent-panel">
      <SidebarPageHeader
        title={t("ai.agentUi.title")}
        actions={
          <button
            type="button"
            aria-label={t("ai.agentUi.newTask")}
            onClick={() => AgentService.newSession()}
            className="agent-icon-button"
          >
            <Icons.Plus size={15} />
          </button>
        }
      />

      <div className="agent-session-bar">
        <DropdownMenuRoot>
          <DropdownMenuTrigger className={`${glassListRowStyles} agent-session-trigger`}>
            <Icons.Compass size={14} />
            <span className="min-w-0 flex-1 truncate">{task.title || t("ai.agentUi.newTask")}</span>
            <Icons.ChevronDown size={12} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[240px] max-w-[320px]">
            {snapshot.sessions.map((session) => (
              <DropdownMenuItem
                key={session.id}
                label={<span className="truncate">{session.title || t("ai.agentUi.newTask")}</span>}
                onSelect={() => void AgentService.switchSession(session.id)}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenuRoot>
      </div>

      <main className="agent-conversation" aria-live="polite">
        {!snapshot.configured && (
          <div className="agent-inline-notice">
            <Icons.AlertTriangle size={14} />
            <span>{t("ai.agentUi.configureProfile")}</span>
          </div>
        )}
        {conversation.length === 0 ? (
          <div className="agent-empty-state">
            <strong>{t("ai.agentUi.emptyTitle")}</strong>
            <span>{t("ai.agentUi.emptyDescription")}</span>
          </div>
        ) : (
          <div className="agent-message-list">
            {conversation.map((item) => {
              if (item.type === "user") {
                return (
                  <div className="agent-message agent-message-user" key={item.id}>
                    {item.content}
                  </div>
                );
              }
              if (item.type === "assistant") {
                return (
                  <div className="agent-message agent-message-assistant" key={item.id}>
                    <AgentMarkdown content={item.content} />
                  </div>
                );
              }
              if (item.type === "error") {
                return (
                  <div className="agent-message agent-message-error" key={item.id}>
                    {item.content}
                  </div>
                );
              }
              if (item.type === "run-summary") {
                const duration = formatDuration(item.durationMs);
                const failedCount = item.tools.filter((tool) => tool.status === "failed").length;
                return (
                  <details className={`agent-run-summary agent-run-${item.status}`} key={item.id}>
                    <summary>
                      <span className="agent-run-summary-chevron">
                        <Icons.ChevronRight size={13} />
                      </span>
                      <span>
                        {t("ai.agentUi.toolsUsed").replace("{count}", String(item.tools.length))}
                      </span>
                      {failedCount > 0 && (
                        <span className="agent-run-failed">
                          {t("ai.agentUi.toolsFailed").replace("{count}", String(failedCount))}
                        </span>
                      )}
                      <span className="agent-run-duration">
                        {t("ai.agentUi.duration")
                          .replace("{minutes}", String(duration.minutes))
                          .replace("{seconds}", String(duration.seconds))}
                      </span>
                    </summary>
                    <div className="agent-run-details">
                      {item.tools.map((tool) => (
                        <div className={`agent-tool-line agent-tool-${tool.status}`} key={tool.id}>
                          <span className="agent-tool-dot" />
                          <span className="agent-tool-status">{toolStatusLabel(tool, t)}</span>
                          <code>{tool.name}</code>
                          {tool.detail && <span className="agent-tool-detail">{tool.detail}</span>}
                        </div>
                      ))}
                    </div>
                  </details>
                );
              }
              return (
                <div className={`agent-tool-line agent-tool-${item.status}`} key={item.id}>
                  <span className="agent-tool-dot" />
                  <span className="agent-tool-status">{toolStatusLabel(item, t)}</span>
                  <code>{item.name}</code>
                  {item.detail && <span className="agent-tool-detail">{item.detail}</span>}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {task.pendingApproval && (
        <GlassList className="agent-approval">
          <div className="agent-approval-row">
            <Icons.ShieldCheck size={15} />
            <div>
              <strong>{t("ai.agentUi.approvalRequired")}</strong>
              <span>{task.pendingApproval.summary}</span>
            </div>
          </div>
        </GlassList>
      )}

      <div className="agent-composer-wrap">
        <div className="agent-composer">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            placeholder={t("ai.agentUi.taskPlaceholder")}
          />
          <div className="agent-composer-footer">
            <DropdownMenuRoot>
              <DropdownMenuTrigger
                className="agent-model-trigger"
                disabled={busy || snapshot.profiles.length === 0}
              >
                <span className="truncate">
                  {activeProfile?.model || activeProfile?.name || t("ai.agentUi.noProfile")}
                </span>
                <Icons.ChevronDown size={12} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[210px]">
                {snapshot.profiles.map((profile) => (
                  <DropdownMenuItem
                    key={profile.id}
                    label={
                      <span className="truncate">
                        {profile.model}
                        {profile.name && profile.name !== profile.model ? ` · ${profile.name}` : ""}
                      </span>
                    }
                    onSelect={() => void AgentService.setActiveProfile(profile.id)}
                  />
                ))}
              </DropdownMenuContent>
            </DropdownMenuRoot>
            <Button
              variant="primary"
              size="icon"
              className="size-8"
              aria-label={actionLabel}
              disabled={!busy && !canResume && (!draft.trim() || !snapshot.configured)}
              onClick={handleAction}
            >
              {busy ? (
                <Icons.Stop size={15} />
              ) : canResume && !draft.trim() ? (
                <Icons.Play size={15} />
              ) : (
                <Icons.ArrowUp size={15} />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
