export interface ChangelogEntry {
  version: string;
  date: string;
  isLatest?: boolean;
  isUnreleased?: boolean;
  summary?: string;
  sections: { title: string; description?: string; items?: string[] }[];
}

/** A fresh release history for the 0.5 upgrade. */
export const CHANGELOG_DATA: ChangelogEntry[] = [
  {
    version: "V0.5.0-alpha.1",
    date: "2026-11-08",
    isLatest: true,
    summary:
      "当前版本为Aurona Code全新升级的过渡版本\n本阶段先精简现有功能、打磨基础体验，为后续大规模升级做好准备。",
    sections: [
      {
        title: "视觉焕新",
        items: [
          "应用、启动页与安装包统一使用全新 Aurona 标识。",
          "收敛深色模式的白色叠层、顶部高光与流光反射，让面板、菜单和控件更柔和。",
          "更新记录从 Alpha1 重新开始，集中呈现本轮升级的变化。",
          "关于页采用全新品牌与版本信息布局，标语更新为“创造永无止境”。",
          "品牌艺术字体精简为专用字符子集，启动页与主界面同步加载。",
        ],
      },
      {
        title: "阶段性精简",
        items: [
          "暂时完整移除 Aurona 账号体系，后续随整体升级重新规划。",
          "商店页面调整为扩展管理，当前仅保留本地扩展包导入与已安装扩展管理；在线扩展体验将在后续升级中重新设计。",
          "取消先锋计划、渠道切换与专属标识，统一当前版本的使用体验。",
        ],
      },
      {
        title: "操作体验",
        items: [
          "文件资源管理器改为紧凑列表，同屏呈现更多文件与目录。",
          "Git 操作统一收进“更多”菜单，移除 Preview 徽章，减少工具栏拥挤。",
          "重做差异查看器：支持并排与统一视图、自动换行和变更跳转，改善增删行配对、文件状态和窄视图阅读。",
          "统一设置页的标题、字号、间距与窄屏布局，减轻 AI 设置页的文字粗重感。",
          "重构 AI 助手侧栏：改进输入与任务状态、会话草稿、排队补充、停止操作和长对话阅读。",
          "统一文件行、新建、重命名及加载更多的高度，保持树形缩进与操作反馈清晰。",
        ],
      },
      {
        title: "基础改进",
        items: [
          "改进 Agent 文件快照恢复，明确文件存在状态与变更冲突。",
          "完善预发布版本比较，正确区分 Alpha、Beta 与正式版。",
          "修正差异解析中的空格路径、中文转义路径及特殊代码行，保留二进制和文件属性变更说明。",
          "清理旧版本文档，重写默认英文 README，并提供五种其他语言版本。",
        ],
      },
    ],
  },
];
