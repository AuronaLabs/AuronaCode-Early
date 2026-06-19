export interface ChangelogEntry {
  version: string;
  date: string;
  isLatest?: boolean;
  sections: {
    title: string;
    items: string[];
  }[];
}

export const CHANGELOG_DATA: ChangelogEntry[] = [
  {
    version: "V0.0.3",
    date: "2026-06-19",
    isLatest: true,
    sections: [
      {
        title: "全景控制台体系 (Panorama Console)",
        items: [
          "新增沉浸式底侧控制台面板，无缝集成全局问题诊断、系统输出与多终端管理。",
          "基于 Monaco 底层深度绑定的错误捕获机制，自动拉取整个工作区的异常告警。",
          "支持无限并发的多终端 (PowerShell, Cmd等) 独立标签隔离体验。",
          "终端面板重构为常驻容器，并接入 Web Links 插件支持本地路径与网络链接交互。",
        ],
      },
      {
        title: "文件与编辑器基础能力",
        items: [
          "重建文件资源管理器的创建、重命名、删除、刷新和错误提示链路，文件操作失败时会给出明确反馈。",
          "编辑器支持未保存状态、Ctrl+S 保存、菜单保存，并会在关闭未保存标签时提示确认。",
          "补齐 Monaco 语言识别规则，覆盖 HTML、样式、脚本、配置、脚本语言和常见后端文件。",
        ],
      },
      {
        title: "跨缩放与工作区体验",
        items: [
          "新增紧凑、常规、舒展三档界面密度，会根据窗口尺寸和系统缩放自动调整侧栏、标签栏和编辑器行高。",
          "优化标签栏未保存标记、Tooltip、浅色模式文件树选中态和顶部菜单可点击区域。",
          "启动页改为滚动式状态文案，让等待过程更轻松，同时保持专业克制。",
        ],
      },
      {
        title: "稳定性、性能与 UI 优化",
        items: [
          "补齐 Tauri 文件系统权限，确保重命名和删除在桌面端正常工作。",
          "Git 面板加入会话级缓存，切换侧栏时先显示缓存内容，再在后台刷新状态。",
          "重构底层终端 PTY 引擎，彻底消除历史回显乱码与时间延迟，实现真正的“秒开”。",
          "优化终端交互细节，如双击重命名、一键清屏，并全面对齐 Mira 设计系统的 UI 视觉标准。",
        ],
      },
    ],
  },
  {
    version: "V0.0.2",
    date: "2026-06-19",
    sections: [
      {
        title: "Mira 设计系统",
        items: [
          "引入更轻量的卡片化工作区视觉，减少不必要的装饰。",
          "定制全局滚动条和标签栏细节，让界面更贴近代码工作流。",
          "新增设置、更新记录、关于页面和基础源代码管理面板。",
        ],
      },
    ],
  },
  {
    version: "V0.0.1",
    date: "2026-06-18",
    sections: [
      {
        title: "首次发布",
        items: ["发布 Aurona Code 的第一个公开测试版本。"],
      },
    ],
  },
];
