import type React from "react";
import { useEffect, useRef, useState } from "react";
import { AiChatService } from "../../Core/AiChatService";
import { resolveAiProfiles } from "../../Core/AiProfiles";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { AiPreferences, AiProfile } from "../../Foundation/Types/Config";
import { Badge } from "../../UI/Components/Badge";
import { Button } from "../../UI/Components/Button";
import { Input } from "../../UI/Components/Input";
import { Select } from "../../UI/Components/Select";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { showConfirm, showToast } from "../../UI/Feedback/Toast";
import { Icons } from "../../UI/Icons/IconManager";
import { syncAgentExecutorRegistration } from "../AiAssistant/AgentToolExecutor";

/** 0.4.9：AI 多模型配置档设置（列表 / 展开编辑 / 删除确认 / 激活切换 / 测试连接）。 */

type AiProvider = NonNullable<AiPreferences["provider"]>;

/** 服务商预设默认 baseUrl（custom 为空，可覆盖编辑） */
const PROVIDER_BASE_URLS: Record<AiProvider, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  openrouter: "https://openrouter.ai/api/v1",
  custom: "",
};

/** 各服务商模型名占位提示 */
const PROVIDER_MODEL_PLACEHOLDERS: Record<AiProvider, string> = {
  openai: "gpt-4o-mini",
  deepseek: "deepseek-chat",
  openrouter: "openai/gpt-4o-mini",
  custom: "chat 模型名称",
};

const PROVIDER_LABEL_KEY: Record<AiProvider, I18nKey> = {
  openai: "ai.providerOpenai",
  deepseek: "ai.providerDeepseek",
  openrouter: "ai.providerOpenrouter",
  custom: "ai.providerCustom",
};

/** 测试连接状态机：idle 未测 / testing 进行中 / ok 成功 / auth 认证失败 / network 不可达 / incomplete 信息不全 */
type TestStatus = "idle" | "testing" | "ok" | "auth" | "network" | "incomplete";

/** 展开编辑器状态（isNew 标记新增，保存时 append 而非替换） */
interface ProfileEditorState {
  isNew: boolean;
  draft: AiProfile;
}

/** 生成配置档 id（uuid，冲突时兜底时间戳） */
function createProfileId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** 写入 UserConfig 的 ai 段并通知服务刷新配置快照 */
async function writeAi(patch: Partial<AiPreferences>): Promise<void> {
  const config = await UserConfigStore.get();
  await UserConfigStore.set({ ai: { ...config.ai, ...patch } });
  await AiChatService.refreshConfig();
}

export function AiSettingsSection() {
  const { t } = useLocale();
  const [enabled, setEnabled] = useState(true);
  const [agentEnabled, setAgentEnabled] = useState(true);
  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [editor, setEditor] = useState<ProfileEditorState | null>(null);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    UserConfigStore.get().then((config) => {
      setEnabled(config.ai?.enabled ?? true);
      setAgentEnabled(config.ai?.agentEnabled !== false);
      const resolved = resolveAiProfiles(config.ai);
      setProfiles(resolved.profiles);
      setActiveProfileId(resolved.active?.id ?? null);
    });
  }, []);

  // 卸载时中止进行中的测试连接
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const handleEnabledChange = (next: boolean) => {
    setEnabled(next);
    void writeAi({ enabled: next });
  };

  const handleAgentEnabledChange = (next: boolean) => {
    setAgentEnabled(next);
    void writeAi({ agentEnabled: next });
    syncAgentExecutorRegistration();
  };

  /** 点击条目行激活配置档（顶栏快捷切换与设置页共用 setActiveProfile） */
  const activateProfile = async (id: string) => {
    if (id === activeProfileId) return;
    setActiveProfileId(id);
    await AiChatService.setActiveProfile(id);
    showToast(t("ai.profileActivated"), "success");
  };

  const startAddProfile = () => {
    setTestStatus("idle");
    setEditor({
      isNew: true,
      draft: {
        id: createProfileId(),
        name: "",
        provider: "openai",
        baseUrl: PROVIDER_BASE_URLS.openai,
        apiKey: "",
        model: "",
      },
    });
  };

  const startEditProfile = (profile: AiProfile) => {
    setTestStatus("idle");
    setEditor({ isNew: false, draft: { ...profile } });
  };

  const updateDraft = (patch: Partial<AiProfile>) => {
    setEditor((prev) => (prev ? { ...prev, draft: { ...prev.draft, ...patch } } : prev));
    if (testStatus !== "idle" && testStatus !== "testing") setTestStatus("idle");
  };

  /** 服务商切换：预设自动填默认 baseUrl，custom 清空可手工编辑 */
  const handleDraftProviderChange = (next: AiProvider) => {
    updateDraft({ provider: next, baseUrl: PROVIDER_BASE_URLS[next] });
  };

  const closeEditor = () => {
    abortRef.current?.abort();
    setEditor(null);
    setTestStatus("idle");
  };

  /** 保存编辑器：新增 append / 编辑替换；激活档失效时回退首条 */
  const saveEditor = async () => {
    if (!editor) return;
    const draft: AiProfile = {
      ...editor.draft,
      name: editor.draft.name.trim(),
      baseUrl: editor.draft.baseUrl.trim(),
      apiKey: editor.draft.apiKey.trim(),
      model: editor.draft.model.trim(),
    };
    const next = editor.isNew
      ? [...profiles, draft]
      : profiles.map((item) => (item.id === draft.id ? draft : item));
    const stillValid = next.some((item) => item.id === activeProfileId);
    const nextActiveId = stillValid ? activeProfileId : (next[0]?.id ?? null);
    setProfiles(next);
    setActiveProfileId(nextActiveId);
    closeEditor();
    await writeAi({ profiles: next, activeProfileId: nextActiveId ?? undefined });
    showToast(t("ai.profileSaved"), "success");
  };

  /** 删除配置档：二次确认；删除激活档时回退剩余首条 */
  const deleteProfile = (id: string) => {
    const target = profiles.find((item) => item.id === id);
    if (!target) return;
    showConfirm({
      title: t("ai.profileDeleteConfirmTitle"),
      message: t("ai.profileDeleteConfirmMessage"),
      confirmLabel: t("ai.profileDeleteAction"),
      onConfirm: async () => {
        const next = profiles.filter((item) => item.id !== id);
        const nextActiveId = next.some((item) => item.id === activeProfileId)
          ? activeProfileId
          : (next[0]?.id ?? null);
        setProfiles(next);
        setActiveProfileId(nextActiveId);
        if (editor?.draft.id === id) closeEditor();
        await writeAi({ profiles: next, activeProfileId: nextActiveId ?? undefined });
        showToast(t("ai.profileDeleted"), "success");
      },
    });
  };

  /** 测试连接：GET {baseUrl}/models + Bearer Key，15s 超时；401/403 判认证失败 */
  const testConnection = async () => {
    if (!editor || testStatus === "testing") return;
    const baseUrl = editor.draft.baseUrl.trim();
    const apiKey = editor.draft.apiKey.trim();
    if (!baseUrl || !apiKey) {
      setTestStatus("incomplete");
      return;
    }
    setTestStatus("testing");
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (response.ok) setTestStatus("ok");
      else if (response.status === 401 || response.status === 403) setTestStatus("auth");
      else setTestStatus("network");
    } catch {
      // 超时（abort）与 DNS/连接失败统一按网络不可达处理
      setTestStatus("network");
    } finally {
      clearTimeout(timer);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const handleRowKeyDown = (event: React.KeyboardEvent, id: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void activateProfile(id);
    }
  };

  const testHint: { key: I18nKey; className: string } | null =
    testStatus === "ok"
      ? { key: "ai.profileTestOk", className: "text-[var(--StatusSuccess)]" }
      : testStatus === "auth"
        ? { key: "ai.profileTestAuth", className: "text-[var(--StatusError)]" }
        : testStatus === "network"
          ? { key: "ai.profileTestNetwork", className: "text-[var(--StatusError)]" }
          : testStatus === "incomplete"
            ? {
                key: "ai.profileTestIncomplete",
                className: "text-[var(--color-text-muted)]",
              }
            : null;

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-[16px] font-bold text-[var(--color-text-highlight)]">
          {t("settings.categories.ai")}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)]">{t("ai.settingsDescription")}</p>
      </div>

      <GlassContainer layer="raised" className="overflow-hidden">
        {/* 启用侧边栏 AI 卡片 */}
        <div
          data-setting-id="aiEnabled"
          className="flex min-h-14 items-center justify-between gap-6 p-5"
        >
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("ai.settingsEnabledTitle")}
            </div>
            <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-muted)]">
              {t("ai.settingsEnabledDesc")}
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={handleEnabledChange} />
        </div>

        {/* 启用 agent 工具执行 */}
        <div
          data-setting-id="aiAgentEnabled"
          className="flex min-h-14 items-center justify-between gap-6 border-t border-[var(--border-subtle)] p-5"
        >
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("ai.agent.settingsTitle")}
            </div>
            <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-muted)]">
              {t("ai.agent.settingsDesc")}
            </p>
          </div>
          <Switch checked={agentEnabled} onCheckedChange={handleAgentEnabledChange} />
        </div>

        {/* 模型配置：标题行 + 添加入口 */}
        <div
          data-setting-id="aiProfiles"
          className="flex min-h-14 items-center justify-between gap-6 border-t border-[var(--border-subtle)] p-5"
        >
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("ai.profilesTitle")}
            </div>
            <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-muted)]">
              {t("ai.profilesDesc")}
            </p>
          </div>
          <Button
            variant="secondary"
            className="h-8 shrink-0 px-3 text-[12px]"
            onClick={startAddProfile}
          >
            <Icons.Plus size={14} />
            {t("ai.profileAdd")}
          </Button>
        </div>

        {/* 配置档条目：点击行激活；行内编辑/删除按钮 */}
        {profiles.map((profile) => {
          const isActive = profile.id === activeProfileId;
          return (
            <div
              key={profile.id}
              className="border-t border-[var(--border-subtle)] px-5 py-3 transition-colors"
            >
              {/* biome-ignore lint/a11y/useSemanticElements: 行内含嵌套交互按钮，不能用语义 button */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => void activateProfile(profile.id)}
                onKeyDown={(event) => handleRowKeyDown(event, profile.id)}
                className={`-mx-2 flex cursor-pointer items-center gap-3 rounded-control px-2 py-2 transition-colors ${
                  isActive
                    ? "bg-[var(--material-interactive-hover)]"
                    : "hover:bg-[var(--material-interactive-hover)]/60"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium text-[var(--color-text-highlight)]">
                      {profile.name || profile.model || t("ai.profileUntitled")}
                    </span>
                    {isActive && (
                      <Badge variant="tint" color="var(--StatusSuccess)">
                        {t("ai.profileInUse")}
                      </Badge>
                    )}
                    {profile.provider && (
                      <Badge variant="neutral">{t(PROVIDER_LABEL_KEY[profile.provider])}</Badge>
                    )}
                  </div>
                  <div className="truncate font-mono text-[11.5px] text-[var(--color-text-muted)]">
                    {profile.model || t("ai.profileModelMissing")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    startEditProfile(profile);
                  }}
                  className="grid size-7 shrink-0 place-items-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
                  aria-label={t("ai.profileEdit")}
                >
                  <Icons.Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteProfile(profile.id);
                  }}
                  className="grid size-7 shrink-0 place-items-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--StatusError)]/15 hover:text-[var(--StatusError)]"
                  aria-label={t("ai.profileDelete")}
                >
                  <Icons.Trash size={14} />
                </button>
              </div>
            </div>
          );
        })}

        {/* 展开编辑器：新增 / 编辑共用 */}
        {editor && (
          <div className="flex flex-col gap-4 border-t border-[var(--border-subtle)] p-5">
            <div className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
              {editor.isNew ? t("ai.profileAddTitle") : t("ai.profileEditTitle")}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] text-[var(--color-text-muted)]">
                  {t("ai.profileName")}
                </span>
                <Input
                  value={editor.draft.name}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                  placeholder={t("ai.profileNamePlaceholder")}
                  aria-label={t("ai.profileName")}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] text-[var(--color-text-muted)]">
                  {t("ai.profileProvider")}
                </span>
                <Select
                  value={editor.draft.provider ?? "custom"}
                  onChange={(value) => handleDraftProviderChange(value as AiProvider)}
                  ariaLabel={t("ai.profileProvider")}
                  options={[
                    { value: "openai", label: t("ai.providerOpenai") },
                    { value: "deepseek", label: t("ai.providerDeepseek") },
                    { value: "openrouter", label: t("ai.providerOpenrouter") },
                    { value: "custom", label: t("ai.providerCustom") },
                  ]}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] text-[var(--color-text-muted)]">
                {t("ai.profileBaseUrl")}
              </span>
              <Input
                value={editor.draft.baseUrl}
                onChange={(event) => updateDraft({ baseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1"
                aria-label={t("ai.profileBaseUrl")}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] text-[var(--color-text-muted)]">
                  {t("ai.profileApiKey")}
                </span>
                <Input
                  type="password"
                  autoComplete="off"
                  value={editor.draft.apiKey}
                  onChange={(event) => updateDraft({ apiKey: event.target.value })}
                  placeholder="sk-…"
                  aria-label={t("ai.profileApiKey")}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] text-[var(--color-text-muted)]">
                  {t("ai.profileModel")}
                </span>
                <Input
                  value={editor.draft.model}
                  onChange={(event) => updateDraft({ model: event.target.value })}
                  placeholder={PROVIDER_MODEL_PLACEHOLDERS[editor.draft.provider ?? "custom"]}
                  aria-label={t("ai.profileModel")}
                />
              </div>
            </div>

            {/* 测试连接 + 结果提示 */}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                className="h-8 px-3 text-[12px]"
                onClick={() => void testConnection()}
                disabled={testStatus === "testing"}
              >
                {t("ai.profileTestConnection")}
              </Button>
              {testStatus === "testing" && (
                <span className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-muted)]">
                  <Icons.Refresh size={13} className="animate-spin" />
                  {t("ai.profileTesting")}
                </span>
              )}
              {testHint && testStatus !== "testing" && (
                <span className={`text-[12px] ${testHint.className}`}>{t(testHint.key)}</span>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" className="h-8 px-3 text-[12px]" onClick={closeEditor}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                className="h-8 px-4 text-[12px]"
                onClick={() => void saveEditor()}
              >
                {t("common.save")}
              </Button>
            </div>
          </div>
        )}
      </GlassContainer>
    </div>
  );
}
