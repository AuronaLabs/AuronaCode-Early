# Aurona VS Code Bridge Demo

一个小而清楚的 `.vsix` 演示，用于验证 **Aurona Code 0.4.17** 的 VS Code 兼容层调用链。

Demo 使用 `vscode` 模块注册命令，由 Aurona 内置 WASM 兼容运行时加载。它展示已支持的基础能力，便于开发者观察激活、调用与释放过程。

## 演示内容

| 命令 | 行为 |
| --- | --- |
| `vscodeDemo.helloWorld` | 通过宿主显示问候通知 |
| `vscodeDemo.showStatus` | 显示 4 秒状态栏消息 |

命令的 Disposable 加入 `context.subscriptions`；扩展同时提供 `activate` 与 `deactivate` 入口。

## 本地体验

1. 在仓库根目录运行 `pnpm run prepare:extensions`，生成兼容层与 Demo 包。
2. 运行 `pnpm run tauri:dev` 启动桌面工作台。
3. 通过「设置 → 扩展」中的 VS Code 测试插件入口安装 Demo，按当前安全设置完成确认。
4. 执行演示命令，检查通知与状态消息。
5. 关闭、重开、停用或卸载，检查命令与资源生命周期。

## 支持范围

包清单声明 `engines.vscode: ^1.85.0`，这表示 Demo 的 API 目标，不代表 Aurona 实现了该版本的全部 API。

当前兼容能力与限制见[能力矩阵](../../Docs/0.4.17-VSCode-Compatibility-Matrix.md)。依赖完整 Node.js、原生模块或未支持宿主服务的扩展需要另外验证。
