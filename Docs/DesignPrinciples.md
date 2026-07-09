# 设计规范 (Design Specifications)

Aurona Code 的设计语言以**“极客功能美学”**和**“原生动态交互”**为核心，致力于打造超越传统的现代操作系统级开发体验。

## 核心视觉规范 (Corona+ 玻璃态时代)

1. **极致玻璃态与光影 (Frosted Glass & Lighting)**
   全面引入新时代的 `frosted-glass` 玻璃态材质。摒弃死板的纯色块，广泛运用半透明背景、磨砂模糊（backdrop-blur）与内阴影/高光（shadow-inner）制造空间透视感。
   深色模式下的背景使用微渐变折射光，提升应用的高级质感。所有弹出层、上下文菜单、浮层 UI 必须严格继承该材质。

2. **和谐的色彩收敛系统**
   严禁在业务组件中硬编码高饱和度的通用色（如纯红、纯蓝）。所有的状态色、指示色都必须经过 Tailwind CSS 主题变量（如 `--TextHighlight`、`--GlassBorder`）来读取。
   确保系统在浅色与深色模式下都能优雅地自适应，并且完全无视操作系统的反色配置带来困扰。

3. **微交互与动效 (Micro-animations)**
   应用必须具备生命力。对于按钮点击、悬浮、菜单弹出，均通过 Tailwind 提供的 `transition` 和 `animate-in`（如 `zoom-in` / `fade-in`）实现丝滑过渡。
   特别是复杂的弹出组件，需借助 Radix UI 提供的动画支持能力，让动效不仅好看，而且在性能瓶颈期也能优雅掩盖加载耗时。

## 技术实现规范

1. **原子化 CSS 框架 (Tailwind CSS v4)**
   全面升级为无配置文件的 Tailwind CSS v4，严禁编写大量内联 `style` 或分离的 `.css` 类。唯一特例是将关键且易被 Purge 剔除的混合类（如 `.frosted-glass`）提至全局 CSS。

2. **无头组件库 (Radix UI)**
   全面整合 Radix UI 无头组件库，对 Select、Switch、Modal、ContextMenu 进行深度定制。所有的基础组件库提取至 `Src/UI/Components`，严禁在业务视图重复造轮子。Radix UI 同时也保障了我们对键盘导航的完美支持（如使用上下左右键穿梭于上下文菜单）。

3. **图标标准化 (Tabler Icons)**
   项目内所有的图形图标统一收敛至 `Src/UI/Icons/IconManager.tsx`，使用 Tabler Icons SVG，并以 `<Icons.Name />` 的形式统一管理和渲染，确保风格统一与体积压缩。
