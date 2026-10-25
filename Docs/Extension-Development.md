# 扩展开发指南

Aurona Code **0.4.17** 使用 WebAssembly Component Model 与 WASI Preview 2 承载原生扩展，通过 `.aurx` 分发；VS Code 扩展使用 `.vsix`，由内置兼容层执行已支持的 API。

本指南帮助你找到正确的开发入口。接口详情见 [SDK 参考](Extension-SDK-Reference.md)，VS Code 扩展作者请同时阅读[兼容层能力矩阵](0.4.17-VSCode-Compatibility-Matrix.md)。

## 选择扩展类型

| 类型 | 包格式 | 适合场景 | 开发依据 |
| --- | --- | --- | --- |
| 原生扩展 | `.aurx` | 使用 Aurona 宿主能力与视图契约 | WIT world、组件导出和包清单 |
| VS Code 兼容扩展 | `.vsix` | 使用兼容层已支持的命令、文档与视图 API | 兼容矩阵与 Demo 的真实行为 |

VS Code 兼容层运行于 WASM 内的 JavaScript 引擎环境，并非完整 Node.js。依赖 Node 原生模块、特定 VS Code 宿主服务的扩展，需要先确认运行条件。

## 原生扩展包结构

`.aurx` 使用 ZIP-Store 归档结构，清单描述组件、视图与图标：

```text
vendor.my-extension.aurx
├── manifest.json
├── extension.wasm
├── ui/
│   └── index.html
└── assets/
    └── icon.svg
```

- `manifest.json`：身份、版本、宿主要求与视图入口。
- `extension.wasm`：由 `wasm32-wasip2` 目标生成的 WebAssembly 组件。
- `ui/index.html`：视图模板，包含 CSP 和 `<!--AURONA_RENDER_SLOT-->`。
- `assets/icon.svg`：扩展图标，单色图标适合使用 `currentColor`。

可以对照[内置兼容层](../Extensions/aurona.vscode-compat/)与[实际打包脚本](../scripts/build-vscode-compat-extension.mjs)查看完整结构。包格式与 CSP 要求由宿主验证。

## 清单示例

下面的身份和版本为示例值，开发自己的扩展时请替换为真实元数据。

```json
{
  "packageVersion": 1,
  "id": "vendor.my-extension",
  "name": "My Extension",
  "displayName": {
    "zh-CN": "我的扩展",
    "en": "My Extension"
  },
  "publisher": "vendor",
  "version": "0.1.0",
  "engine": {
    "auronaCode": ">=0.4.17"
  },
  "runtime": {
    "component": "extension.wasm"
  },
  "sidebar": {
    "title": "My Tool",
    "icon": "assets/icon.svg"
  },
  "view": {
    "entry": "ui/index.html"
  }
}
```

## 从 WIT 契约开始

当前契约位于 [`Extensions/wit/world.wit`](../Extensions/wit/world.wit)，world 名称为 `aurona-extension`。Rust 组件使用 `wit-bindgen` 生成绑定，导出 `render` 与 `on-action`。

下面的示例适用于与 `Extensions/wit` 同级的扩展工程：

```rust
wit_bindgen::generate!({
    path: "../wit/world.wit",
    world: "aurona-extension",
});

use exports::aurona::extensions::render::{Guest, RenderInput, RenderOutput};

struct MyExtension;

impl Guest for MyExtension {
    fn render(_input: RenderInput) -> Result<RenderOutput, String> {
        Ok(RenderOutput {
            html: "<p>你好，Aurona Code。</p>".into(),
            diagnostics: Vec::new(),
        })
    }

    fn on_action(action_id: String, _payload: String) -> Result<RenderOutput, String> {
        Err(format!("不支持的动作：{action_id}"))
    }
}

export!(MyExtension);
```

导出类型、结果值和依赖版本请与当前 WIT 和 [Cargo 配置](../Extensions/aurona.vscode-compat/Cargo.toml)对齐。宿主会清洗视图内容；扩展自身也应在拼接不可信文本时进行适当转义。

## 构建与本地验证

本仓库的内置扩展可使用以下命令重建并验证：

```powershell
pnpm install --frozen-lockfile
rustup target add wasm32-wasip2
pnpm run prepare:extensions
pnpm run tauri:dev
```

开发独立扩展时，先为自己的 Cargo 工程构建 `wasm32-wasip2` 组件，再按上述结构打包。`prepare:extensions` 只处理仓库内置资源，不会自动发现并打包新扩展。

本地 `.aurx` 通过 Marketplace 的本地安装入口选择；VS Code Demo 可通过「设置 → 扩展」中的测试插件入口安装。签名策略与安装确认见[签名指南](Extension-Signing-Guide.md)。

## 视图与主题

宿主支持声明式组件与隔离 HTML/Webview 视图。声明式视图复用宿主控件；自定义视图负责布局和内容，同时遵守宿主 CSP、消息桥与资源限制。

- 使用清楚的标题、分组和 loading / empty / error 状态。
- 跟随当前主题提供可读的文字、图标与焦点状态。
- 优先复用共享材质与控件，减少大面积嵌套玻璃卡片。
- 检查窄窗口、键盘操作和降低动态效果设置。

完整要求见[设计规范](Design-Principles.md)。

## 生命周期与权限

扩展会话由宿主管理，停用、卸载或上下文变化时应释放命令、订阅和 watcher。对跨会话数据使用宿主存储，避免把实例内状态视为持久保证。

文件、编辑器、剪贴板和 Git 等能力依赖相应权限与当前上下文。签名认证、执行确认、能力权限和资源预算分别管理；关闭一项认证不代表获得其他能力。

## 提交前检查

1. 验证真实组件能够加载、渲染并响应动作。
2. 检查安装、激活、关闭、重开、停用与卸载后的资源释放。
3. 覆盖授权拒绝、工作区切换、保存失败与预算超限。
4. 检查深浅主题、中文路径和需要处理的 Unicode 内容。
5. 明确记录支持的 API、测试环境与仍待验证的场景。

市场目录与外部服务的实时可用性独立于本地扩展包，请分别记录客户端与服务端证据。
