# 参与贡献

感谢你愿意让 Aurona Code 更好用。缺陷修复、测试、文档、性能分析和经过讨论的体验改进，都是有价值的贡献。

**Create Without Limits. · 创造无限可能**

## 找到合适的起点

先搜索已有 [Issues](https://github.com/AuronaLabs/AuronaCode-Early/issues) 与 [Pull Requests](https://github.com/AuronaLabs/AuronaCode-Early/pulls)，了解当前讨论与正在进行的工作。

小型修复和文档改进可以直接提交 PR。涉及编辑器协议、状态所有权、桌面权限、依赖替换或大规模界面结构时，建议先通过 Issue 对齐问题、范围和验证方式。

潜在漏洞请按[安全策略](SECURITY.md)私密报告。社区互动遵循[行为准则](CODE_OF_CONDUCT.md)。

## 准备开发环境

当前版本为 **0.4.17**。与 CI 对齐的工具链如下：

| 工具 | 版本或要求 |
| --- | --- |
| Node.js | 22 |
| pnpm | 12.15.0，以 `package.json` 的 `packageManager` 为准 |
| Rust | 1.95.0 |
| 扩展编译目标 | `wasm32-wasip2` |
| 系统依赖 | Tauri 2 对应平台依赖；Windows 需 C++ Build Tools |

准备好系统工具链后，在仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
rustup target add wasm32-wasip2
pnpm run prepare:extensions
pnpm run tauri:dev
```

`pnpm run dev` 只启动前端预览。Git、文件、终端与其他宿主能力需要桌面模式。

仓库还提供 `python manager.py` 作为可选命令入口，使用前需安装 Python 和 Rich；它不属于构建必需依赖。

## 理解仓库边界

- `App` 负责启动与服务装配，`Features` 组织功能与用例，`Layout` 承载工作台布局。
- `Core` 管理领域服务，通过公开接口协作；`UI` 提供可复用控件与材质。
- Tauri API 直接适配集中在 `Foundation/Desktop`，业务使用类型化 IPC。
- 长期状态有明确的可写来源，事件用于表达通知或意图。
- Rust 文本模型管理持久文档，编辑与保存需要考虑 UTF-16、CRLF、IME 和恢复。
- 扩展运行时与命令注册分别管理，避免通过名称或 ID 猜测业务行为。

更多背景见[架构说明](../Docs/Architecture.md)、[设计规范](../Docs/Design-Principles.md)与[扩展开发](../Docs/Extension-Development.md)。

## 建议工作流

1. 从最新 `main` 创建范围明确的分支。
2. 复现问题，记录预期行为与实际结果。
3. 围绕问题修改模块，并为行为变化补充适当回归。
4. 更新关联文档，明确能力、配置与验证范围。
5. 运行与本次修改匹配的检查。
6. 提交 PR，说明修改原因、实际验证和仍待确认的边界。

## 按修改范围验证

### 文档

检查标题层级、表格、代码围栏、相对链接、命令与版本表述，运行：

```powershell
git diff --check
pnpm run check:audit
```

更新扩展 README 时留意它可能被打包进扩展资源；纯文案整理无需顺带提交重新生成的二进制归档。

### 前端与共享逻辑

```powershell
pnpm run typecheck
pnpm run check
pnpm run i18n:check
pnpm run check:boundaries
pnpm run check:materials
pnpm run smoke
pnpm run test:frontend
pnpm run build
```

扩展、发布或契约相关修改补充相应验证：

```powershell
pnpm run verify:vscode-compat
pnpm run test:extension-contract
pnpm run test:release-contract
```

### Rust 与桌面能力

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo check --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

`pnpm run quality:full` 汇总本机检查；三平台结果以 GitHub Quality 为准。未运行或受环境限制的项目如实注明，避免把编译、单元测试与桌面使用混为同一种证据。

## 界面改动

复用共享控件和主题令牌，保证选中态与键盘焦点清晰。检查深浅主题、不同材质强度、降低动态效果、窄窗口和常用 DPI；为视觉改动附截图或短视频。

## 让提交容易审阅

PR 说明应包含问题、根因、修改范围、验证结果与相关兼容性影响。保存、权限、IPC、进程生命周期或恢复相关修改，应额外说明数据与状态处理。

提交前移除构建产物、凭据和个人诊断数据。`Dist/`、`node_modules/`、`src-tauri/target/` 和 `.aurona-local/` 不应进入变更。
