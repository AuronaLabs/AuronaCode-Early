# Aurona Code 产品愿景与长期演进

## Pioneer 5 收敛里程碑

Pioneer 5 是一次产品表达收敛版本，冻结新的 SDK、Runtime、Marketplace 能力和页面入口，优先确保已有能力可被稳定、清晰地使用。

- 工作台和内部页面使用 base、raised、overlay 三层 surface 语法；重复项目才使用 Card，页面分组使用 section、divider 和标题层级。
- Marketplace 只有 Discover、Installed、Toolchains 三个并列模式。Toolchains 是 LSP 与 Runtime 安装、版本、启停、重启和卸载的唯一入口。
- 搜索输入只筛选当前目录，Enter 或搜索动作才提交远程查询；取消的请求不会改变 offline 状态，也不能覆盖新结果。
- 保留 Tab Keep-Alive 状态，但隐藏非活动 Canvas/WebView 的组成表面；动态模块失败必须提供可恢复操作。

Pioneer 5 的验收重点是路径一致、数据真实、状态可恢复和视觉层级可扫描，而不是新增功能数量。

## 1. 为什么创立 Aurona Code？

写代码这件事，值得一个更舒服、更安静、也更顺手的角落。

在 Electron 框架与重型 Monaco 编辑器一统天下的今天，编辑器越来越庞大、资源占用越来越高。Aurona Code 希望证明：**依靠 Tauri 2 与自研 Rust 引擎，桌面代码编辑器可以做到更小巧、更快速、更富有个性与质感**。

---

## 2. 长期演进路线图

### 第一阶段：核心闭环与自研底座（当前阶段 · v0.3.x）
- 自研 AuronaEngine 虚拟视口与 Rust Ropey 文本模型；
- Fliuno 统一搜索系统（命令/文件/符号/内容）；
- 基于 WASM Component Model (WASI P2) 的扩展沙箱底座与官方扩展（Markdown 预览、Planner 任务看板、VSCode 兼容转译层）；
- 全链路国际化 (zh-CN / zh-Hant / en) 与现代拟物双色渐变材质。

### 第二阶段：生态扩展与兼容深化
- 完善 VSCode 扩展转译运行层，支持一键加载运行主流常用 VSCode 扩展；
- 扩展多编辑器分栏与大文件分页编辑能力；
- 语言服务（LSP）与调试协议（DAP）全面丰富与独立包拆分。

### 第三阶段：全平台与社区协同
- 完善 Windows / macOS / Linux 深度平台特性；
- 插件市场与社区扩展生态分发中心；
- 面向轻量协作的离线优先同步协议。
