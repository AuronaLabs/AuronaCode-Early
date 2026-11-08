# VS Code 扩展兼容范围

适用版本：**0.5.0 Alpha1**。Aurona Code 通过内置兼容扩展提供部分 VS Code API 桥接，不提供完整 VS Code 或 Node.js 环境。

## 支持边界

| 能力 | 当前范围与限制 |
| --- | --- |
| 包导入与激活 | 本地 `.vsix`、清单、激活事件与会话生命周期；实际扩展需逐个验证 |
| 命令与资源释放 | 命令参数、返回结果、错误、Disposable 和订阅清理 |
| 文档与工作区 | 文档快照、变化事件、URI 与受权限约束的文件访问 |
| 配置与存储 | 配置读取及部分变更语义、按扩展或工作区隔离的 Memento |
| 界面桥接 | 基础消息、剪贴板、状态栏、TreeView、主题图标与隔离 Webview |
| 模块装载 | 包内相对 CommonJS JS/JSON 与模块缓存；原生 Node 模块和完整 Node 标准库不受支持 |
| 安全与诊断 | 本地包认证、执行确认、能力权限和运行预算分别生效；不支持的 API 应提供诊断 |

扩展声明 `engines.vscode` 表示其需要的 API 版本，不代表 Aurona Code 完整覆盖该版本。扩展依赖的 API、原生模块、外部程序和平台能力都会影响实际兼容性。

## 验证一个扩展

1. 记录扩展 ID、精确版本、许可、包来源与所需 API。
2. 从本地包导入，验证激活、命令、文档事件和主要功能。
3. 检查中文路径、深浅主题、工作区切换和重新打开。
4. 验证禁用、卸载、失败和取消后的资源释放。
5. 按实际平台和结果记录兼容范围，不以接口存在或编译通过代替功能验收。

可以从[兼容 Demo](../../../Extensions/vscode.demo/README.md)开始。桥接实现与契约分别位于 `Extensions/aurona.vscode-compat/` 和 `scripts/vscode-compat-contract.test.mjs`；Aurona 原生扩展接口另见 [SDK 参考](SDK-Reference.md)。

[扩展开发](Development.md) · [返回扩展指南](README.md)
