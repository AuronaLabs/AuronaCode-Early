# Aurona Code 设计哲学与材质系统规范

## Pioneer 6 表面与首启约束

- 视觉表面只分为 `base`、`raised`、`overlay` 三层。材质强度和液态纹理只能调整透明度与模糊，不得创建新的页面层级。首启欢迎引导以全屏覆盖层呈现，同样复用三层表面与主题令牌，不另起炉灶。
- 页面分组优先使用无框 section、divider 和标题层级；Card 只用于重复项目、弹窗和确实需要边界的工具。
- 每个工作流必须有唯一主入口。LSP 与 Runtime 的安装、版本和生命周期全部位于 Marketplace 的 `Toolchains` 模式。
- 输入与远程副作用分离：draft query 只做本地过滤，提交 query 才请求网络，旧响应不得覆盖新状态。
- 退出即清理：关闭软件时前端与 WebView 先行清理，后端在窗口销毁后完成缓存清理，不在后台滞留。

## 1. 核心设计哲学

1. **安静与克制 (Quiet & Focused)**：
   编辑器应当退居幕后，让代码与思维成为视觉重心。状态栏不喧闹，指示器采用轻量圆点呼吸灯，无冗长多余文本。
2. **现代拟物与玻璃质感 (Modern Skeuomorphism & Glassmorphism)**：
   告别千篇一律的死板扁平风。利用微边框（`border`）、内阴影（`inset-shadow`）、多层毛玻璃背景模糊（`backdrop-blur`）与柔和的大圆角（`rounded-xl`），打造有触感、温润精致的工业级质感。
3. **隐私优先与零遥测 (Privacy First & Zero Telemetry)**：
   绝不上传用户文件、代码或击键行为，无隐藏分析追踪，账户功能完全自愿可选。

---

## 2. Aurona Material 材质系统

Aurona Code 内置 8 套双色渐变现代主题，并支持深色与浅色自适应：

| 主题名称 | 渐变基色 | 材质性格 |
| :--- | :--- | :--- |
| **Aurora (极光)** | 极光青蓝 (Cyan/Blue) | 清爽现代，默认科技质感 |
| **Sunset (日落)** | 暖阳金橙 (Amber/Rose) | 温润明亮，专注舒适 |
| **Forest (森林)** | 苍翠林木 (Emerald/Teal) | 沉静护眼，自然自然 |
| **Neon (霓虹)** | 霓虹紫粉 (Violet/Fuchsia) | 赛博未来，极富张力 |
| **Ocean (深海)** | 蔚蓝深邃 (Sky/Indigo) | 开阔沉稳，专业代码流 |
| **Sakura (樱花)** | 柔粉樱白 (Pink/Rose) | 优雅温和，细腻轻快 |
| **Monochrome (黑白)** | 纯粹灰度 (Slate/Zinc) | 极简克制，专注黑白灰 |
| **Cyberpunk (赛博)** | 黄黑对冲 (Yellow/Dark) | 工业前卫，高对比度 |
