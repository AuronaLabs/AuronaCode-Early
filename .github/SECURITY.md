# 安全策略

## 受支持版本

Aurona Code 仍处于早期快速开发阶段，目前只为最新预览版本提供安全修复。

| 版本 | 支持状态 |
| --- | --- |
| 0.4.14 | :white_check_mark: 接收报告；仅开发候选，尚未发布，完整验收未完成 |
| 最新已发布预览版本 | 接收报告；修复通过后续版本交付 |
| 更早版本 | 不单独维护；与当前版本共有的问题仍可报告 |

## 私密报告漏洞

请勿在公开 Issue、Discussion、Pull Request、截图或日志中披露尚未修复的漏洞。

首选方式是使用 [GitHub Private Vulnerability Reporting](https://github.com/AuronaLabs/AuronaCode-Early/security/advisories/new)。如果该入口不可用，可发送邮件至 `ecospace@qq.com`，主题注明“[Aurona Code Security]”。

报告尽量包含：

- 受影响版本、操作系统、架构和构建类型。
- 漏洞描述、潜在影响和攻击前提。
- 最小复现步骤或安全的概念验证。
- 相关日志、调用路径或截图，且已移除凭据与个人信息。
- 已知缓解方式以及是否已经公开披露。

## 处理流程

维护者会确认收到报告、评估严重程度和影响范围，并在修复可用前尽量保持沟通。修复可能通过新预览版本发布；旧版本不会单独长期维护。

请给维护者合理的调查和修复时间。在修复发布并完成协调披露前，不要公开技术细节。

## 安全边界说明

- Tauri capability 最小化不等于工作区文件系统沙箱。
- 扩展以 WASM Component 运行，并使用 Wasmtime 限额、权限和 sandbox iframe。第三方本地包需要用户批准；远程安装要求可信签名。VS Code API 兼容能力有范围限制。
- AI Assistant 向用户批准的模型服务发送请求中的代码和上下文。用户批准的本地工具和交互式 shell 按操作系统权限运行，不能视为文件系统沙箱。
- 更新器安全依赖 Release 签名、`latest.json` 和真实旧版本到新版本的链路验证。
- 0.4.14 的正式签名来源和完整验收仍未闭环，详见 [状态矩阵](../Docs/0.4.14-Implementation-Status.md)和[安全与迁移](../Docs/0.4.14-Security-and-Migration.md)。
