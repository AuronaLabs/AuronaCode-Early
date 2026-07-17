# 贡献指南

感谢你愿意帮助 Aurona Code 变得更可靠。项目仍处于早期阶段，欢迎缺陷修复、性能优化、测试、文档和经过讨论的产品改进。

## 开始之前

- 搜索已有 Issue 和 Pull Request，避免重复工作。
- 小型缺陷可以直接提交 PR；涉及编辑器协议、状态所有权、桌面权限、依赖替换或大规模 UI 结构时，请先创建 Issue。
- 不要把插件市场、AI Command Center、云服务等尚未立项的方向夹带进无关修复。
- 安全漏洞不要提交公开 Issue，请遵循 [安全策略](SECURITY.md)。

## 开发环境

需要 Node.js 22 或更高版本（CI 使用 22）、pnpm 11.13.0、Rust stable 和当前平台的 Tauri 2 系统依赖。

```powershell
corepack enable
corepack install --global pnpm@11.13.0
pnpm install --frozen-lockfile
pnpm run tauri:dev
```

可选的交互式管理器需要 Python 和 Rich：

```powershell
python -m pip install rich
python manager.py
```

管理器只是命令入口，不是构建依赖。

## 仓库边界

- 前端业务代码位于 `Src/App`、`Src/Layout` 和 `Src/Features`。
- 可复用视觉组件位于 `Src/UI`，不要让 UI 基础组件反向依赖 Git、编辑器或工作区业务。
- 只有 `Src/Foundation/Desktop` 可以直接导入 `@tauri-apps/*`。
- 长期工作台状态写入 Zustand；EventBus 只用于短暂通知和导航意图。
- Rust 是持久文档权威。编辑、保存、revision 或恢复相关变更必须同时考虑 UTF-16、CRLF、IME 和数据安全。
- `Src/Extension` 当前只是命令注册，不是插件运行时。

详细说明见 [Architecture.md](../Docs/Architecture.md) 和 [FileTree.md](../Docs/FileTree.md)。

## 建议工作流

1. 从最新 `main` 创建范围明确的分支。
2. 先复现问题，记录修改前行为。
3. 只修改解决问题所需的模块，避免夹带机械重构。
4. 为纯函数、状态协议、恢复、命令或边界行为补充测试。
5. 更新与实现发生变化的 README、Docs、模板或版本记录。
6. 完成适合本次范围的自动验证和桌面手工验证。
7. 提交 Pull Request，明确已运行、未运行和环境阻塞的检查。

## 提交前检查

前端和文档变更至少运行：

```powershell
pnpm run typecheck
pnpm run check
pnpm run check:boundaries
pnpm run smoke
pnpm run test:frontend
pnpm run build
git diff --check
```

涉及 Rust 或桌面能力时继续运行：

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo check --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

Windows 若找不到 MSVC linker，请在 Visual Studio Build Tools 开发者环境中重试。未运行的检查必须写成“未运行”或“环境阻塞”，不要写成通过。

## UI 变更要求

- 复用 Aurona Material token 和 `Src/UI/Components`，避免在业务页复制控件。
- 选中态不能只依赖大面积主题色；键盘焦点必须可见。
- 验证深色、浅色、三个拟物强度和 reduced motion。
- 至少检查 800×600 和常用 DPI；文字、菜单、按钮不得溢出。
- Diff、错误和 Git 状态的红绿语义不能被玻璃效果削弱。

## Pull Request 内容

请说明：

- 用户问题和根因。
- 修改范围与明确未修改的内容。
- 数据、权限、性能或跨平台风险。
- 自动测试和手工测试结果。
- 对视觉改动提供截图或短视频。

保持提交清晰可审阅。不要提交 `Dist/`、`node_modules/`、`src-tauri/target/` 或 `.aurona-local/`。
