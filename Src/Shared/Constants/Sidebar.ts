export const SIDEBAR_EXPLORER = "资源管理器";
export const SIDEBAR_OUTLINE = "大纲";
export const SIDEBAR_FLIUNO = "Fliuno";
export const SIDEBAR_SOURCE_CONTROL = "源代码管理";
export const SIDEBAR_NOTIFICATIONS = "通知";
export const SIDEBAR_DEBUG = "运行和调试";
export const SIDEBAR_EXTENSIONS = "扩展";
/** 0.3.9 之前的旧侧边栏「全局搜索」状态，用于持久化状态迁移。 */
export const LEGACY_SIDEBAR_SEARCH = "全局搜索";
/** 扩展 Sidebar 的活动状态前缀，例如 extension:aurona.markdown。 */
export const EXTENSION_SIDEBAR_PREFIX = "extension:";
export const extensionSidebarId = (extensionId: string) =>
  `${EXTENSION_SIDEBAR_PREFIX}${extensionId}`;
export const extensionIdFromSidebar = (sidebarId: string) =>
  sidebarId.startsWith(EXTENSION_SIDEBAR_PREFIX)
    ? sidebarId.slice(EXTENSION_SIDEBAR_PREFIX.length)
    : null;
