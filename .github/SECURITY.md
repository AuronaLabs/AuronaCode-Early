# 安全策略

## 受支持版本

Aurona Code 仍处于早期快速开发阶段，目前只为最新预览版本提供安全修复。

| 版本 | 支持状态 |
| --- | --- |
| 0.3.1 | :white_check_mark: |
| < 0.3.1 | :x: |

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
- 插件运行时、插件沙箱、AI Command Center 和云端遥测当前尚未实现。
- 更新器安全依赖 Release 签名、`latest.json` 和真实旧版本到新版本的链路验证。
