import type { SettingsSection } from "../Features/Settings/SettingsTab";
import type { I18nKey } from "../Foundation/I18n";
import {
  SIDEBAR_AI,
  SIDEBAR_DEBUG,
  SIDEBAR_EXPLORER,
  SIDEBAR_EXTENSIONS,
  SIDEBAR_FLIUNO,
  SIDEBAR_NOTIFICATIONS,
  SIDEBAR_OUTLINE,
  SIDEBAR_SOURCE_CONTROL,
} from "../Shared/Constants/Sidebar";
import type { Icons } from "../UI/Icons/IconManager";

/**
 * 内置侧边栏卡片注册表（0.4.6 批次 4.8）
 *
 * 「内置卡片清单」的单一声明源：AppShell 的活动项与 Workspace 的渲染分支
 * 都以本表为基准。新增内置卡片时只需在此追加一条描述，并在 Workspace 的
 * 对应渲染槽位接入组件。
 *
 * 行为约定：本表为纯结构声明，不改变任何现有渲染顺序与视觉表现。
 */
export interface SidebarCardDescriptor {
  /** 卡片 id，与 useWorkbenchStore.activeSidebar 的持久化值一致 */
  id: string;
  /** IconManager 图标键 */
  iconKey: keyof typeof Icons;
  /** 标题 i18n key */
  titleKey: I18nKey;
  /** 排序权重（小者靠前，仅决定活动栏主组分隔前的顺序） */
  order: number;
  /** 关联的设置分区（可选，用于卡片与设置的关联跳转） */
  settingsCategory?: SettingsSection;
  /**
   * Workspace 渲染槽位：
   * - "workspace-hardcoded"：Workspace 内既有的硬编码 display 切换块（行为零变化，不改）
   * - "workspace-mounted"：Workspace 按注册表懒加载挂载的新卡片（AI 助手）
   */
  renderSlot: "workspace-hardcoded" | "workspace-mounted";
  /**
   * 活动栏点击行为命令（可选）：如 Fliuno 卡片点击时执行打开工作区命令，
   * 侧边栏切换行为由命令自行决定。
   */
  activityCommandId?: string;
  /** 活动栏归属组：main 为顶部主组，aux 为底部辅助组（通知） */
  activityGroup: "main" | "aux";
}

/** 内置卡片静态声明（顺序即 order 升序） */
export const SIDEBAR_CARDS: readonly SidebarCardDescriptor[] = [
  {
    id: SIDEBAR_EXPLORER,
    iconKey: "Files",
    titleKey: "sidebar.explorer",
    order: 10,
    renderSlot: "workspace-hardcoded",
    activityGroup: "main",
  },
  {
    id: SIDEBAR_FLIUNO,
    iconKey: "Search",
    titleKey: "sidebar.search",
    order: 20,
    renderSlot: "workspace-hardcoded",
    activityCommandId: "workbench.action.openFliunoWorkspace",
    activityGroup: "main",
  },
  {
    id: SIDEBAR_SOURCE_CONTROL,
    iconKey: "Git",
    titleKey: "sidebar.sourceControl",
    order: 30,
    renderSlot: "workspace-hardcoded",
    activityGroup: "main",
  },
  {
    id: SIDEBAR_OUTLINE,
    iconKey: "List",
    titleKey: "sidebar.outline",
    order: 40,
    renderSlot: "workspace-hardcoded",
    activityGroup: "main",
  },
  {
    id: SIDEBAR_DEBUG,
    iconKey: "Debug",
    titleKey: "sidebar.debug",
    order: 50,
    renderSlot: "workspace-hardcoded",
    activityGroup: "main",
  },
  {
    id: SIDEBAR_EXTENSIONS,
    iconKey: "Extensions",
    titleKey: "sidebar.extensions",
    order: 60,
    renderSlot: "workspace-hardcoded",
    activityGroup: "main",
  },
  {
    id: SIDEBAR_NOTIFICATIONS,
    iconKey: "Bell",
    titleKey: "sidebar.notifications",
    order: 70,
    renderSlot: "workspace-hardcoded",
    activityGroup: "aux",
  },
  {
    id: SIDEBAR_AI,
    iconKey: "Sparkles",
    titleKey: "sidebar.ai",
    order: 80,
    settingsCategory: "ai",
    renderSlot: "workspace-mounted",
    activityGroup: "main",
  },
];

/** 按活动栏分组取卡（升序） */
export function sidebarCardsByGroup(group: SidebarCardDescriptor["activityGroup"]) {
  return SIDEBAR_CARDS.filter((card) => card.activityGroup === group).sort(
    (a, b) => a.order - b.order,
  );
}
