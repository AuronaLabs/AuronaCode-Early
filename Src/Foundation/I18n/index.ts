import { useCallback, useEffect, useState } from "react";

export type Locale = "zh-CN" | "en";

import { en } from "./locales/en";
import { type LocaleMessages, zhCN } from "./locales/zh-CN";

type DeepKey<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DeepKey<T[K]>}`;
}[keyof T & string];

export type MessageKey = DeepKey<typeof zhCN>;

const MESSAGES: Record<Locale, LocaleMessages> = {
  "zh-CN": zhCN,
  en,
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
      if (saved === "zh-CN" || saved === "en") this.current = saved;
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
  const t = useCallback((key: MessageKey) => LocaleService.translate(key, LocaleService.get()), []);
  return { locale, setLocale: (next: Locale) => LocaleService.set(next), t };
}

export type { MessageKey as I18nKey };
