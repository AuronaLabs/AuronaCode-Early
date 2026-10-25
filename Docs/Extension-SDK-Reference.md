# 扩展 SDK 参考

本文面向 **Aurona Code 0.4.17** 的原生扩展作者，以 [`Extensions/wit/world.wit`](../Extensions/wit/world.wit) 为接口依据。完整函数签名、类型与注释均保存在该文件，文档按使用场景说明职责与边界。

VS Code API 支持范围另外记录在[兼容层能力矩阵](0.4.17-VSCode-Compatibility-Matrix.md)，两套接口应分别查阅。

## 契约与绑定

- WIT package：`aurona:extensions`。
- world：`aurona-extension`。
- 导入：宿主 `context` 接口。
- 导出：组件 `render` 接口。
- `get-sdk-version` 返回当前契约版本，应用版本通过环境信息获取。

Rust 绑定由 `wit-bindgen` 生成，命名采用 Rust 的下划线形式，例如 `get_environment()`。内置兼容层中的 [`pub mod sdk`](../Extensions/aurona.vscode-compat/src/lib.rs)提供部分便捷封装；它是仓库内实现，独立扩展可直接使用 WIT 生成的绑定。

## 环境与权限

| WIT 函数 | 用途 |
| --- | --- |
| `get-sdk-version` | 获取契约版本 |
| `get-environment` | 获取语言、主题、配色、字体、应用版本和平台 |
| `runtime-metadata` | 获取扩展运行元数据 |
| `request-permission` | 查询或请求一项能力权限 |

权限状态为 `unknown`、`granted` 或 `denied`。工作区路径、文档内容等信息依赖对应授权，调用者应检查返回值，再决定后续操作。

## 文档与编辑

| WIT 函数 | 用途 |
| --- | --- |
| `get-editor-snapshot` | 获取路径、语言、内容和版本快照 |
| `get-editor-selection` | 获取当前选区 |
| `get-editor-selection-text` | 获取选中文本 |
| `insert-editor-text` | 在当前编辑器插入文本 |
| `reveal-editor-line` | 定位编辑器行 |

读取内容需要 `editor.current.read`。快照版本用于识别上下文，异步处理完成后应确认目标仍然有效。读不到内容时，应按权限或文档状态处理，而非把空值当作文件为空。

## 工作区文件

| WIT 函数 | 用途 |
| --- | --- |
| `get-workspace-info` | 获取工作区名称与存在状态 |
| `read-workspace-file` | 读取工作区文本文件 |
| `read-workspace-range` | 按偏移分段读取文本 |
| `write-workspace-file` | 写入工作区文本文件 |
| `list-workspace-files` | 有上限地枚举目录 |
| `get-workspace-file-metadata` | 查询文件或目录元数据 |
| `watch-workspace-path` | 创建工作区路径监听 |
| `unwatch-workspace-path` | 释放监听句柄 |

路径相对于已授权工作区，宿主检查边界与资源限制。分段读取的偏移和长度语义应遵循 WIT 注释；遇到权限拒绝、失效句柄或目录切换时，应重新同步上下文。

## Git

| WIT 函数 | 用途 |
| --- | --- |
| `git-repository-info` | 获取当前仓库与分支信息 |
| `git-status` | 获取变更列表 |
| `git-log` | 获取有数量上限的提交记录 |
| `git-diff` | 获取单文件工作区差异 |
| `git-stage` / `git-unstage` | 暂存或取消暂存 |
| `git-commit` | 提交已暂存内容 |

读取与写入分别依赖 `git.read` 和 `git.write`，路径保持工作区相对形式。非 Git 工作区、缺少权限和操作失败需要分别反馈。

## 交互、命令与诊断

| WIT 函数 | 用途 |
| --- | --- |
| `show-notification` | 请求宿主显示通知 |
| `set-status-message` | 设置带毫秒超时的状态消息 |
| `show-dialog-confirm` | 显示确认对话框 |
| `show-input-box` | 请求单行输入，可返回取消 |
| `show-quick-pick` | 显示选择列表，可返回取消 |
| `read-clipboard` / `write-clipboard` | 读写文本剪贴板 |
| `execute-command` | 调用宿主或已注册命令 |
| `contribute-fliuno-items` | 贡献搜索快捷项 |
| `get-icon-svg` | 获取宿主图标 SVG |
| `log` | 输出结构化诊断日志 |

这些接口通过宿主桥接能力完成操作。请处理 `result`、取消和权限状态，通知文案说明影响与下一步，诊断日志避免包含密钥、完整私有文件或其他敏感数据。

## 存储与事件

| WIT 函数 | 用途 |
| --- | --- |
| `storage-get` / `storage-set` | 读取或保存扩展隔离键值 |
| `storage-delete` | 删除单个键 |
| `storage-list-keys` | 枚举键名 |
| `storage-clear` | 清空当前扩展存储 |
| `poll-events` | 读取宿主排队事件 |

持久数据使用存储接口，写入失败应向调用方传播。事件与 bridge 请求绑定扩展及运行上下文；工作区切换、会话失效或队列溢出后应重新获取快照。

## 渲染与动作

`render` 接口定义两类组件调用：

```wit
render: func(input: render-input) -> result<render-output, string>;
on-action: func(action-id: string, payload: string) -> result<render-output, string>;
```

`render-input` 当前包含 `markdown` 字段；`render-output` 包含 `html` 和 `diagnostics`。动作负载由扩展按约定解释，动作返回下一次视图输出。

宿主可能复用运行会话，扩展仍需通过存储保存跨会话数据。命令、订阅和其他临时资源应随会话释放，不能依赖窗口关闭时才统一回收。

## 声明式视图

声明式组件输出由宿主的 [`Declarative`](../Src/Features/Extensions/Declarative/) 渲染器处理。可用组件与属性应对照实现，HTML 视图则遵循包模板、CSP 与清洗规则。

深浅主题、键盘焦点、内容密度和材质层次按[设计规范](Design-Principles.md)处理；自定义视图应验证主题切换时的实际显示。

## 资源与信任边界

bridge、事件、watcher、内存与执行时间由宿主预算管理，当前默认值见 [`resource_limits.rs`](../src-tauri/src/resource_limits.rs)与[扩展运行时](../src-tauri/src/extensions/runtime.rs)。

安装前的包认证、运行前的确认、能力权限与资源限制分别生效。具体设置见[安全与信任](Security-and-Trust.md)，包与目录认证见[签名指南](Extension-Signing-Guide.md)。

接口存在、单元测试通过、真实组件运行和第三方扩展可用是不同层次的证据。扩展发布时请说明实际验证的平台、宿主版本与使用场景。
