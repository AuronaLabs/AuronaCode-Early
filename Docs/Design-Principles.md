# Aurona Code 设计哲学与材质系统规范

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
