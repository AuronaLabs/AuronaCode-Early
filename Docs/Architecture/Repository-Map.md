# 仓库地图与模块放置

这份地图描述 0.5.0 Alpha1 开发分支的实际组织。依赖规则与所有权见[架构总览](README.md)，本轮迁移明细见[验收记录](../Development/0.5.0-alpha.1/Implementation.md)。

## 顶层目录

| 位置 | 存放内容 | 放置原则 |
| --- | --- | --- |
| `Src/` | 桌面前端、领域服务与平台适配 | 按职责分层，再按领域组织 |
| `src-tauri/src/` | Rust 原生运行时与 IPC 适配 | 状态、事务、访问控制归领域；命令只适配 |
| `Extensions/` | 内置与示例扩展源码 | 使用宿主契约，不穿透工作台实现 |
| `Tests/` | 独立集成测试 | 真实服务与跨模块场景；单元回归就近放置 |
| `scripts/` | 检查、构建、打包与发布辅助 | `lib/` 放复用逻辑，`data/` 放规则与历史审计数据 |
| `Docs/` | 多语言 README、指南、架构与当前开发记录 | 按用途导航，当前事实与历史记录分开 |
| `.github/` | 协作策略与 CI 工作流 | 与仓库命令保持同步 |

`Dist/`、`node_modules/`、`src-tauri/target/`、本地 candidate 和验证日志属于运行或生成数据，不是业务模块。不要把机器路径、凭据或个人日志放进源码目录。

## 前端怎么放

| 位置 | 负责什么 | 例子 |
| --- | --- | --- |
| `App/Bootstrap` | 启动时的平台与领域适配 | 统一外观应用、文档语言适配器 |
| `App/Contributions` | 功能向工作台注册能力 | 内建命令、SDK UI 端口、宿主桥接 |
| `App/Workbench` | 跨领域的工作台生命周期 | 恢复、持久化、授权协调 |
| `Core/<Domain>` | 独立于 React 的领域状态与操作 | 文档事务、Git 缓存、扩展 Registry |
| `Foundation` | 通用基础设施与平台接口 | IPC、存储、事件、生命周期、主题快照 |
| `State` | React 绑定与工作台呈现状态 | 标签、布局、领域快照投影 |
| `Features/<Feature>` | 功能页面与局部交互 | `hooks/` 管视图流程，`components/` 管局部展示 |
| `Layout` | 区域与功能组合 | 工作台、标题栏、底部面板 |
| `UI` | 通用控件与反馈 | 按钮、菜单、材质、Toast、图标 |
| `Shared` | 已有共享类型、常量与纯工具 | Tab 类型、URI 与语言工具 |

领域内实现可以互相引用；领域外使用 `scripts/data/source-domains.json` 声明的公开入口。新增抽象应有实际调用者、状态所有者和测试，避免为了目录对称创建空层。

### 源代码管理示例

`SourceControl.tsx` 组织页面和展示状态；`hooks/useSourceControl.ts` 管页面订阅、异步上下文、操作互斥和反馈；`components/GitFileRow.tsx` 管文件行呈现及键盘焦点。仓库缓存、查询和失效仍由 `Core/Git` 管理。

视图退出只释放自己的订阅。切换工作区使旧页面结果失效，不能因为侧栏卸载而取消其他消费者的共享查询或正在进行的仓库写操作。

## Rust 怎么放

| 领域 | 组织 |
| --- | --- |
| `workspace/` | 会话与路径授权、`filesystem/` 文件能力、`digest.rs` 摘要、`ipc.rs` 命令 |
| `git/` | 仓库操作、`recovery.rs` 恢复、`ipc.rs` 命令与 `tests.rs` |
| `editor/` | 文本模型、`ipc.rs` 命令与 `tests.rs` |
| `extensions/runtime/` | `host.rs` 能力实现、`resources.rs` 所有权、`limits.rs` 预算与测试 |

`commands/mod.rs` 仍有保留 handler 命名的 fs/git 重导出，新的领域调用直接引用对应领域。没有迁移的 LSP、DAP 和 Agent 模块继续按现有组织维护，不借本轮文档宣称全仓已经重构。

## 改动前判断

先确定状态由谁写入、异步结果属于哪个上下文、资源由谁释放，再选择文件位置。局部页面逻辑进入 Feature；跨功能装配进入 App 或 Layout；可脱离 UI 的行为进入 Core；平台传输进入 Foundation。

```powershell
pnpm run check:boundaries
pnpm run check:docs
pnpm run test:extension-contract
```

检查器防止已定义的反向依赖、私有入口穿透和运行时环；职责是否清晰仍需要代码审查。

[返回架构总览](README.md) · [返回文档首页](../README.md)
