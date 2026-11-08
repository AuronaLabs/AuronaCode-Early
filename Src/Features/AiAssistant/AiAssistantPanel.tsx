import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AgentService } from "../../Core/Agent/AgentService";
import {
  getAgentPermission,
  syncAgentExecutorRegistration,
} from "../../Core/Agent/AgentToolExecutor";
import type { AgentEvent, AgentTaskSnapshot, AgentTaskStatus } from "../../Core/Agent/AgentTypes";
import { type AgentPermissionLevel, normalizeAgentPermission } from "../../Core/AiProfiles";
import { CommandRegistry } from "../../Core/Commands/CommandRegistry";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { Button } from "../../UI/Components/Button";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "../../UI/Components/DropdownMenu";
import { GlassList } from "../../UI/Components/GlassList";
import { Icons } from "../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../UI/Layouts/SidebarPage";
import { AgentMarkdown } from "./AgentMarkdown";
import "./AiAssistantPanel.css";

type ConversationItem =
  | { type: "user"; id: string; content: string }
  | { type: "assistant"; id: string; content: string }
  | {
      type: "tool";
      id: string;
      name: string;
      status: "running" | "completed" | "failed";
      input?: string;
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
  const name = [event.payload.name, event.payload.toolName, event.payload.tool_name].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return name?.trim() ?? "tool";
}

function buildTaskConversation(task: AgentTaskSnapshot): ConversationItem[] {
  const items: ConversationItem[] = [];
  const assistantByStep = new Map<string, ConversationItem & { type: "assistant" }>();
  const toolByStep = new Map<string, ConversationItem & { type: "tool" }>();

  const replaceItem = (id: string, update: (item: ConversationItem) => ConversationItem) => {
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return;
    items[index] = update(items[index]);
  };

  let hasUserEvent = false;
  for (const event of task.events) {
    if (event.type === "task.created" && eventText(event)) {
      items.push({ type: "user", id: `${task.id}-${event.id}`, content: eventText(event) });
      hasUserEvent = true;
      continue;
    }
    if (event.type === "step.delta" && event.stepId) {
      let item = assistantByStep.get(event.stepId);
      if (!item) {
        item = { type: "assistant", id: `${task.id}-assistant-${event.stepId}`, content: "" };
        assistantByStep.set(event.stepId, item);
        items.push(item);
      }
      const nextContent = item.content + eventText(event);
      replaceItem(item.id, (current) =>
        current.type === "assistant" ? { ...current, content: nextContent } : current,
      );
      assistantByStep.set(event.stepId, { ...item, content: nextContent });
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
        item = { type: "assistant", id: `${task.id}-assistant-${event.stepId}`, content: "" };
        assistantByStep.set(event.stepId, item);
        items.push(item);
      }
      if (event.payload.content) {
        const content = event.payload.content;
        replaceItem(item.id, (current) =>
          current.type === "assistant" ? { ...current, content } : current,
        );
        assistantByStep.set(event.stepId, { ...item, content });
      }
      continue;
    }
    if (event.type === "tool.requested" && event.stepId) {
      const item: ConversationItem & { type: "tool" } = {
        type: "tool",
        id: `${task.id}-tool-${event.stepId}`,
        name: toolName(event),
        status: "running",
        input: typeof event.payload.arguments === "string" ? event.payload.arguments : undefined,
        startedAt: event.timestamp,
      };
      toolByStep.set(event.stepId, item);
      items.push(item);
      continue;
    }
    if (event.type === "tool.started" && event.stepId) {
      const item = toolByStep.get(event.stepId);
      if (item) {
        replaceItem(item.id, (current) =>
          current.type === "tool" ? { ...current, status: "running" } : current,
        );
        toolByStep.set(event.stepId, { ...item, status: "running" });
      }
      continue;
    }
    if (event.type === "tool.completed" && event.stepId) {
      const item = toolByStep.get(event.stepId);
      if (item) {
        const status = event.payload.isError === true ? "failed" : "completed";
        const detail =
          typeof event.payload.content === "string"
            ? event.payload.content.slice(0, 4000) +
              (event.payload.content.length > 4000 ? "…" : "")
            : item.detail;
        replaceItem(item.id, (current) =>
          current.type === "tool"
            ? { ...current, status, completedAt: event.timestamp, detail }
            : current,
        );
        toolByStep.set(event.stepId, { ...item, status, completedAt: event.timestamp, detail });
      }
      continue;
    }
    if ((event.type === "task.queued" || event.type === "task.steered") && eventText(event)) {
      items.push({ type: "user", id: `${task.id}-${event.id}`, content: eventText(event) });
      continue;
    }
    if (event.type === "task.failed") {
      const message = eventText(event);
      if (message) items.push({ type: "error", id: `${task.id}-${event.id}`, content: message });
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

export function buildConversation(tasks: AgentTaskSnapshot[]): ConversationItem[] {
  return tasks
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .flatMap((task) => buildTaskConversation(task));
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

function taskStatusLabel(status: AgentTaskStatus, t: (key: I18nKey) => string): string {
  switch (status) {
    case "waiting_approval":
      return t("ai.agentUi.approvalRequired");
    case "planning":
    case "running":
    case "queued":
      return t("ai.agentUi.taskRunning");
    case "completed":
      return t("ai.agentUi.eventToolCompleted");
    case "failed":
      return t("ai.agentUi.taskFailed");
    case "paused":
      return t("ai.agentUi.taskPaused");
    case "aborted":
      return t("ai.agentUi.taskStopped");
    default:
      return t("ai.agentUi.newTask");
  }
}

const permissionLabelKeys: Record<AgentPermissionLevel, I18nKey> = {
  ask: "ai.agent.permissionAsk",
  read: "ai.agent.permissionRead",
  edit: "ai.agent.permissionEdit",
};

// Keep conversation drafts in memory when switching sessions or panels.
const sessionDrafts = new Map<string, string>();

export function AiAssistantPanel() {
  const snapshot = useSyncExternalStore(AgentService.subscribe, AgentService.getSnapshot);
  const { t } = useLocale();
  const task = snapshot.activeTask;
  const sessionId = snapshot.session?.id ?? task.sessionId ?? task.id;
  const [drafts, setDrafts] = useState(() => new Map(sessionDrafts));
  const draft = drafts.get(sessionId) ?? "";
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [permissionSaving, setPermissionSaving] = useState(false);
  const [showLatest, setShowLatest] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const followingRef = useRef(true);
  const conversationRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [agentPermission, setAgentPermission] = useState<AgentPermissionLevel>(() =>
    normalizeAgentPermission(getAgentPermission()),
  );
  const busy = isBusy(task.status);
  const canResume =
    task.status === "paused" || task.status === "aborted" || task.status === "failed";
  const activeProfile = snapshot.profiles.find(
    (profile) => profile.id === snapshot.activeProfileId,
  );
  const activeSession = snapshot.sessions.find((session) => session.id === sessionId);
  const conversation = useMemo(
    () => buildConversation(snapshot.sessionTasks.length > 0 ? snapshot.sessionTasks : [task]),
    [snapshot.sessionTasks, task],
  );
  const setSessionDraft = useCallback((id: string, value: string) => {
    sessionDrafts.set(id, value);
    setDrafts((current) => new Map(current).set(id, value));
  }, []);
  const setDraft = (value: string) => setSessionDraft(sessionId, value);
  const reportError = useCallback((cause: unknown) => setError(String(cause)), []);
  const openSettings = () => {
    void CommandRegistry.execute("workbench.action.openSettings", { section: "ai" }).then(
      (result) => {
        if (result.error) reportError(result.error);
      },
    );
  };

  useEffect(() => {
    void syncAgentExecutorRegistration()
      .then(() => setAgentPermission(normalizeAgentPermission(getAgentPermission())))
      .catch(reportError);
    void AgentService.refreshConfig().catch(reportError);
    return AgentService.subscribe(() =>
      setAgentPermission(normalizeAgentPermission(getAgentPermission())),
    );
  }, [reportError]);
  useEffect(() => {
    void sessionId;
    followingRef.current = true;
    setShowLatest(false);
    setError("");
    textareaRef.current?.focus();
  }, [sessionId]);
  useEffect(() => {
    void conversation;
    const element = conversationRef.current;
    if (element && followingRef.current) element.scrollTop = element.scrollHeight;
  }, [conversation]);
  useEffect(() => {
    void draft;
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${String(Math.min(200, Math.max(64, element.scrollHeight)))}px`;
  }, [draft]);
  useEffect(() => {
    if (!copiedId) return;
    const timer = window.setTimeout(() => setCopiedId(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copiedId]);

  const scrollToLatest = () => {
    followingRef.current = true;
    setShowLatest(false);
    const element = conversationRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  };
  const submit = async () => {
    const value = draft.trim();
    if (!value || !snapshot.configured || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    try {
      await syncAgentExecutorRegistration();
      const current = AgentService.getSnapshot();
      if (
        !current.configured ||
        (current.session?.id ?? current.activeTask.sessionId ?? current.activeTask.id) !== sessionId
      )
        return;
      if (sessionDrafts.get(sessionId) === draft) setSessionDraft(sessionId, "");
      followingRef.current = true;
      setShowLatest(false);
      void AgentService.send(value).catch((cause) => {
        if (!sessionDrafts.get(sessionId)) setSessionDraft(sessionId, draft);
        reportError(cause);
      });
      textareaRef.current?.focus();
    } catch (cause) {
      reportError(cause);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };
  const updatePermission = async (next: AgentPermissionLevel) => {
    if (permissionSaving) return;
    setPermissionSaving(true);
    try {
      await UserConfigStore.update((config) => ({ ai: { ...config.ai, agentPermission: next } }));
      await syncAgentExecutorRegistration();
      setAgentPermission(next);
    } catch (cause) {
      setAgentPermission(normalizeAgentPermission(getAgentPermission()));
      reportError(cause);
    } finally {
      setPermissionSaving(false);
    }
  };
  const copy = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
    } catch (cause) {
      reportError(cause);
    }
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="agent-panel">
      <SidebarPageHeader
        title={t("ai.agentUi.title")}
        actions={
          <>
            <button
              type="button"
              aria-label={t("ai.agentUi.openSettings")}
              onClick={openSettings}
              className="agent-icon-button"
            >
              <Icons.Settings size={16} />
            </button>
            <button
              type="button"
              disabled={busy}
              aria-label={t("ai.agentUi.newTask")}
              onClick={() => AgentService.newSession()}
              className="agent-icon-button"
            >
              <Icons.Plus size={18} />
            </button>
          </>
        }
      />
      <div className="agent-session-bar">
        <DropdownMenuRoot>
          <DropdownMenuTrigger
            disabled={busy}
            className="agent-session-trigger"
            aria-label={t("ai.agentUi.sessions")}
          >
            <Icons.History size={15} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              {activeSession?.title || task.title || t("ai.agentUi.newTask")}
            </span>
            <Icons.ChevronDown size={13} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="agent-session-menu">
            {[...snapshot.sessions]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((session) => (
                <DropdownMenuItem
                  key={session.id}
                  icon={
                    session.id === sessionId ? (
                      <Icons.Check size={14} />
                    ) : (
                      <Icons.History size={14} />
                    )
                  }
                  label={
                    <span className="block max-w-[230px] truncate">
                      {session.title || t("ai.agentUi.newTask")}
                    </span>
                  }
                  onSelect={() => void AgentService.switchSession(session.id).catch(reportError)}
                />
              ))}
          </DropdownMenuContent>
        </DropdownMenuRoot>
      </div>

      <main
        ref={conversationRef}
        className="agent-conversation aurona-scroll"
        aria-label={t("ai.agentUi.conversation")}
        onScroll={(event) => {
          const element = event.currentTarget;
          const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
          followingRef.current = atBottom;
          setShowLatest(!atBottom);
        }}
      >
        {snapshot.recoveryPending && (
          <div className="agent-inline-notice">
            <Icons.AlertTriangle size={16} />
            <span>{t("ai.agentUi.recoveryPending")}</span>
            <Button onClick={() => void AgentService.recoverPendingRestore().catch(reportError)}>
              {t("ai.agentUi.recoverRestore")}
            </Button>
          </div>
        )}
        {!snapshot.configured && !snapshot.recoveryPending && (
          <div className="agent-inline-notice">
            <Icons.Info size={16} />
            <span>
              {!snapshot.cardEnabled
                ? t("ai.agentUi.aiDisabled")
                : snapshot.agentEnabled
                  ? t("ai.agentUi.configureProfile")
                  : t("ai.agentUi.agentDisabled")}
            </span>
            <button type="button" className="agent-text-button" onClick={openSettings}>
              {t("ai.agentUi.openSettings")}
            </button>
          </div>
        )}
        {conversation.length === 0 ? (
          <div className="agent-empty-state">
            <Icons.Sparkles size={28} stroke={1.3} aria-hidden="true" />
            <h3>{t("ai.agentUi.emptyTitle")}</h3>
            <p>{t("ai.agentUi.emptyDescription")}</p>
            <div className="agent-starters">
              {(["Understand", "Review", "Verify"] as const).map((key) => (
                <button
                  type="button"
                  key={key}
                  disabled={!snapshot.configured}
                  onClick={() => {
                    setDraft(t(`ai.agentUi.starter${key}Prompt` as I18nKey));
                    textareaRef.current?.focus();
                  }}
                >
                  <span>{t(`ai.agentUi.starter${key}` as I18nKey)}</span>
                  <Icons.ArrowUp size={14} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="agent-message-list">
            {conversation.map((item) => {
              if (item.type === "user")
                return (
                  <div className="agent-message agent-message-user" key={item.id}>
                    {item.content}
                  </div>
                );
              if (item.type === "assistant")
                return (
                  <div className="agent-message agent-message-assistant" key={item.id}>
                    <AgentMarkdown content={item.content} />
                    <button
                      type="button"
                      className="agent-copy-button"
                      aria-label={t("common.copy")}
                      onClick={() => void copy(item.id, item.content)}
                    >
                      {copiedId === item.id ? <Icons.Check size={14} /> : <Icons.Copy size={14} />}
                      <span>{copiedId === item.id ? t("ai.copied") : t("common.copy")}</span>
                    </button>
                  </div>
                );
              if (item.type === "error")
                return (
                  <div role="alert" className="agent-message agent-message-error" key={item.id}>
                    {item.content}
                  </div>
                );
              if (item.type === "run-summary") {
                const duration = formatDuration(item.durationMs);
                const failed = item.tools.filter((tool) => tool.status === "failed").length;
                return (
                  <details className="agent-run-summary" key={item.id}>
                    <summary>
                      <Icons.ChevronRight size={14} className="agent-run-summary-chevron" />
                      <span>
                        {t("ai.agentUi.toolsUsed").replace("{count}", String(item.tools.length))}
                      </span>
                      {failed > 0 && (
                        <span className="agent-run-failed">
                          {t("ai.agentUi.toolsFailed").replace("{count}", String(failed))}
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
                        <ToolLine key={tool.id} item={tool} label={toolStatusLabel(tool, t)} />
                      ))}
                    </div>
                  </details>
                );
              }
              return <ToolLine key={item.id} item={item} label={toolStatusLabel(item, t)} />;
            })}
          </div>
        )}
      </main>
      {showLatest && (
        <button type="button" className="agent-jump-latest" onClick={scrollToLatest}>
          <Icons.ArrowDown size={14} />
          {t("ai.agentUi.latest")}
        </button>
      )}
      {task.pendingApproval && (
        <GlassList className="agent-approval">
          <div className="agent-approval-row">
            <Icons.ShieldCheck size={18} />
            <div>
              <strong>{t("ai.agentUi.approvalRequired")}</strong>
              <p>{task.pendingApproval.summary}</p>
              <details>
                <summary>{task.pendingApproval.toolName}</summary>
                <pre>{task.pendingApproval.args}</pre>
              </details>
            </div>
          </div>
        </GlassList>
      )}
      <div className="agent-composer-wrap">
        {error && (
          <div role="alert" className="agent-message-error">
            {error}
          </div>
        )}
        {(busy || canResume) && (
          <div className={`agent-progress agent-status-${task.status}`} role="status">
            <span className="agent-status-dot" />
            <span>{taskStatusLabel(task.status, t)}</span>
            {task.queuedInputs.length > 0 && (
              <span className="agent-queued">
                {t("ai.agentUi.queued").replace("{count}", String(task.queuedInputs.length))}
              </span>
            )}
            {canResume && (
              <button
                type="button"
                className="agent-text-button"
                disabled={!snapshot.configured}
                onClick={() => void AgentService.resume().catch(reportError)}
              >
                <Icons.Play size={13} />
                {t("ai.agentUi.resumeTask")}
              </button>
            )}
          </div>
        )}
        <div className="agent-composer">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            aria-label={t("ai.agentUi.taskPlaceholder")}
            placeholder={t(busy ? "ai.agentUi.followupPlaceholder" : "ai.agentUi.taskPlaceholder")}
          />
          <div className="agent-composer-footer">
            <div className="agent-composer-options">
              <DropdownMenuRoot>
                <DropdownMenuTrigger
                  className="agent-model-trigger"
                  disabled={busy || snapshot.profiles.length === 0}
                  aria-label={t("ai.profilesTitle")}
                >
                  <span className="truncate">
                    {activeProfile?.model || activeProfile?.name || t("ai.agentUi.noProfile")}
                  </span>
                  <Icons.ChevronDown size={12} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {snapshot.profiles.map((profile) => (
                    <DropdownMenuItem
                      key={profile.id}
                      label={
                        profile.model +
                        (profile.name && profile.name !== profile.model ? ` · ${profile.name}` : "")
                      }
                      icon={
                        profile.id === snapshot.activeProfileId ? (
                          <Icons.Check size={13} />
                        ) : undefined
                      }
                      onSelect={() =>
                        void AgentService.setActiveProfile(profile.id).catch(reportError)
                      }
                    />
                  ))}
                </DropdownMenuContent>
              </DropdownMenuRoot>
              <DropdownMenuRoot>
                <DropdownMenuTrigger
                  className="agent-permission-trigger"
                  aria-label={t("ai.agent.permissionTitle")}
                  disabled={busy || permissionSaving}
                >
                  <Icons.ShieldCheck size={13} />
                  <span className="truncate">{t(permissionLabelKeys[agentPermission])}</span>
                  <Icons.ChevronDown size={12} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {(Object.keys(permissionLabelKeys) as AgentPermissionLevel[]).map(
                    (permission) => (
                      <DropdownMenuItem
                        key={permission}
                        label={t(permissionLabelKeys[permission])}
                        onSelect={() => void updatePermission(permission)}
                      />
                    ),
                  )}
                </DropdownMenuContent>
              </DropdownMenuRoot>
            </div>
            <div className="agent-send-actions">
              {busy && (
                <button
                  type="button"
                  className="agent-stop-button"
                  aria-label={t("ai.agentUi.stopTask")}
                  onClick={() => void AgentService.abort().catch(reportError)}
                >
                  <Icons.Stop size={15} />
                </button>
              )}
              <Button
                variant="primary"
                size="icon"
                className="agent-send-button"
                aria-label={t(busy ? "ai.agentUi.queueTask" : "ai.agentUi.sendTask")}
                disabled={sending || !draft.trim() || !snapshot.configured}
                onClick={() => void submit()}
              >
                <Icons.ArrowUp size={17} />
              </Button>
            </div>
          </div>
        </div>
        <p className="agent-composer-hint">{t("ai.agentUi.composerHint")}</p>
      </div>
    </div>
  );
}

function ToolLine({
  item,
  label,
}: {
  item: Extract<ConversationItem, { type: "tool" }>;
  label: string;
}) {
  const { t } = useLocale();
  return (
    <details className={`agent-tool-line agent-tool-${item.status}`}>
      <summary>
        {item.status === "running" ? (
          <span className="agent-tool-dot" />
        ) : item.status === "failed" ? (
          <Icons.AlertTriangle size={13} />
        ) : (
          <Icons.Check size={13} />
        )}
        <span className="agent-tool-status">{label}</span>
        <code>{item.name}</code>
      </summary>
      {(item.input || item.detail) && (
        <dl className="agent-tool-detail">
          {item.input && (
            <>
              <dt>{t("common.input")}</dt>
              <dd>
                <pre>{item.input}</pre>
              </dd>
            </>
          )}
          {item.detail && (
            <>
              <dt>{t("common.content")}</dt>
              <dd>
                <pre>{item.detail}</pre>
              </dd>
            </>
          )}
        </dl>
      )}
    </details>
  );
}
