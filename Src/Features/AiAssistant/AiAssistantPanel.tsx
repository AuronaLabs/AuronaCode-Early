import type React from "react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AiChatService } from "../../Core/AiChatService";
import { useLocale } from "../../Foundation/I18n";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import { Button } from "../../UI/Components/Button";
import { MarkdownRenderer } from "../../UI/Components/MarkdownRenderer";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../UI/Layouts/SidebarPage";

/**
 * 0.4.6 批次 5：AI 助手侧边栏卡片（纯聊天）。
 * 定位：可用的 LLM 流式纯聊天；不接编辑器上下文、不做 agent/工具/RAG。
 */
export function AiAssistantPanel() {
  const { t } = useLocale();
  const chat = useSyncExternalStore(AiChatService.subscribe, AiChatService.getSnapshot);
  const [draft, setDraft] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  /** 用户是否停留在底部附近（决定是否自动滚动） */
  const isNearBottomRef = useRef(true);

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

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    isNearBottomRef.current = distance < 80;
  }, []);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || chat.isGenerating) return;
    setDraft("");
    void AiChatService.send(text);
  }, [chat.isGenerating, draft]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSend();
    }
  };

  const hasMessages = chat.messages.length > 0;

  return (
    <div className="flex h-full w-full flex-col select-none bg-transparent">
      <SidebarPageHeader
        title={
          <>
            <Icons.Sparkles size={15} className="text-[var(--color-accent)]" />
            {t("ai.title")}
          </>
        }
        actions={
          hasMessages ? (
            <Tooltip content={t("ai.clear")} delay={300}>
              <button
                type="button"
                onClick={() => void AiChatService.clear()}
                className="cursor-pointer rounded-lg p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
              >
                <Icons.Trash size={14} />
              </button>
            </Tooltip>
          ) : undefined
        }
      />

      {/* 消息流 / 空态 */}
      {hasMessages ? (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="mx-[var(--PanelPaddingX)] mb-3 flex-1 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/30 p-3"
        >
          <div className="flex flex-col gap-3">
            {chat.messages.map((message) => (
              <AiChatBubble key={message.id} message={message} />
            ))}
          </div>
        </div>
      ) : (
        <AiEmptyState configured={chat.configured} onQuickPrompt={setDraft} />
      )}

      {/* 错误提示条（未配置/请求失败） */}
      {chat.lastError && !hasMessages && (
        <div className="mx-[var(--PanelPaddingX)] mb-2 rounded-xl border border-[var(--StatusError)]/25 bg-[var(--StatusError)]/10 p-2.5 text-[11.5px] leading-4 text-[var(--color-text-primary)]">
          {chat.lastError}
        </div>
      )}

      {/* 底部输入区 */}
      <div className="mx-[var(--PanelPaddingX)] mb-3 shrink-0">
        <div className="flex items-end gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/30 p-2 focus-within:border-[var(--color-text-muted)]/25">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("ai.inputPlaceholder")}
            rows={2}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1 text-[12.5px] leading-5 text-[var(--color-text-highlight)] outline-none placeholder:text-[var(--color-text-muted)]"
          />
          {chat.isGenerating ? (
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

/** 单条消息气泡 */
function AiChatBubble({
  message,
}: {
  message: {
    role: "user" | "assistant";
    content: string;
    streaming?: boolean;
    error?: boolean;
  };
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-[var(--color-accent)]/20 bg-[var(--color-accent)]/10 px-3.5 py-2 text-[12.5px] leading-5 text-[var(--color-text-primary)]">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[92%] break-words rounded-2xl rounded-bl-md border px-3.5 py-2 ${
          message.error
            ? "border-[var(--StatusError)]/25 bg-[var(--StatusError)]/10"
            : "border-[var(--border-subtle)] bg-[var(--material-surface)]"
        }`}
      >
        <MarkdownContent content={message.content} />
        {message.streaming && <StreamingCursor />}
      </div>
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
