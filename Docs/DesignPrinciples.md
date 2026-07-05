# 设计规范 (Design Specifications)

Aurona Code 的设计语言以**“极简功能美学”**和**“动态交互感”**为核心，致力于打造沉浸式的现代操作系统级开发体验。

## 核心视觉规范

1. **玻璃态与光影 (Glassmorphism & Lighting)**
   摒弃死板的纯色块，广泛运用半透明背景、磨砂模糊（backdrop-blur）与内阴影/高光（shadow-inner）制造空间层次感。
   深色模式下的背景使用带有局部鲜艳折射光的微渐变 `radial-gradient`，提升应用的高级质感。

2. **和谐的色彩收敛**
   严禁在业务组件中硬编码使用高饱和度的通用色（如纯红、纯蓝）。所有的状态色、指示色都必须经过精心调配的 CSS Variables（如 `--ColorTabIndicator`、`--ColorTextHighlight`）来读取。
   确保系统在浅色与深色模式下都能优雅地自适应呈现，且颜色绝不可突兀。

3. **微交互与动效 (Micro-animations)**
   生动的系统应该是具备响应性的。对于任何按钮点击、菜单弹出，都应具备柔和的 `transition` 和 `animate-in`（如 Tailwind 提供的 `zoom-in` / `fade-in`）。
   这些微小的动效不仅能够隐藏后台耗时操作（如 IPC 通信），还能大幅提升用户参与度。

## 技术实现规范

- **原子化 CSS 框架**：全面使用 Tailwind CSS v4，严禁编写大量内联 `style` 或分离的 `.css` 类（除非是针对编辑器组件等特殊情况的覆盖）。
- **组件库一致性**：基础组件（如按钮、输入框、下拉框）需提取至 `Src/UI/Components`，严禁在业务视图里重复造轮子。
- **图标标准化**：项目内所有的图形图标统一收敛至 `Src/UI/Icons/IconManager.tsx`，使用 Tabler Icons，并以 `<Icons.Name />` 的形式统一管理和渲染。
