# 仓库协作与自动化

本目录存放 GitHub 可识别的协作文件、问题模板和工作流。文件保留在 GitHub 约定的位置，避免移动后失去自动展示或执行能力。

## 协作文件

| 文件或目录 | 职责 |
| --- | --- |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 工具链、开发流程、架构约定与验证命令 |
| [SUPPORT.md](SUPPORT.md) | 使用问题、缺陷反馈和帮助入口 |
| [SECURITY.md](SECURITY.md) | 安全报告渠道与支持范围 |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | 社区交流与行为规范 |
| [PULL_REQUEST_TEMPLATE.md](PULL_REQUEST_TEMPLATE.md) | 修改范围、验证证据与兼容性说明 |
| [ISSUE_TEMPLATE/](ISSUE_TEMPLATE/) | 缺陷与功能建议表单、安全报告入口 |

## 工作流

| 工作流 | 触发方式 | 主要职责 |
| --- | --- | --- |
| [quality.yml](workflows/quality.yml) | PR、`main` 推送、手动执行 | 文档、前端与领域边界检查，扩展和 Rust 三平台验证 |
| [release.yml](workflows/release.yml) | `v*` 标签、手动执行 | 发布预检、候选产物构建、验证与分发 |

工作流内的版本、工具链与命令应与项目元数据和[贡献指南](CONTRIBUTING.md)同步。修改发布流程时保留既有签名、来源与 Quality 检查，不以本地编译结果替代发布验证。

## 文档归属

产品与开发文档集中在 [Docs](../Docs/README.md)。根 README 默认英文，其他五种语言放在 `Docs/Readme/`；当前实现与验证归入 `Docs/Development/<version>/`，旧版本记录通过 Git 历史和系列分支查阅。
