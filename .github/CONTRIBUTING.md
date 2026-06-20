# 贡献指南 (Contributing to Aurona Code)

首先，非常感谢您考虑为 Aurona Code 做出贡献！正是有了您的参与，Aurona Code 才能变得越来越好

## 如何参与贡献？

### 报告 Bug

在创建 Bug 报告之前，请先查看 [已有 Issue](https://github.com/AuronaLabs/AuronaCode-Early/issues)，确认该问题是否已被提出当您创建 Bug 报告时，请尽可能提供详细信息：

* **使用清晰、具描述性的标题**来标识问题
* **详细描述复现问题的具体步骤**
* **提供具体的例子或上下文来演示这些步骤**
* **描述您在执行上述步骤后观察到的异常行为**，并指出该行为的问题所在
* **解释您期望的行为是什么以及原因**

### 提交功能建议 (Enhancements)

新功能建议同样在 [GitHub Issues](https://github.com/AuronaLabs/AuronaCode-Early/issues) 中进行追踪提出新功能建议时，请包含以下内容：

* **一个清晰、具描述性的标题**
* **逐步描述您建议的新功能**
* **提供具体的使用场景或上下文示例**
* **解释为什么这个功能对大多数 Aurona Code 用户都有用**

### 提交 Pull Request (PR)

1. Fork 本仓库，并从 `main` 分支创建您的特性分支
2. 如果您添加了需要测试的代码，请尽可能完善测试
3. 如果您修改了 API 或核心逻辑，请同步更新相关文档
4. 确保代码通过基本的编译和检查逻辑
5. 请保持代码风格一致
6. 发起您的 Pull Request！

## 本地开发指南

Aurona Code 基于 Tauri、React 和 Tailwind CSS 构建如果您希望在本地运行该项目：

1. 请确保您的系统已安装 Node.js 和 Rust
2. 安装前端依赖：`npm install`
3. 以开发模式启动应用：`npm run tauri:dev` 或者是使用我们推荐的管理脚本 `python manager.py dev`

请确保您的代码遵循项目现有的编码规范，并尽量保持您的提交记录干净、具有逻辑性且描述清晰

## 行为准则

本项目及其所有参与者均受 [Aurona Code 社区行为准则 (Code of Conduct)](CODE_OF_CONDUCT.md) 的约束参与本项目即表示您同意遵守该准则
