# Aurona Material 设计原则

Aurona Code 的界面需要在高信息密度下保持清晰、现代与桌面应用质感。材质用于表达层级，不是为每个区域添加模糊和卡片。

## 语义材质

- **Canvas**：应用和编辑器的最底层背景。
- **Chrome**：标题栏、活动栏和状态栏等桌面框架。
- **Panel**：侧边栏和底部面板。
- **Surface**：需要与 Panel 区分的局部内容面。
- **Overlay**：菜单、命令面板和浮层。
- **Modal**：需要阻断当前操作的对话框。
- **Interactive**：按钮、列表项和可选项的 hover/active/focus 状态。

相应 token 定义在 `Src/App/Styles/Theme.css`，新组件优先使用 `--material-*`、`--space-*`、`--radius-*`、`--control-height-*` 和统一焦点环。旧 `--Glass*` 变量仍作为迁移别名，不应继续扩展新变体。

## 拟物强度

`light`、`medium` 和 `heavy` 表达的是材质分离强度，不是简单的透明度开关。深浅主题分别校准：浅色需要保留背景色彩和边界，深色需要更高模糊来形成相同的视觉纵深。新增档位时应修改 `UI/Core/GlassManager/glassConfig.ts` 并补充测试，禁止依靠业务页面硬编码 blur。

## 交互原则

1. 选中态同时使用形状、层级或标识，不只靠大面积主题色。
2. 键盘焦点必须可见；禁止全局 `outline: none`。Radix 组件需保留正确的语义和导航。
3. 动画只用于说明状态变化，使用具体属性，遵守 `prefers-reduced-motion`。动画不用于掩盖加载耗时。
4. blur 仅用于 Chrome、Overlay 和 Modal；大面积 Panel 默认使用稳定材质。
5. 必须验证 800×600、100/125/150/200% DPI、深浅主题和文字溢出。

## 组件原则

- 优先复用 `UI/Components` 中的 Button、Input、Select、Modal、IconButton 和菜单组件。
- 图标统一通过 `UI/Icons/IconManager.tsx`，避免业务页各自选择线宽和尺寸。
- 中文 UI 使用系统字体栈；编辑区保留 JetBrains Mono；品牌字体仅在必要位置使用。
- 少量动态尺寸可使用 inline style，长期视觉规则应进入 token 或共享组件。
- 输入框的焦点反馈应由玻璃外壳承担，避免 WebView 默认蓝色内框与容器焦点形成双层结构。
- 开关开启态至少通过位置和一个额外信号共同表达，不能只依赖低对比透明度变化。
- Diff、诊断和 Git 状态等语义颜色只用于内容含义；容器层级仍使用 Material token。
