import type { ExtensionDescriptor } from "../../Foundation/IPC/ExtensionCommands";

/**
 * 根据宿主当前语言动态解析插件名称（完全由插件自身 manifest 提供）
 */
export function resolveExtensionName(
  descriptor: ExtensionDescriptor | undefined | null,
  locale: string,
): string {
  if (!descriptor) return "";
  if (descriptor.displayName) {
    if (descriptor.displayName[locale]) {
      return descriptor.displayName[locale];
    }
    // 匹配语言前缀，如 zh-Hant 或 zh
    const baseLang = locale.split("-")[0];
    for (const [key, value] of Object.entries(descriptor.displayName)) {
      if (key === locale || (baseLang && key.startsWith(baseLang))) {
        return value;
      }
    }
    if (descriptor.displayName.en) {
      return descriptor.displayName.en;
    }
  }
  return descriptor.name || descriptor.id;
}

/**
 * 根据宿主当前语言动态解析插件侧边栏标题
 */
export function resolveExtensionSidebarTitle(
  descriptor: ExtensionDescriptor | undefined | null,
  locale: string,
): string {
  if (!descriptor) return "";
  if (descriptor.displayTitle) {
    if (descriptor.displayTitle[locale]) {
      return descriptor.displayTitle[locale];
    }
    const baseLang = locale.split("-")[0];
    for (const [key, value] of Object.entries(descriptor.displayTitle)) {
      if (key === locale || (baseLang && key.startsWith(baseLang))) {
        return value;
      }
    }
    if (descriptor.displayTitle.en) {
      return descriptor.displayTitle.en;
    }
  }
  return descriptor.sidebarTitle || resolveExtensionName(descriptor, locale);
}

/**
 * 根据宿主当前语言动态解析插件描述
 */
export function resolveExtensionDescription(
  descriptor: ExtensionDescriptor | undefined | null,
  locale: string,
): string {
  if (!descriptor) return "";
  if (descriptor.displayDescription) {
    if (descriptor.displayDescription[locale]) {
      return descriptor.displayDescription[locale];
    }
    const baseLang = locale.split("-")[0];
    for (const [key, value] of Object.entries(descriptor.displayDescription)) {
      if (key === locale || (baseLang && key.startsWith(baseLang))) {
        return value;
      }
    }
    if (descriptor.displayDescription.en) {
      return descriptor.displayDescription.en;
    }
  }
  return descriptor.description || "";
}
