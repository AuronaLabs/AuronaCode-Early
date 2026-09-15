import { useCallback, useEffect, useState } from "react";

export type Locale = "zh-CN" | "zh-Hant" | "en" | "de" | "it" | "ja";

import { de } from "./locales/de";
import { en } from "./locales/en";
import { it } from "./locales/it";
import { ja } from "./locales/ja";
import { type LocaleMessages, zhCN } from "./locales/zh-CN";
import { zhHant } from "./locales/zh-Hant";

type DeepKey<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DeepKey<T[K]>}`;
}[keyof T & string];

export type MessageKey = DeepKey<typeof zhCN>;

const MESSAGES: Record<Locale, LocaleMessages> = {
  "zh-CN": zhCN,
  "zh-Hant": zhHant,
  en,
  de,
  it,
  ja,
};

/** 语言在语言选择下拉中的自名显示（各语言用自身语言呈现，不参与翻译） */
export const LOCALE_NATIVE_NAMES: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "zh-Hant": "繁體中文",
  en: "English",
  de: "Deutsch",
  it: "Italiano",
  ja: "日本語",
};

const STORAGE_KEY = "aurona.locale";

function resolveMessage(locale: Locale, key: MessageKey): string {
  let current: unknown = MESSAGES[locale];
  for (const segment of key.split(".")) {
    if (current && typeof current === "object" && segment in current) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return key;
    }
  }
  return typeof current === "string" ? current : key;
}

class LocaleServiceImpl {
  private current: Locale = "zh-CN";
  private readonly listeners = new Set<() => void>();

  constructor() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "zh-Hant") this.current = saved;
      else if (saved === "zh-TW") {
        // 旧版繁体 ID 迁移到港澳台通用繁体。
        this.current = "zh-Hant";
        localStorage.setItem(STORAGE_KEY, "zh-Hant");
      } else if (saved && (Object.keys(MESSAGES) as string[]).includes(saved)) {
        this.current = saved as Locale;
      }
    } catch {
      // 本地存储不可用时保持默认语言。
    }
  }

  get(): Locale {
    return this.current;
  }

  set(locale: Locale): void {
    if (locale === this.current) return;
    this.current = locale;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // 语言偏好持久化失败不影响运行。
    }
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  translate(key: MessageKey, locale: Locale = this.current): string {
    return resolveMessage(locale, key);
  }
}

export const LocaleService = new LocaleServiceImpl();

export function useLocale() {
  const [locale, setLocale] = useState<Locale>(LocaleService.get());
  useEffect(() => LocaleService.subscribe(() => setLocale(LocaleService.get())), []);
  // t 的引用随 locale 变化：调用方把 t 放进 useMemo/useEffect 依赖时能正确失效重算，
  // 修复「切换语言后 memo 缓存的翻译不刷新」问题。
  const t = useCallback((key: MessageKey) => LocaleService.translate(key, locale), [locale]);
  return { locale, setLocale: (next: Locale) => LocaleService.set(next), t };
}

export type { MessageKey as I18nKey };
