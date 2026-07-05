export interface ChangelogEntry {
  version: string;
  date: string;
  isLatest?: boolean;
  sections: {
    title: string;
    description?: string;
    items?: string[];
  }[];
}

export const CHANGELOG_DATA: ChangelogEntry[] = [
  {
    version: "V0.2.0",
    date: "2026-07-04",
    isLatest: true,
    sections: [
      {
        title: "Corona+ 架构大升级：极致性能与现代极客美学",
        description:
          "Aurona Code 迎来了史诗级的大版本更新！\n\n我们全面升级了应用架构，正式步入 **Corona+ 时代**。本次升级彻底清除了早期迭代遗留的历史包袱与旧版 UI，带来了贯穿全局的「极客玻璃态 (Frosted Glass)」质感设计以及 Radix UI 无障碍底层支持。因为底层架构发生了不可逆的深度重构，我们将过去的 0.0.X 与 0.1.X 的冗长记录全部封存并归档，开启 V0.2.0 新纪元。",
      },
      {
        title: "全局极客级 UI 重构",
        items: [
          "引入了全新的 `frosted-glass` 玻璃态材质，全局菜单、对话框、编辑器顶部标签栏、输入框全部获得了磨砂玻璃透视质感",
          "彻底整合 Radix UI 无头组件库，对 Select、Switch、Modal、ContextMenu 进行深度定制，交互动画更丝滑，支持全面的键盘无障碍访问",
          "统一系统上下文菜单：所有弹出式菜单（右键菜单、文件树菜单）现已统一为更高点击区域、更大字体层级的极客定制版式，不再有视觉割裂感",
          "全面翻新内部业务页面（设置、关于、源代码管理），采用流式瀑布流与玻璃态卡片嵌套设计，信息展示更加通透高级",
        ],
      },
      {
        title: "编辑器深度交互升级",
        items: [
          "AuronaEngine 迎来首次交互升级：原生支持编辑区域的鼠标右键菜单 (ContextMenu)，提供撤销、重做、剪切、复制、粘贴与全选等核心编辑能力",
          "TitleBar 顶部「编辑」菜单现已与下层编辑器实例打通，真正实现了跨组件级别的撤销与重做指令分发",
          "彻底清理了历史遗留的旧版编辑器样式痕迹和所有冗余调试注释，应用包体与 DOM 树结构变得无比纯净",
          "优化代码搜索高亮与选中背景层次，在光标停留时有更柔和的光晕过渡",
        ],
      },
      {
        title: "周边与生态更新",
        items: [
          "重构了位于项目根目录的 `manager.py`，启用了全新的 rich 命令行 TUI 界面，开发管理与打包构建体验大幅跃升",
          "项目 README 与 GitHub 模板已同步升级至 Corona+ 风格设计文档",
        ],
      },
    ],
  },
];
