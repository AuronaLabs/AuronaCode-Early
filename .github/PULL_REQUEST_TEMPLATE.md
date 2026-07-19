## 变更摘要

<!-- 说明用户问题、根因和本 PR 的解决方式。关联 Issue 时使用 Closes #123。 -->

Closes #

## 修改范围

- 涉及模块：
- 明确未修改：
- 是否包含用户可见 UI 变化：是 / 否
- 是否涉及编辑保存、权限、IPC、更新器或进程生命周期：是 / 否

## 风险与兼容性

<!-- 说明数据安全、性能、跨平台、迁移或回滚风险。没有也请写“无已知风险”。 -->

## 验证

<!-- 只勾选实际运行并通过的项目；未运行或环境阻塞请在下方说明。 -->

- [ ] `pnpm run typecheck`
- [ ] `pnpm run check`
- [ ] `pnpm run check:boundaries`
- [ ] `pnpm run check:materials`
- [ ] `pnpm run smoke`
- [ ] `pnpm run test:frontend`
- [ ] `pnpm run build`
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings`
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml --locked`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml --locked`
- [ ] `git diff --check`

### 手工验证平台

- [ ] Windows
- [ ] macOS
- [ ] Linux
- [ ] 不适用，仅文档/测试/工作流变更

手工步骤与结果：

<!-- 编辑器改动应覆盖 IME、保存、撤销/重做、快速切换或外部变化中相关的场景。 -->

未运行或环境阻塞：

## UI 证据

<!-- 有视觉变化时提供深浅主题截图，并说明拟物强度和 DPI。无视觉变化可删除本节。 -->

## 提交清单

- [ ] 变更范围单一，没有夹带无关重构或生成文件
- [ ] 没有绕过 `Foundation/Desktop` 直接调用 Tauri
- [ ] 新增或修改的长期状态只有一个可写来源
- [ ] 已更新与实现变化相关的 README、Docs 或版本说明
- [ ] 没有把未实现能力描述为已完成
- [ ] 没有提交密钥、签名材料、本机性能原始数据或构建产物
