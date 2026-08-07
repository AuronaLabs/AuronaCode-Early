import { useCallback, useEffect, useState } from "react";

export type Locale = "zh-CN" | "en";

const zhCN = {
  common: {
    search: "搜索",
    cancel: "取消",
    clear: "清空",
    open: "打开",
    recent: "最近使用",
    noResults: "没有找到匹配结果",
    tryShorter: "尝试更短的关键词，或使用 > 和 @ 缩小范围",
    command: "命令",
    file: "文件",
    setting: "设置",
    symbol: "符号",
    content: "内容",
  },
  fliuno: {
    quickPlaceholder: "搜索命令、文件或设置…",
    workspaceTitle: "Fliuno 工作区",
    workspaceHint: "统一搜索你的工作区：文件、内容、符号、命令与设置",
    workspacePlaceholder: "搜索文件、内容、符号、命令或设置…",
    scopeAll: "全部",
    scopeCommands: "命令",
    scopeFiles: "文件",
    scopeSettings: "设置",
    scopeSymbols: "符号",
    scopeContent: "内容",
    noWorkspace: "打开工作区后即可搜索",
    resultsCount: "{count} 个结果",
    emptyHint: "命令、最近文件和工作区路径会在这里统一出现",
    indexing: "正在整理工作区文件…",
    contentGroup: "工作区内容",
    symbolGroup: "符号",
    settingGroup: "设置",
    fileGroup: "文件",
    commandGroup: "命令",
  },
  settings: {
    title: "设置",
    searchPlaceholder: "搜索设置…",
    searchResults: "搜索结果",
    noResults: "未找到相关设置",
    generalDescription: "界面模式、密度与界面语言",
    theme: "外观模式",
    themeDescription: "更改编辑器的整体色彩倾向",
    themeSystem: "跟随系统",
    themeLight: "浅色",
    themeDark: "深色",
    density: "界面密度",
    densityDescription: "紧凑、常规或自动（按窗口尺寸）布局",
    densityAuto: "自动",
    densityCompact: "紧凑",
    densityRegular: "常规",
    densityComfortable: "舒适",
    language: "语言",
    languageDescription: "选择界面语言（简体中文为当前主要支持语言）",
    languageZhCN: "简体中文",
    languageEn: "English (Beta)",
    terminalRunDescription: "终端显示与运行调试配置",
    sourceControlDescription: "配置当前工作区 Git 仓库的远程拉取和推送地址",
    openPerformance: "打开性能测试",
    openPerformanceDescription: "运行完整的基准测试并查看本地性能历史",
    openAbout: "关于 Aurona Code",
    openAboutDescription: "查看版本、构建信息与开源许可",
    checkUpdate: "检查更新",
    checkUpdateDescription: "手动检查 GitHub Release 中是否有可安装的新版本",
    checkingUpdate: "正在检查…",
    resetApp: "初始化重置",
    resetAppDescription: "清除应用全部本地数据，使编辑器回到初始安装状态",
    resetAppAction: "重置应用程序",
    advancedDescription: "实验性选项、更新与出厂重置",
    advancedEmpty: "实验性与开发者选项即将在后续版本开放",
    categories: {
      general: "常规",
      appearance: "外观",
      editor: "编辑器",
      codeIntelligence: "代码智能",
      terminalRun: "终端与运行",
      sourceControl: "源代码管理",
      accountCloud: "Aurona 账户",
      system: "空间管理",
      advanced: "高级",
    },
    editorSection: {
      title: "编辑器设置",
      description: "配置代码编辑器的外观和行为",
      fontSize: "字体大小",
      fontSizeDescription: "控制编辑器的主代码字体大小",
      lineHeight: "行高",
      lineHeightDescription: "调整代码行间距，并同步光标与选择坐标",
      tabWidth: "Tab 宽度",
      tabWidthDescription: "控制 Tab 字符的视觉宽度与点击定位",
      wordWrap: "自动换行",
      wordWrapDescription: "当代码超出一行长度时自动折行显示",
      minimap: "代码缩略图",
      minimapDescription: "当前轻量编辑器内核暂不支持缩略图；该选项将在完整实现后再开放",
      unavailable: "暂不可用",
    },
    terminalSection: {
      fontSize: "字体大小",
      fontSizeDescription: "控制终端控制台的字体大小",
      cursorBlink: "光标闪烁",
      cursorBlinkDescription: "是否开启终端光标的呼吸闪烁效果",
    },
    sourceControlSection: {
      noRepo: "未检测到 Git 工作区",
      noRepoDescription:
        "当前未在工作区打开任何有效的目录。请先在资源管理器中打开包含 Git 仓库的文件夹，然后在此处配置凭据。",
      currentRepo: "当前工作区仓库",
      localConfig: "本地配置",
      remoteUrl: "远程仓库地址",
      remoteUrlDescription: "用于当前仓库的拉取与推送",
      credentialsNote:
        "凭据由 Git Credential Manager、系统钥匙串或 SSH 密钥管理。Aurona Code 不会将用户名、密码或 Token 写入远程地址。",
      localOnly: "仅修改当前仓库的 Git remote 配置",
      applying: "正在应用...",
      apply: "应用更改",
    },
    toast: {
      noGitWorkspace: "当前工作区未打开任何有效的 Git 项目",
      enterRemoteUrl: "请填写远程仓库地址",
      credentialWarning:
        "请使用 Git Credential Manager 或 SSH 密钥管理凭据，不要将凭据写入远程地址",
      remoteUpdated: "远程仓库地址已成功更新",
      saveFailed: "保存失败: {message}",
      upToDate: "当前已是最新版本",
      checkUpdateFailed: "检查更新失败：{message}",
      cacheCleared: "缓存与配置已清理，请重启应用",
    },
    appearanceSection: {
      title: "外观与色彩",
      description: "在同一处调整工作台色彩与背景氛围",
      accentTitle: "色彩主题",
      accentDescription:
        "八套主题各自拥有完整的浅色/深色背景渐变设计，统一影响交互强调、焦点与状态反馈",
      defaultBadge: "默认",
      effectsTitle: "视觉效果",
      effectsDescription: "调整界面元素的玻璃拟物（毛玻璃）效果强度与动态质感",
      intensity: "拟物强度",
      intensityDescription: "同步控制毛玻璃模糊、透明度以及菜单/卡片的阴影厚度",
      liquid: "流光",
      liquidDescription: "一条极低透明度的柔和光带缓慢扫过窗口，不跟随鼠标，也不在卡片上叠加高亮",
      liquidLabel: "启用流光",
    },
    codeIntelligence: {
      experienceTitle: "编辑器语言体验",
      experienceDescription: "控制 Hover 与补全的实际触发行为。修改后立即应用到已打开的编辑器。",
      hover: "悬浮信息",
      hoverDescription: "将鼠标停留在符号上时显示类型、签名和文档。",
      hoverDelay: "Hover 延迟",
      hoverDelayDescription: "鼠标稳定停留后再发送请求，避免移动过程中频繁调用服务器。",
      completion: "自动补全",
      completionDescription: "输入时自动请求建议；无论此项是否开启，Ctrl+Space 始终可手动触发。",
      serversTitle: "内置语言服务器",
      serversDescription: "内置服务器随 Aurona Code 分发，不依赖启动目录，也不会在运行时联网下载。",
      builtin: "内置",
      start: "启动",
      restart: "重启",
      stop: "停止",
      openOutput: "打开输出",
      notStarted: "未启动",
      stopped: "已停止",
      starting: "正在启动",
      initializing: "正在初始化",
      running: "运行中",
      restarting: "正在重启",
      failed: "启动失败",
      stopping: "正在停止",
    },
    debug: {
      experienceTitle: "调试体验",
      experienceDescription: "控制调试会话的面板、暂停和日志行为。",
      openSidebar: "启动时打开侧栏",
      stopOnEntry: "入口处暂停",
      console: "调试控制台",
      consoleIntegrated: "集成控制台",
      consoleTerminal: "集成终端",
      consoleNone: "不打开",
      adapterLogLevel: "Adapter 日志级别",
      logError: "仅错误",
      logInfo: "信息",
      logDebug: "调试",
      runtimesTitle: "运行时路径",
      runtimesDescription: "直接启动程序，不经过 Shell，也不会自动下载软件。",
      python: "Python",
      node: "Node.js",
      adaptersTitle: "内置调试支持",
      adaptersDescription:
        "协议客户端与界面由 Aurona 提供，Python 调试组件会在首次使用时检查并提供安装入口。",
    },
    storage: {
      title: "空间管理",
      description: "按真实目录监控并清理 Aurona Code 占用的磁盘空间",
      localDataUsed: "本地数据已使用",
      appDataDir: "应用本地数据目录",
      note: "以上条目对应应用本地数据目录中的真实文件与文件夹；WebView 缓存清理后由 WebView2 自动重建，配置、工作区状态与恢复快照属于核心数据，请谨慎清理。",
      detailsTitle: "存储细分与清理",
      groupCore: "核心数据",
      groupCache: "缓存",
      groupLogs: "日志",
      groupOther: "其他",
      clear: "清理",
      clearing: "清理中...",
      footerNote:
        "正在被应用使用的文件可能无法立即删除，清理后再次打开页面会显示最新占用。重置全部应用数据请前往「高级设置 → 初始化重置」。",
      rows: {
        config: {
          name: "用户配置偏好",
          description: "主题、外观、字体、语言服务等个人设置；清理后重启恢复默认",
        },
        workspace: {
          name: "工作区状态",
          description: "最近打开的文件夹、标签页与界面布局记忆；清理后重启重置布局",
        },
        recovery: {
          name: "编辑器恢复快照",
          description: "异常关闭后用于恢复未保存文档；确认不需要恢复内容再清理",
        },
        cache: {
          name: "WebView 渲染缓存",
          description: "WebView2 的缓存与临时文件，通常是占用最大的部分；清理后下次启动自动重建",
        },
        logs: {
          name: "运行日志",
          description: "应用生命周期、Tauri 进程与终端控制台的诊断日志",
        },
        errlogs: {
          name: "错误日志",
          description: "崩溃与错误诊断记录，排查问题后可以安全清理",
        },
        performance: {
          name: "性能基线",
          description: "本地性能对比基线数据；清理后下次测试重新建立",
        },
        other: {
          name: "其他本地数据",
          description: "未被上面分类的小型残留文件",
        },
      },
      toasts: {
        configCleared: "用户配置文件已清除，重启后恢复默认",
        workspaceCleared: "工作区状态已清理，重启后将重置布局",
        recoveryCleared: "编辑器恢复快照已清理",
        cacheCleared: "WebView 缓存已清理，下次启动会自动重建",
        logsCleared: "运行日志已清理",
        errlogsCleared: "错误日志已清理",
        performanceCleared: "性能基线已重置，下次测试会重新建立",
        otherCleared: "已清理其他残留数据，部分占用可能需重启后释放",
        clearFailed: "清理失败：{message}",
      },
    },
    definitions: {
      theme: { title: "外观模式", description: "浅色、深色或跟随系统" },
      density: { title: "界面密度", description: "紧凑、常规或宽松布局" },
      accentTheme: { title: "色彩主题", description: "选择工作台的强调色与背景" },
      liquidTexture: { title: "流光", description: "柔和光带缓慢扫过窗口" },
      hoverEnabled: { title: "悬浮信息", description: "在符号上显示类型与文档" },
      hoverDelayMs: { title: "悬浮延迟", description: "鼠标停留多久后发送悬浮请求" },
      automaticCompletion: { title: "自动补全", description: "输入时自动请求建议" },
      editorFontSize: { title: "编辑器字体大小", description: "主代码字体大小" },
      editorLineHeight: { title: "编辑器行高", description: "代码行的高度" },
      editorTabSize: { title: "缩进宽度", description: "Tab 对应的空格数" },
      editorWordWrap: { title: "自动换行", description: "是否按视口换行" },
      terminalFontSize: { title: "终端字体大小", description: "终端字体大小" },
      terminalCursorBlink: { title: "终端光标闪烁", description: "光标是否闪烁" },
      pythonPath: { title: "Python 路径", description: "调试时使用的 Python 解释器" },
      nodePath: { title: "Node 路径", description: "调试时使用的 Node 可执行文件" },
      stopOnEntry: { title: "启动即暂停", description: "调试启动后立即停在入口" },
      logLevel: { title: "日志级别", description: "开发者诊断日志详细程度" },
    },
  },
  account: {
    title: "Aurona Account",
    signedIn: "已登录",
    signedOut: "未登录",
    refreshProfile: "刷新资料",
    advancedInfo: "高级信息",
    defaultDisplayName: "Aurona 用户",
    intro:
      "使用 Aurona 官方账户连接 Aurona Code。授权会在系统浏览器中完成，应用不会读取或保存你的密码。",
    scopesNote: "登录后将授权以上能力，用于身份识别、个人资料与安全刷新令牌。",
    noEmail: "未向 Aurona Code 授权邮箱",
    login: "登录 Aurona Account",
    loginFailed: "登录未能完成，请重试。",
    cancelLogin: "取消登录",
    cancelFailed: "无法取消登录，请稍后重试。",
    logout: "退出登录",
    logoutFailed: "退出登录失败，请稍后重试。",
    signingOut: "正在退出…",
    refreshing: "正在刷新…",
    refreshFailed: "刷新资料失败，请稍后重试。",
    refreshToast: "账户资料已刷新",
    loginToast: "已登录 Aurona Account",
    logoutToast: "已退出登录",
    notConfigured: "当前构建尚未配置 Aurona Account 客户端。",
    preparingLogin: "正在准备登录…",
    connecting: "正在连接 Aurona Account…",
    awaitingCallback: "请在系统浏览器中完成授权",
    exchangingCode: "正在安全验证账户…",
    restoringSession: "正在恢复账户登录…",
  },
};

type DeepKey<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DeepKey<T[K]>}`;
}[keyof T & string];

export type MessageKey = DeepKey<typeof zhCN>;

const en: typeof zhCN = {
  common: {
    search: "Search",
    cancel: "Cancel",
    clear: "Clear",
    open: "Open",
    recent: "Recent",
    noResults: "No matching results",
    tryShorter: "Try a shorter query, or use > and @ to narrow scope",
    command: "Command",
    file: "File",
    setting: "Setting",
    symbol: "Symbol",
    content: "Content",
  },
  fliuno: {
    quickPlaceholder: "Search commands, files or settings…",
    workspaceTitle: "Fliuno Workspace",
    workspaceHint: "Search files, content, symbols, commands and settings in one place",
    workspacePlaceholder: "Search files, content, symbols, commands or settings…",
    scopeAll: "All",
    scopeCommands: "Commands",
    scopeFiles: "Files",
    scopeSettings: "Settings",
    scopeSymbols: "Symbols",
    scopeContent: "Content",
    noWorkspace: "Open a workspace to search",
    resultsCount: "{count} results",
    emptyHint: "Commands, recent files and workspace paths appear here",
    indexing: "Indexing workspace files…",
    contentGroup: "Workspace content",
    symbolGroup: "Symbols",
    settingGroup: "Settings",
    fileGroup: "Files",
    commandGroup: "Commands",
  },
  settings: {
    title: "Settings",
    searchPlaceholder: "Search settings…",
    searchResults: "Search results",
    noResults: "No settings found",
    generalDescription: "Appearance mode, density and interface language",
    theme: "Appearance Mode",
    themeDescription: "Change the overall color tendency of the editor",
    themeSystem: "System",
    themeLight: "Light",
    themeDark: "Dark",
    density: "UI Density",
    densityDescription: "Compact, regular or automatic layout based on window size",
    densityAuto: "Automatic",
    densityCompact: "Compact",
    densityRegular: "Regular",
    densityComfortable: "Comfortable",
    language: "Language",
    languageDescription: "Choose the interface language (Simplified Chinese is primary)",
    languageZhCN: "Simplified Chinese",
    languageEn: "English (Beta)",
    terminalRunDescription: "Terminal display, run and debug configuration",
    sourceControlDescription:
      "Configure the Git remote fetch and push URLs for the current workspace",
    openPerformance: "Open Performance Test",
    openPerformanceDescription: "Run the full benchmark suite and review local performance history",
    openAbout: "About Aurona Code",
    openAboutDescription: "View version, build information and open-source licenses",
    checkUpdate: "Check for Updates",
    checkUpdateDescription: "Manually check GitHub Releases for a new version",
    checkingUpdate: "Checking…",
    resetApp: "Factory Reset",
    resetAppDescription: "Clear all local data and restore the initial installation state",
    resetAppAction: "Reset Application",
    advancedDescription: "Experimental options, updates and factory reset",
    advancedEmpty: "Experimental and developer options are coming soon",
    categories: {
      general: "General",
      appearance: "Appearance",
      editor: "Editor",
      codeIntelligence: "Code Intelligence",
      terminalRun: "Terminal & Run",
      sourceControl: "Source Control",
      accountCloud: "Aurona Account",
      system: "Storage",
      advanced: "Advanced",
    },
    editorSection: {
      title: "Editor Settings",
      description: "Configure the look and behavior of the code editor",
      fontSize: "Font Size",
      fontSizeDescription: "Controls the main code font size",
      lineHeight: "Line Height",
      lineHeightDescription: "Adjusts line spacing and keeps cursor coordinates in sync",
      tabWidth: "Tab Width",
      tabWidthDescription: "Controls the visual width of Tab characters",
      wordWrap: "Word Wrap",
      wordWrapDescription: "Wrap lines that exceed the viewport width",
      minimap: "Minimap",
      minimapDescription:
        "The lightweight editor kernel does not support the minimap yet; this option will open once it is implemented",
      unavailable: "Unavailable",
    },
    terminalSection: {
      fontSize: "Font Size",
      fontSizeDescription: "Controls the terminal font size",
      cursorBlink: "Cursor Blink",
      cursorBlinkDescription: "Whether the terminal cursor breathes",
    },
    sourceControlSection: {
      noRepo: "No Git workspace detected",
      noRepoDescription:
        "No valid directory is open in the workspace. Open a folder containing a Git repository in the explorer, then configure credentials here.",
      currentRepo: "Current Workspace Repository",
      localConfig: "Local Config",
      remoteUrl: "Remote Repository URL",
      remoteUrlDescription: "Used for fetching from and pushing to the current repository",
      credentialsNote:
        "Credentials are managed by Git Credential Manager, the system keychain or SSH keys. Aurona Code never writes usernames, passwords or tokens into the remote URL.",
      localOnly: "Only modifies this repository's Git remote configuration",
      applying: "Applying…",
      apply: "Apply Changes",
    },
    toast: {
      noGitWorkspace: "No valid Git project is open in the current workspace",
      enterRemoteUrl: "Enter a remote repository URL",
      credentialWarning:
        "Use Git Credential Manager or SSH keys to manage credentials; do not write credentials into the remote URL",
      remoteUpdated: "Remote repository URL updated",
      saveFailed: "Save failed: {message}",
      upToDate: "You are up to date",
      checkUpdateFailed: "Update check failed: {message}",
      cacheCleared: "Cache and configuration cleared. Restart the app.",
    },
    appearanceSection: {
      title: "Appearance & Color",
      description: "Adjust workspace colors and background atmosphere in one place",
      accentTitle: "Color Theme",
      accentDescription:
        "Each of the eight themes has a complete light/dark gradient design that drives interaction accents, focus and feedback",
      defaultBadge: "Default",
      effectsTitle: "Visual Effects",
      effectsDescription: "Adjust glass material strength and dynamic texture",
      intensity: "Material Intensity",
      intensityDescription: "Controls glass blur, transparency and menu/card depth together",
      liquid: "Flowing Light",
      liquidDescription:
        "A soft, low-opacity light band sweeps slowly across the window; it never follows the mouse or highlights cards",
      liquidLabel: "Enable flowing light",
    },
    codeIntelligence: {
      experienceTitle: "Language Experience",
      experienceDescription:
        "Control how Hover and completion actually trigger. Changes apply immediately.",
      hover: "Hover Information",
      hoverDescription: "Show types, signatures and documentation when hovering over a symbol.",
      hoverDelay: "Hover Delay",
      hoverDelayDescription:
        "Wait until the mouse settles before requesting, to avoid spamming the server.",
      completion: "Automatic Completion",
      completionDescription: "Request suggestions while typing; Ctrl+Space always works manually.",
      serversTitle: "Built-in Language Servers",
      serversDescription:
        "Built-in servers ship with Aurona Code and never download anything at runtime.",
      builtin: "Built-in",
      start: "Start",
      restart: "Restart",
      stop: "Stop",
      openOutput: "Open Output",
      notStarted: "Not started",
      stopped: "Stopped",
      starting: "Starting",
      initializing: "Initializing",
      running: "Running",
      restarting: "Restarting",
      failed: "Failed to start",
      stopping: "Stopping",
    },
    debug: {
      experienceTitle: "Debug Experience",
      experienceDescription: "Control debug panel, pause and log behavior.",
      openSidebar: "Open Sidebar on Start",
      stopOnEntry: "Stop on Entry",
      console: "Debug Console",
      consoleIntegrated: "Integrated Console",
      consoleTerminal: "Integrated Terminal",
      consoleNone: "Don't Open",
      adapterLogLevel: "Adapter Log Level",
      logError: "Errors only",
      logInfo: "Info",
      logDebug: "Debug",
      runtimesTitle: "Runtime Paths",
      runtimesDescription: "Launch programs directly without a shell; nothing is downloaded.",
      python: "Python",
      node: "Node.js",
      adaptersTitle: "Built-in Debug Support",
      adaptersDescription:
        "The protocol client and UI are provided by Aurona; the Python debug component checks for an install entry on first use.",
    },
    storage: {
      title: "Storage",
      description: "Monitor and clean the disk space used by Aurona Code by real directories",
      localDataUsed: "local data used",
      appDataDir: "App local data directory",
      note: "Entries above map to real files and folders in the app local data directory; WebView cache is rebuilt automatically, while configuration, workspace state and recovery snapshots are core data, so clear them with care.",
      detailsTitle: "Storage Breakdown & Cleanup",
      groupCore: "Core Data",
      groupCache: "Cache",
      groupLogs: "Logs",
      groupOther: "Other",
      clear: "Clear",
      clearing: "Clearing…",
      footerNote:
        "Files in use may not be deleted immediately; reopening the page shows the latest usage. To reset all app data, go to Advanced → Factory Reset.",
      rows: {
        config: {
          name: "User Preferences",
          description:
            "Theme, appearance, fonts and language service preferences; restores defaults after a restart",
        },
        workspace: {
          name: "Workspace State",
          description: "Recent folders, tabs and layout memory; the layout resets after a restart",
        },
        recovery: {
          name: "Editor Recovery Snapshots",
          description:
            "Used to recover unsaved documents after an abnormal close; clear only if you no longer need them",
        },
        cache: {
          name: "WebView Rendering Cache",
          description:
            "WebView2 cache and temporary files, usually the largest part; rebuilt on next launch",
        },
        logs: {
          name: "App Logs",
          description:
            "Diagnostic logs for app lifecycle, the Tauri process and the terminal console",
        },
        errlogs: {
          name: "Error Logs",
          description: "Crash and error records; safe to clear after troubleshooting",
        },
        performance: {
          name: "Performance Baseline",
          description: "Local baseline data; the next benchmark rebuilds it",
        },
        other: {
          name: "Other Local Data",
          description: "Small residual files not covered by the categories above",
        },
      },
      toasts: {
        configCleared: "User configuration cleared. Restore defaults after a restart.",
        workspaceCleared: "Workspace state cleared. Layout resets after a restart.",
        recoveryCleared: "Editor recovery snapshots cleared",
        cacheCleared: "WebView cache cleared. It rebuilds on next launch.",
        logsCleared: "App logs cleared",
        errlogsCleared: "Error logs cleared",
        performanceCleared: "Performance baseline reset. The next benchmark rebuilds it.",
        otherCleared: "Residual data cleared. Some space may free up after a restart.",
        clearFailed: "Clear failed: {message}",
      },
    },
    definitions: {
      theme: { title: "Appearance Mode", description: "Light, dark or system" },
      density: { title: "UI Density", description: "Compact, regular or comfortable" },
      accentTheme: {
        title: "Color Theme",
        description: "Pick the workspace accent and background",
      },
      liquidTexture: {
        title: "Flowing Light",
        description: "A soft light band sweeps across the window",
      },
      hoverEnabled: { title: "Hover Information", description: "Show types and docs on symbols" },
      hoverDelayMs: {
        title: "Hover Delay",
        description: "How long to wait before requesting hover",
      },
      automaticCompletion: {
        title: "Automatic Completion",
        description: "Request suggestions while typing",
      },
      editorFontSize: { title: "Editor Font Size", description: "Main code font size" },
      editorLineHeight: { title: "Editor Line Height", description: "Height of code lines" },
      editorTabSize: { title: "Indent Width", description: "Spaces per Tab" },
      editorWordWrap: { title: "Word Wrap", description: "Wrap lines to the viewport" },
      terminalFontSize: { title: "Terminal Font Size", description: "Terminal font size" },
      terminalCursorBlink: {
        title: "Terminal Cursor Blink",
        description: "Blink the terminal cursor",
      },
      pythonPath: { title: "Python Path", description: "Python interpreter used for debugging" },
      nodePath: { title: "Node Path", description: "Node executable used for debugging" },
      stopOnEntry: {
        title: "Stop on Entry",
        description: "Pause at the entry point when debugging starts",
      },
      logLevel: { title: "Log Level", description: "Verbosity of developer diagnostics" },
    },
  },
  account: {
    title: "Aurona Account",
    signedIn: "Signed in",
    signedOut: "Signed out",
    refreshProfile: "Refresh profile",
    advancedInfo: "Advanced information",
    defaultDisplayName: "Aurona User",
    intro:
      "Connect Aurona Code with your official Aurona account. Authorization completes in your system browser; the app never reads or stores your password.",
    scopesNote:
      "Signing in grants these capabilities for identity, profile and a secure refresh token.",
    noEmail: "No email authorized for Aurona Code",
    login: "Sign in with Aurona Account",
    loginFailed: "Sign-in could not be completed. Please try again.",
    cancelLogin: "Cancel sign-in",
    cancelFailed: "Could not cancel sign-in. Please try again later.",
    logout: "Sign Out",
    logoutFailed: "Sign out failed. Please try again later.",
    signingOut: "Signing out…",
    refreshing: "Refreshing…",
    refreshFailed: "Profile refresh failed. Please try again later.",
    refreshToast: "Profile refreshed",
    loginToast: "Signed in with Aurona Account",
    logoutToast: "Signed out",
    notConfigured: "This build does not have an Aurona Account client configured.",
    preparingLogin: "Preparing sign-in…",
    connecting: "Connecting to Aurona Account…",
    awaitingCallback: "Complete authorization in your system browser",
    exchangingCode: "Securely verifying your account…",
    restoringSession: "Restoring your session…",
  },
};

const MESSAGES: Record<Locale, typeof zhCN> = {
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
