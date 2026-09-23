import type React from "react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type AiChatMessage, AiChatService, describeAiError } from "../../Core/AiChatService";
import { useLocale } from "../../Foundation/I18n";
import { cn } from "../../Shared/Utils/cn";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import { Badge } from "../../UI/Components/Badge";
import { Button } from "../../UI/Components/Button";
import { MarkdownRenderer } from "../../UI/Components/MarkdownRenderer";
import { Select } from "../../UI/Components/Select";
import { showConfirm } from "../../UI/Feedback/Toast";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../UI/Layouts/SidebarPage";

/**
 * 0.4.7 重做：AI 助手侧边栏（纯聊天）。
 * 状态机可视化（连接中/生成中·耗时/完成）、错误与内容分离 + 重试、
 * 多会话管理、消息与代码块复制、输入框自动增高、滚动到底。
 */

/** 会话选择器里标题的最大显示宽度（窄侧栏截断） */
function shortTitle(title: string, fallback: string): string {
  const text = title.trim() || fallback;
  return text.length > 8 ? `${text.slice(0, 8)}…` : text;
}

export function AiAssistantPanel() {
  const { t } = useLocale();
  const chat = useSyncExternalStore(AiChatService.subscribe, AiChatService.getSnapshot);
  const [draft, setDraft] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** 用户是否停留在底部附近（决定是否自动滚动与显示回底按钮） */
  const isNearBottomRef = useRef(true);
  const [isNearBottom, setIsNearBottom] = useState(true);

  // 挂载时刷新配置快照（设置保存后由 AiSettingsSection 通知刷新）
  useEffect(() => {
    void AiChatService.refreshConfig();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: messages 变化驱动自动滚动，内容本身不在 effect 内使用
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !isNearBottomRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [chat.messages]);

  // 输入框自动增高（1-8 行，封顶 128px 后内部滚动）
  // biome-ignore lint/correctness/useExhaustiveDependencies: draft 变化驱动高度自适应，内容本身不在 effect 内使用
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 128)}px`;
  }, [draft]);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const near = distance < 80;
    isNearBottomRef.current = near;
    setIsNearBottom(near);
  }, []);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || chat.phase !== "idle") return;
    setDraft("");
    void AiChatService.send(text);
  }, [chat.phase, draft]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleClear = useCallback(() => {
    showConfirm({
      title: t("ai.clearConfirmTitle"),
      message: t("ai.clearConfirmMessage"),
      confirmLabel: t("common.confirm"),
      cancelLabel: t("common.cancel"),
      onConfirm: () => AiChatService.clear(),
    });
  }, [t]);

  const hasMessages = chat.messages.length > 0;
  const generating = chat.phase !== "idle";

  return (
    <div className="flex h-full w-full flex-col bg-transparent">
      <SidebarPageHeader
        title={
          <>
            <Icons.Sparkles size={15} className="text-[var(--color-accent)]" />
            {t("ai.title")}
          </>
        }
        actions={
          <div className="flex items-center gap-0.5">
            {chat.sessions.length > 1 && (
              <Select
                value={chat.activeSessionId}
                onChange={(value) => void AiChatService.switchSession(value)}
                ariaLabel={t("ai.sessions")}
                className="h-7 min-w-0 w-[112px] rounded-lg text-[11px]"
                options={chat.sessions.map((session) => ({
                  value: session.id,
                  label: shortTitle(session.title, t("ai.untitledSession")),
                }))}
              />
            )}
            <Tooltip content={t("ai.newChat")} delay={300}>
              <button
                type="button"
                onClick={() => AiChatService.newSession()}
                className="cursor-pointer rounded-lg p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
              >
                <Icons.Plus size={14} />
              </button>
            </Tooltip>
            {hasMessages && (
              <Tooltip content={t("ai.clear")} delay={300}>
                <button
                  type="button"
                  onClick={handleClear}
                  className="cursor-pointer rounded-lg p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
                >
                  <Icons.Trash size={14} />
                </button>
              </Tooltip>
            )}
          </div>
        }
      />

      {/* 消息流 / 空态 */}
      {hasMessages ? (
        <div className="relative mx-[var(--PanelPaddingX)] mb-3 flex-1 overflow-hidden">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="h-full overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/30 p-3"
          >
            <div className="flex flex-col gap-3">
              {chat.messages.map((message) => (
                <AiChatBubble
                  key={message.id}
                  message={message}
                  onRetry={(id) => void AiChatService.retry(id)}
                />
              ))}
            </div>
          </div>
          {!isNearBottom && (
            <button
              type="button"
              onClick={() => {
                const element = scrollRef.current;
                if (element) element.scrollTop = element.scrollHeight;
              }}
              className="absolute bottom-3 right-4 flex cursor-pointer items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--material-surface)] px-2.5 py-1 text-[10.5px] text-[var(--color-text-secondary)] shadow-sm transition-colors hover:text-[var(--color-text-highlight)]"
            >
              <Icons.ArrowDown size={11} />
              {t("ai.scrollBottom")}
            </button>
          )}
        </div>
      ) : (
        <AiEmptyState
          configured={chat.configured}
          onQuickPrompt={(text) => {
            setDraft(text);
            textareaRef.current?.focus();
          }}
        />
      )}

      {/* 错误提示条（请求失败，发送下一条或重试后自动清除） */}
      {chat.lastError && !generating && (
        <div className="mx-[var(--PanelPaddingX)] mb-2 flex items-start gap-1.5 rounded-xl border border-[var(--StatusError)]/25 bg-[var(--StatusError)]/10 p-2.5 text-[11.5px] leading-4 text-[var(--color-text-primary)]">
          <Icons.AlertTriangle size={13} className="mt-0.5 shrink-0 text-[var(--StatusError)]" />
          <span className="min-w-0 break-words">{chat.lastError}</span>
        </div>
      )}

      {/* 生成状态条：连接中 → 生成中 · 已用时 */}
      {generating && <PhaseStatusBar phase={chat.phase} startedAtMs={chat.startedAtMs} />}

      {/* 底部输入区 */}
      <div className="mx-[var(--PanelPaddingX)] mb-3 shrink-0">
        <div className="flex items-end gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/30 p-2 focus-within:border-[var(--color-text-muted)]/25">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("ai.inputPlaceholder")}
            rows={1}
            className="max-h-32 min-h-9 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-2 text-[12.5px] leading-5 text-[var(--color-text-highlight)] outline-none placeholder:text-[var(--color-text-muted)]"
          />
          {generating ? (
            <Button
              variant="secondary"
              className="h-8 shrink-0 px-3"
              onClick={() => void AiChatService.abort()}
            >
              <Icons.Stop size={14} />
              {t("ai.stop")}
            </Button>
          ) : (
            <Button
              variant="primary"
              className="h-8 shrink-0 px-3"
              disabled={!draft.trim()}
              onClick={handleSend}
            >
              <Icons.ArrowUp size={14} />
              {t("ai.send")}
            </Button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-[10.5px] leading-4 text-[var(--color-text-muted)]">
          {t("ai.localNote")}
        </p>
      </div>
    </div>
  );
}

/** 生成状态条：连接中/生成中 + 实时耗时（1s 步进） */
function PhaseStatusBar({
  phase,
  startedAtMs,
}: {
  phase: "idle" | "connecting" | "streaming";
  startedAtMs: number | null;
}) {
  const { t } = useLocale();
  const [now, setNow] = useState(() => Date.now());
  // biome-ignore lint/correctness/useExhaustiveDependencies: startedAtMs 变化驱动计时器重启，取值不在 effect 内
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAtMs]);
  const seconds = startedAtMs == null ? 0 : Math.max(0, Math.floor((now - startedAtMs) / 1000));
  return (
    <div className="mx-[var(--PanelPaddingX)] mb-1.5 flex shrink-0 items-center gap-2 px-1 text-[11px] text-[var(--color-text-muted)]">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]"
      />
      {phase === "connecting"
        ? t("ai.phaseConnecting")
        : t("ai.phaseGenerating").replace("{seconds}", String(seconds))}
    </div>
  );
}

/** 复制文本钩子：返回 [已复制, 执行复制] */
function useCopyText(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
  const copy = useCallback((text: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // 剪贴板不可用时静默跳过
      });
  }, []);
  return [copied, copy];
}

/** 单条消息气泡 */
function AiChatBubble({
  message,
  onRetry,
}: {
  message: AiChatMessage;
  onRetry: (id: string) => void;
}) {
  const { t } = useLocale();
  const [copied, copy] = useCopyText();

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-[var(--color-accent)]/20 bg-[var(--color-accent)]/10 px-3.5 py-2 text-[12.5px] leading-5 text-[var(--color-text-primary)]">
          {message.content}
        </div>
      </div>
    );
  }

  const isError = message.status === "error";
  const isStopped = message.status === "stopped";
  const truncated = message.finishReason === "length";
  const hasToolCalls = (message.toolCalls?.length ?? 0) > 0;

  return (
    <div className="group flex justify-start">
      <div
        className={cn(
          "max-w-[92%] rounded-2xl rounded-bl-md border px-3.5 py-2",
          isError
            ? "border-[var(--StatusError)]/25 bg-[var(--StatusError)]/5"
            : "border-[var(--border-subtle)] bg-[var(--material-surface)]",
        )}
      >
        <MarkdownContent content={message.content} />
        {message.status === "streaming" || message.status === "pending" ? (
          <StreamingCursor />
        ) : null}

        {/* 错误卡片：与已生成内容分离展示，支持重试 */}
        {message.status === "error" && message.error && (
          <div className="mt-2 rounded-xl border border-[var(--StatusError)]/25 bg-[var(--StatusError)]/10 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] leading-4 text-[var(--color-text-primary)]">
                <Icons.AlertTriangle size={13} className="shrink-0 text-[var(--StatusError)]" />
                <span className="min-w-0 break-words">
                  {describeAiError(message.error.code, message.error.message)}
                </span>
              </span>
              <Button
                variant="secondary"
                className="h-7 shrink-0 px-2.5 text-[11px]"
                onClick={() => onRetry(message.id)}
              >
                <Icons.Refresh size={12} />
                {t("ai.retry")}
              </Button>
            </div>
            <p className="mt-1.5 break-words text-[10.5px] leading-4 text-[var(--color-text-muted)]">
              {message.error.message}
            </p>
          </div>
        )}

        {/* 元信息行：耗时 / 状态徽章 / 复制 */}
        {(message.status === "done" || isStopped) && (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {typeof message.durationMs === "number" && message.durationMs >= 0 && (
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  {t("ai.phaseDone").replace(
                    "{seconds}",
                    String(Math.max(1, Math.round(message.durationMs / 1000))),
                  )}
                </span>
              )}
              {isStopped && <Badge variant="neutral">{t("ai.stoppedNote")}</Badge>}
              {truncated && (
                <Badge variant="tint" color="var(--StatusWarning)">
                  {t("ai.truncatedNote")}
                </Badge>
              )}
            </div>
            {message.content !== "" && (
              <Tooltip content={copied ? t("ai.copied") : t("ai.copyMessage")} delay={300}>
                <button
                  type="button"
                  aria-label={copied ? t("ai.copied") : t("ai.copyMessage")}
                  onClick={() => copy(message.content)}
                  className="shrink-0 cursor-pointer rounded-lg p-1 text-[var(--color-text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] focus-visible:opacity-100"
                >
                  {copied ? <Icons.Check size={12} /> : <Icons.Copy size={12} />}
                </button>
              </Tooltip>
            )}
          </div>
        )}

        {/* 工具调用卡片（0.4.8 agent）：每次调用一张，实时反映执行状态与结果 */}
        {hasToolCalls && <ToolCallCards message={message} />}
      </div>
    </div>
  );
}

/** 参数摘要：解析 JSON 后逐键展示并截断 */
function summarizeArgs(argumentsJson: string): string {
  try {
    const parsed = JSON.parse(argumentsJson) as Record<string, unknown>;
    const parts = Object.entries(parsed).map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      const clipped = text.length > 48 ? `${text.slice(0, 48)}…` : text;
      return `${key}: ${clipped}`;
    });
    return parts.join(" · ");
  } catch {
    const clipped = argumentsJson.length > 80 ? `${argumentsJson.slice(0, 80)}…` : argumentsJson;
    return clipped || "(空参数)";
  }
}

/** 单条工具调用卡片 */
function ToolCallCards({ message }: { message: AiChatMessage }) {
  const { t } = useLocale();
  const calls = message.toolCalls ?? [];
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {calls.map((call) => {
        const callId = call.id ?? `call_${call.index}`;
        const result = message.toolResults?.find((item) => item.toolCallId === callId);
        const state = result
          ? result.isError
            ? "error"
            : "ok"
          : message.status === "done"
            ? "running"
            : "waiting";
        return (
          <div
            key={callId}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/40 px-2 py-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10.5px] text-[var(--color-text-highlight)]">
                <Icons.InfoCircle size={11} className="shrink-0 text-[var(--color-text-muted)]" />
                <span className="truncate">{call.name ?? "tool"}</span>
              </span>
              {state === "ok" && (
                <Badge variant="tint" color="var(--StatusSuccess)">
                  {t("ai.toolCardDone")}
                </Badge>
              )}
              {state === "error" && (
                <Badge variant="tint" color="var(--StatusError)">
                  {t("ai.toolCardFailed")}
                </Badge>
              )}
              {state === "running" && <Badge variant="tint">{t("ai.toolCardRunning")}</Badge>}
              {state === "waiting" && <Badge variant="neutral">{t("ai.toolCardWaiting")}</Badge>}
            </div>
            <p className="mt-0.5 break-words font-mono text-[10px] leading-4 text-[var(--color-text-muted)]">
              {summarizeArgs(call.arguments)}
            </p>
            {result && (
              <p
                className={cn(
                  "mt-0.5 break-words text-[10px] leading-4",
                  result.isError
                    ? "text-[var(--StatusError)]"
                    : "text-[var(--color-text-secondary)]",
                )}
              >
                {result.content.length > 140 ? `${result.content.slice(0, 140)}…` : result.content}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** AI 消息正文（Markdown 渲染；空内容时占位） */
function MarkdownContent({ content }: { content: string }) {
  if (!content) {
    return <p className="text-[12.5px] leading-5 text-[var(--color-text-muted)]">…</p>;
  }
  return (
    <div className="text-[12.5px]">
      <MarkdownRenderer content={content} />
    </div>
  );
}

/** 流式生成中的闪烁光标 */
function StreamingCursor() {
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-[2px] animate-pulse rounded-full bg-[var(--color-accent)]"
    />
  );
}

/**
 * 空态：未配置 → 引导卡（说明 + 去设置）；已配置 → 欢迎语 + 快捷提示
 */
function AiEmptyState({
  configured,
  onQuickPrompt,
}: {
  configured: boolean;
  onQuickPrompt: (text: string) => void;
}) {
  const { t } = useLocale();
  const openSettings = useWorkbenchStore((state) => state.openSettings);

  if (!configured) {
    return (
      <div className="mx-[var(--PanelPaddingX)] mb-3 flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto">
        <div className="flex w-full flex-col items-center gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/30 px-5 py-7 text-center">
          <Icons.Sparkles size={26} className="text-[var(--color-text-muted)]" />
          <p className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
            {t("ai.notConfiguredTitle")}
          </p>
          <p className="max-w-[260px] text-[11.5px] leading-5 text-[var(--color-text-muted)]">
            {t("ai.notConfiguredHint")}
          </p>
          <Button
            variant="primary"
            className="mt-1 h-8 px-4 text-[12px]"
            onClick={() => openSettings("ai")}
          >
            <Icons.Settings size={13} />
            {t("ai.goSettings")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-[var(--PanelPaddingX)] mb-3 flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto">
      <div className="flex flex-col items-center gap-2 text-center">
        <Icons.Sparkles size={26} className="text-[var(--color-accent)]" />
        <p className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
          {t("ai.welcomeTitle")}
        </p>
        <p className="max-w-[260px] text-[11.5px] leading-5 text-[var(--color-text-muted)]">
          {t("ai.welcomeHint")}
        </p>
      </div>
      <div className="flex w-full flex-col gap-1.5">
        {(["ai.quickPrompt1", "ai.quickPrompt2", "ai.quickPrompt3"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onQuickPrompt(t(key))}
            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/30 px-3.5 py-2 text-left text-[12px] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-text-muted)]/25 hover:text-[var(--color-text-highlight)]"
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}
