import type React from "react";
import { useEffect, useRef, useState } from "react";
import { AiChatService } from "../../Core/AiChatService";
import { useLocale } from "../../Foundation/I18n";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { AiPreferences } from "../../Foundation/Types/Config";
import { Input } from "../../UI/Components/Input";
import { Select } from "../../UI/Components/Select";
import { Switch } from "../../UI/Components/Switch";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { syncAgentExecutorRegistration } from "../AiAssistant/AgentToolExecutor";

/** 0.4.6 批次 5：AI 助手设置（服务商预设 / Base URL / API Key / 模型名）。 */

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

/** 写入 UserConfig 的 ai 段并通知服务刷新配置快照 */
async function saveAiConfig(patch: Partial<AiPreferences>): Promise<void> {
  const config = await UserConfigStore.get();
  await UserConfigStore.set({ ai: { ...config.ai, ...patch } });
  await AiChatService.refreshConfig();
}

export function AiSettingsSection() {
  const { t } = useLocale();
  const [enabled, setEnabled] = useState(true);
  const [agentEnabled, setAgentEnabled] = useState(true);
  const [provider, setProvider] = useState<AiProvider>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  /** 文本字段防抖保存（输入停顿 600ms 自动写盘；失焦/回车立即提交并清除挂起定时器） */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const saveNow = (patch: Partial<AiPreferences>) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    void saveAiConfig(patch);
  };

  const saveDebounced = (patch: Partial<AiPreferences>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void saveAiConfig(patch);
    }, 600);
  };

  useEffect(() => {
    UserConfigStore.get().then((config) => {
      const ai = config.ai;
      setEnabled(ai?.enabled ?? true);
      setAgentEnabled(ai?.agentEnabled !== false);
      setProvider((ai?.provider ?? "openai") as AiProvider);
      setBaseUrl(ai?.baseUrl ?? "");
      setApiKey(ai?.apiKey ?? "");
      setModel(ai?.model ?? "");
    });
  }, []);

  const handleEnabledChange = (next: boolean) => {
    setEnabled(next);
    saveNow({ enabled: next });
  };

  const handleAgentEnabledChange = (next: boolean) => {
    setAgentEnabled(next);
    saveNow({ agentEnabled: next });
    syncAgentExecutorRegistration();
  };

  const handleProviderChange = (next: AiProvider) => {
    setProvider(next);
    // 选预设自动填默认 baseUrl（custom 清空，可被覆盖编辑）
    const presetUrl = PROVIDER_BASE_URLS[next];
    setBaseUrl(presetUrl);
    saveNow({ provider: next, baseUrl: presetUrl });
  };

  const commitBaseUrl = () => {
    saveNow({ baseUrl: baseUrl.trim() });
  };

  const commitApiKey = () => {
    saveNow({ apiKey: apiKey.trim() });
  };

  const commitModel = () => {
    saveNow({ model: model.trim() });
  };

  const handleTextKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, commit: () => void) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
      commit();
    }
  };

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

        {/* 服务商预设 */}
        <div
          data-setting-id="aiProvider"
          className="flex min-h-14 flex-col gap-4 border-t border-[var(--border-subtle)] p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("ai.settingsProviderTitle")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("ai.settingsProviderDesc")}
            </span>
          </div>
          <div className="shrink-0">
            <Select
              value={provider}
              onChange={(value) => handleProviderChange(value as AiProvider)}
              className="w-[180px]"
              ariaLabel={t("ai.settingsProviderTitle")}
              options={[
                { value: "openai", label: t("ai.providerOpenai") },
                { value: "deepseek", label: t("ai.providerDeepseek") },
                { value: "openrouter", label: t("ai.providerOpenrouter") },
                { value: "custom", label: t("ai.providerCustom") },
              ]}
            />
          </div>
        </div>

        {/* API 地址 */}
        <div
          data-setting-id="aiBaseUrl"
          className="flex min-h-14 flex-col gap-4 border-t border-[var(--border-subtle)] p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("ai.settingsBaseUrlTitle")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("ai.settingsBaseUrlDesc")}
            </span>
          </div>
          <div className="w-full shrink-0 sm:w-auto">
            <Input
              fullWidth
              value={baseUrl}
              onChange={(event) => {
                const value = event.target.value;
                setBaseUrl(value);
                saveDebounced({ baseUrl: value.trim() });
              }}
              onBlur={commitBaseUrl}
              onKeyDown={(event) => handleTextKeyDown(event, commitBaseUrl)}
              placeholder="https://api.openai.com/v1"
              aria-label={t("ai.settingsBaseUrlTitle")}
              className="sm:w-[320px]"
            />
          </div>
        </div>

        {/* API Key（仅本机存储） */}
        <div
          data-setting-id="aiApiKey"
          className="flex min-h-14 flex-col gap-4 border-t border-[var(--border-subtle)] p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("ai.settingsApiKeyTitle")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("ai.settingsApiKeyDesc")}
            </span>
          </div>
          <div className="w-full shrink-0 sm:w-auto">
            <Input
              fullWidth
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => {
                const value = event.target.value;
                setApiKey(value);
                saveDebounced({ apiKey: value.trim() });
              }}
              onBlur={commitApiKey}
              onKeyDown={(event) => handleTextKeyDown(event, commitApiKey)}
              placeholder={t("ai.settingsApiKeyPlaceholder")}
              aria-label={t("ai.settingsApiKeyTitle")}
              className="sm:w-[320px]"
            />
          </div>
        </div>

        {/* 模型名称 */}
        <div
          data-setting-id="aiModel"
          className="flex min-h-14 flex-col gap-4 border-t border-[var(--border-subtle)] p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-[var(--color-text-highlight)]">
              {t("ai.settingsModelTitle")}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {t("ai.settingsModelDesc")}
            </span>
          </div>
          <div className="w-full shrink-0 sm:w-auto">
            <Input
              fullWidth
              value={model}
              onChange={(event) => {
                const value = event.target.value;
                setModel(value);
                saveDebounced({ model: value.trim() });
              }}
              onBlur={commitModel}
              onKeyDown={(event) => handleTextKeyDown(event, commitModel)}
              placeholder={PROVIDER_MODEL_PLACEHOLDERS[provider]}
              aria-label={t("ai.settingsModelTitle")}
              className="sm:w-[320px]"
            />
          </div>
        </div>
      </GlassContainer>

      <p className="text-[11.5px] leading-5 text-[var(--color-text-muted)]">
        {t("ai.settingsPrivacyNote")}
      </p>
    </div>
  );
}
