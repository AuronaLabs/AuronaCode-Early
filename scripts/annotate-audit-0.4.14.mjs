import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const file = path.join(root, "scripts/data/audit-0.4.14.json");
const audit = JSON.parse(fs.readFileSync(file, "utf8"));
const rust = (file, name) => `src-tauri/src/${file}.rs#${name}`;
const front = (file) => `Src/${file}.test.ts`;
const fsTest = (name) => rust("commands/fs", name);
const launch = rust("launch_registry", "file_change_revokes_fingerprint_even_when_length_is_unchanged");
const url = rust("network_policy", "endpoint_rejects_credentials_private_and_metadata");
const signature = rust("artifact_signature", "binds_identity_source_revision_validity_and_actual_bytes");
const grant = rust("ai_profiles", "session_grants_revoke_on_generation_configuration_and_session_changes");
const descriptions = {
  "P0-01": "删除、重命名及移动使用后端根保护；子目录删除经原生确认并保留恢复数据，根目录及其别名拒绝变更。",
  "P0-02": "AI 按配置 ID 在 Rust 解析端点与凭据；首次请求确认目标，配置或工作区变化撤销授权，拒绝危险地址与凭据重定向。",
  "P0-03": "候选元数据绑定版本、渠道及安装包 SHA-256，Stable/Pioneer 分别核验；正式密钥来源与生产签名产物仍待验收。",
  "P0-04": "扩展及市场图标统一清洗 SVG，并通过受控图片资源渲染，过滤脚本、事件、外链与 foreignObject。",
  "P1-01": "复制和移动分别检查源、目标及工作区 generation；前端传入路径不能替代后端授权。",
  "P1-02": "文本访问和保存以目录句柄约束并禁止跟随链接，暂存写入采用随机文件与冲突检查；并发替换仍需扩大平台验收。",
  "P1-03": "普通文本限制 32 MiB，大文本通过 256 KiB 分块上传，读取时累计真实字节数并拒绝超限。",
  "P1-04": "文件监听共享全局、工作区和扩展额度；合并去重队列最多 4096 路径，溢出通知使缓存失效。",
  "P1-05": "Git 校验实际仓库根和 Git 目录，并绑定工作区 generation；父级仓库、外部目录与 submodule 需要明确授权。",
  "P1-06": "丢弃全部修改先预览并确认状态指纹，再创建恢复引用；独立保存工作树原字节、删除记录和 index，恢复过滤器与换行转换前的内容。",
  "P1-07": "工具链、扩展、debugpy 和更新使用各自的 HTTPS 来源清单，每跳重定向和解析地址重新校验。",
  "P1-08": "下载限制实际字节、并发与取消，随机临时文件避免同名覆盖；artifact 句柄一次性使用并绑定用途、工作区和期限。",
  "P1-09": "解压累计 entry、单文件、总量和压缩比，检查剩余磁盘并拒绝链接、特殊文件和路径逃逸。",
  "P1-10": "语言服务以注册 launchId 启动；本地 executable、参数和环境经确认并绑定文件指纹，变化后重新授权。",
  "P1-11": "LSP 文档 URI、返回路径和 WorkspaceEdit 经过工作区 scope 校验，拒绝未授权的跨目录读写。",
  "P1-12": "调试适配器使用启动注册表，绑定 executable、cwd、参数、环境及工作区授权，替换配置不能沿用旧许可。",
  "P1-13": "debugpy 安装使用已授权解释器，固定 1.8.17 的 wheel 与 hash，安装前确认目标环境和下载来源。",
  "P1-14": "扩展桥接响应同时匹配扩展、kind、generation 和一次性请求句柄，限制 pending 并在超时、失败及卸载时清理。",
  "P1-15": "扩展事件由 runtime 校验当前所有者和声明种类，限制单 payload 与队列，拒绝伪造 ID、过期事件和超限数据。",
  "P1-16": "AURX 校验严格类型、SemVer、publisher/ID、字段长度和 URL，保留合法连字符 ID 的兼容性。",
  "P1-17": "包内 HTML/SVG 在安装及最终动态渲染时均清洗，解析 HTML/CSS 并移除脚本、表单、导航与外部资源。",
  "P1-18": "市场 API、下载、头像和图标由 Rust 按同一来源策略获取；开发服务器需要单独确认，危险协议和地址失败关闭。",
  "P1-19": "客户端用固定可信公钥验证 Ed25519 描述，再核对 publisher、ID、版本、平台、大小及实际包 hash；正式市场签名数据仍阻塞。",
  "P1-20": "AI 请求、工具、SSE 事件、累计输出和活动请求分别限额；聊天及连接测试共享取消注册表，提前取消也阻止后续注册。",
  "P1-21": "保存的 AI 配置仅含 credentialId 和密钥状态；旧明文先写入系统 keyring 并验证，成功后原子清理，失败可重试。",
  "P1-22": "Agent 仅调用显式允许的命令，按实际 effects 和 checkpoint 元数据判断；未声明命令默认拒绝。",
  "P1-23": "Agent 授权按工具、路径、命令、会话和有效期判断，授权前后检查取消与工作区；旧 full 迁为工作区编辑策略。",
  "P1-24": "开发与生产 CSP 分离，存储、更新和重启使用窄化后端命令，收紧发行版 capabilities 与网络权限。",
  "P2-01": "目录按 256 项迭代分页并返回单次 cursor 与 generation，Explorer 使用虚拟列表；取消与目录变化会使旧分页失效。",
  "P2-02": "Git URL、remote、stderr 和代理认证错误统一脱敏，保留错误码，过滤 URL 密码、查询 token 与 Bearer 凭据。",
  "P2-03": "Git 读写按真实仓库协调并可取消进程树，status 请求去重，变更后失效缓存并隔离旧工作区结果。",
  "P2-04": "工具链安装消费后端 artifact 文件句柄，移除整包 base64/JSON IPC；安装索引保存元数据和大小以减少重复扫描。",
  "P2-05": "同一工具安装、卸载和启动互相协调，staging 校验后切换，日志恢复未完成事务；使用中的工具阻止直接卸载。",
  "P2-06": "LSP 方法对应已协商能力和显式清单，参数、协议帧与 pending 分别限额，超量请求返回可诊断错误。",
  "P2-07": "LSP 文档维护单调 revision，限制全文和增量大小；旧版本拒绝并触发重新同步，超大变更不截断为错误文档。",
  "P2-08": "LSP 启动锁与 server/workspace generation 隔离旧实例事件，restart 等待退出后再启动。",
  "P2-09": "DAP 限制会话、pending、协议帧和输出窗口，程序输出确认后继续发送，退出或崩溃统一回收请求和进程。",
  "P2-10": "终端初始 cwd 使用工作区或原生批准目录，显示归属与信任状态；普通 shell 内部 cd 的能力边界有明确说明。",
  "P2-11": "PTY 限制 8 个会话和 64 KiB 输入，输出合并并等待确认形成背压，关闭会话唤醒 reader 并回收进程树。",
  "P2-12": "短进程 stdout/stderr 并行读取，各保留 4 MiB 后继续排空并标记截断，避免大输出堵塞管道。",
  "P2-13": "扩展 watcher 绑定 runtime generation，卸载、禁用、更新、失败与工作区切换清理监听、事件和桥接资源。",
  "P2-14": "WASM 编译结果按包 hash 有界缓存，每次 Store/实例隔离；普通扩展 64 MiB，内置兼容层使用受控 256 MiB 档。",
  "P2-15": "市场缓存保存可核验的签名包络、来源、revision 与有效期，过期仅用于标记后的浏览；生产签名缓存验收仍待外部数据。",
  "P2-16": "市场响应严格解析 schema、字节和条数，搜索有界并使用分页与虚拟列表，畸形数据不再强制转换成字符串。",
  "P2-17": "扩展操作按 ID 保存独立任务和进度，不同 ID 有限并发、同 ID 串行，完成后合并刷新，取消和失败互不覆盖。",
  "P3-01": "普通热视图缓存设为 12 个，文档 buffer 与轻量滚动、筛选和草稿状态分开保存，未完成事务保持挂载，非活动视图暂停部分订阅及 Canvas 渲染。",
  "P3-02": "保存时流式计算输出指纹，减少读回；外部冲突结合句柄身份与内容 hash，识别同大小、同 mtime 的改写。",
  "P3-03": "独立只读工具最多 4 路并行，写入和冲突操作顺序执行；上下文按 token 预算裁剪并保留工具调用与结果配对。",
  "P3-04": "Agent 历史及 checkpoint 使用加密后端存储、字节额度和恢复日志，分别保存 before 内容与 after 指纹以检测回滚冲突。",
  "P3-05": "宿主在 iframe 首部注入严格 CSP 并保留 sandbox，默认禁用远程图片、字体、CSS、表单和导航，扩展 CSP 不能放宽策略。",
};
// Source references and runnable coverage are distinct from acceptance results.
const rows = [
  ["P0-01", "commands/fs", [fsTest("mutation_access_rejects_root_aliases_recovery_data_and_stale_authorization")], "Native delete/cancel/restore and crash recovery remain."],
  ["P0-02", "ai_profiles", [url, grant], "Credential-bearing provider/loopback, redirects and DNS integration remain."],
  ["P0-03", "release_verification", [rust("release_verification", "signed_fixture_binds_runtime_channel_artifact_and_metadata")], "Production updater key provenance and signed Stable/Pioneer artifacts are external prerequisites."],
  ["P0-04", "extensions/content", [rust("extensions/content", "svg_rejects_script_entities_and_external_resources"), front("Foundation/Security/ExtensionContent")], "WebView2 execution and external-request isolation remain."],
  ["P1-01", "commands/fs", [fsTest("production_scope_rejects_forged_roots_and_traversal")], "Direct IPC copy/move and native drag/drop remain."],
  ["P1-02", "scoped_file", [fsTest("parent_link_replacement_cannot_escape_during_reads_and_staged_writes")], "Broaden concurrent replacement to delete/rename/upload and run all three platforms."],
  ["P1-03", "file_uploads", [rust("editor", "oversized_file_is_rejected_before_a_session_is_created")], "Growing-file, upload-handle abuse and 32 MiB save acceptance remain."],
  ["P1-04", "resource_limits", [rust("resource_limits", "one_hundred_thousand_watch_events_are_bounded_deduplicated_and_mark_overflow"), rust("resource_limits", "shared_watcher_budget_is_released_across_one_hundred_cycles")], "Buffer/lease tests do not replace actual OS watcher event/thread/final-state measurements."],
  ["P1-05", "commands/git", [rust("commands/git", "initialization_uses_selected_directory_without_authorizing_its_parent_repository")], "Scoped init/status/stage and external-repository rejection have local desktop evidence; explicit external/submodule authorization remains."],
  ["P1-06", "commands/git", [rust("commands/git", "discard_backup_is_nondestructive_and_restores_index_worktree_and_untracked"), rust("commands/git", "incomplete_discard_backup_never_changes_the_worktree"), rust("commands/git", "recovery_reads_use_the_scoped_snapshot_format_and_reject_unselected_files"), rust("commands/git", "filtered_and_normalized_tracked_files_restore_exact_raw_bytes"), rust("commands/git", "raw_recovery_restores_staged_renames_worktree_deletions_and_new_directories"), rust("commands/git", "recovery_rejects_protected_paths_before_restoring_the_index")], "Native approval/cancel, state changes, and interrupted recovery remain acceptance work."],
  ["P1-07", "network_policy", [url, rust("network_policy", "download_sources_are_bound_to_purpose_across_redirects")], "Connection/DNS rebinding and per-hop source integration tests remain."],
  ["P1-08", "artifacts", [rust("tasks", "cancellation_is_sticky_and_all_terminal_paths_release_the_id"), rust("artifacts", "handles_are_single_use_and_reject_wrong_kind_generation_and_expiry"), rust("artifacts", "changed_artifacts_fail_before_install_and_consumed_temp_files_are_removed")], "Streaming Content-Length, concurrent acquisition and actual cancel cleanup tests remain."],
  ["P1-09", "toolchains", [rust("toolchains", "archive_preflight_rejects_bombs_paths_duplicates_links_and_cancellation"), rust("toolchains", "archive_space_budget_preserves_the_required_margin_and_handles_overflow")], "Actual disk-full/extraction interruption and preservation of an installed toolchain remain; ZIP preflight and disk-margin tests are distinct."],
  ["P1-10", "launch_registry", [launch], "Approved local and signed installed language server workflows remain."],
  ["P1-11", "commands/lsp_cmds", [rust("commands/lsp_cmds", "protocol_paths_check_nested_workspace_edits_and_explicit_external_files")], "Nested URI/WorkspaceEdit scope tests exist; actual definition/restructure and junction-document workflows remain."],
  ["P1-12", "commands/dap_cmds", [rust("launch_registry", "launch_environment_and_size_are_checked")], "Adapter/cwd direct IPC rejection and approved local debugging remain."],
  ["P1-13", "python_tools", [rust("python_tools", "wheel_tags_are_pinned_and_unsupported_interpreters_rejected")], "Actual install/hash/interpreter mutation evidence remains per platform."],
  ["P1-14", "extensions/runtime", [rust("extensions/runtime", "response_cannot_consume_another_owner_kind_or_generation"), rust("extensions/runtime", "expired_and_oversized_responses_fail")], "100 actual runtime timeout/unload cycles remain."],
  ["P1-15", "extensions/runtime", [rust("extensions/runtime", "events_require_current_owner_declared_kind_bounded_payload_and_preserve_order")], "Actual runtime IPC/event delivery and workspace-transition acceptance remain."],
  ["P1-16", "extensions/aurx", [rust("extensions/aurx", "manifest_id_allows_hyphen_segments"), rust("extensions/aurx", "opens_valid_package")], "Strict manifest type/SemVer/URL corpus and official-package matrix remain."],
  ["P1-17", "extensions/content", [rust("extensions/content", "html_removes_navigation_forms_scripts_and_escaped_css_urls"), front("Foundation/Security/ExtensionContent")], "Dynamic-render WebView isolation and theme regressions remain."],
  ["P1-18", "marketplace", [rust("marketplace", "sources_and_response_complexity_fail_closed")], "Official/development source and image redirect workflows remain."],
  ["P1-19", "artifact_signature", [signature, rust("toolchains", "signed_toolchains_bind_manifest_identity_and_portable_platform"), front("Features/Extensions/Marketplace/MarketplaceService")], "Production Marketplace key and signed packages are external prerequisites; fixtures only validate the client."],
  ["P1-20", "ai_chat", [rust("ai_chat", "rejects_a_large_sse_record_but_accepts_many_small_coalesced_records"), rust("ai_chat", "duplicate_request_and_completed_abort_do_not_leak_registry_entries"), rust("ai_chat", "chat_and_connection_tests_share_the_request_quota_and_validate_ids"), rust("ai_chat", "early_cancellation_is_atomic_bounded_and_expires")], "Request/tool/output-limit and disconnect/EOF/timeout workflows remain."],
  ["P1-21", "ai_profiles", [rust("app_storage", "plaintext_credentials_are_rejected_at_backend_boundary"), rust("ai_profiles", "interrupted_migration_reuses_committed_credentials_and_preserves_conflicting_profiles"), rust("ai_profiles", "duplicate_migration_ids_fail_before_any_credential_is_written"), rust("ai_profiles", "keyring_write_failure_and_uncommitted_credentials_are_retryable"), front("Core/AiProfiles"), front("Foundation/Storage/UserConfigStore")], "Mock failure/retry coverage does not replace OS keyring interruption, retirement journal and restart acceptance."],
  ["P1-22", "Src/Core/Commands.ts", [front("Features/AiAssistant/AgentToolMetadata")], "All command-registry entries, effects and independent run/debug authorization remain."],
  ["P1-23", "Src/Core/Agent/AgentService.ts", [front("Core/Agent/AgentService")], "Expired approval and workspace-change-during-approval remain."],
  ["P1-24", "src-tauri/tauri.conf.json", ["scripts/smoke.mjs", "scripts/check-desktop-boundaries.mjs"], "Packaged permissions and Account/editor/Markdown/update under production CSP remain."],
  ["P2-01", "commands/fs", [fsTest("directory_pages_are_bounded_single_use_cancellable_and_invalidated_by_changes")], "Million-entry first-page/cancel/RSS measurements remain."],
  ["P2-02", "redaction", [rust("redaction", "git_credentials_and_proxy_errors_are_redacted")], "Provider-specific credential corpus and UI/log paths remain."],
  ["P2-03", "commands/git", [rust("process_service", "cancellation_reclaims_a_running_process_tree_within_two_seconds"), front("Core/GitService")], "Concurrent checkout/pull/status and Source Control cancellation UI remain."],
  ["P2-04", "toolchains", [], "No-inline-package IPC assertion and indexed refresh benchmark remain."],
  ["P2-05", "toolchains", [rust("toolchains", "install_journal_recovers_before_and_after_directory_switch"), rust("toolchains", "one_hundred_install_switches_leave_only_the_committed_version"), rust("toolchains", "running_tool_leases_block_mutation_and_release_across_one_hundred_cycles"), rust("toolchains", "uncommitted_versions_never_become_launch_candidates"), rust("toolchains", "uninstall_recovers_precommit_and_finishes_committed_cleanup")], "Actual concurrent install/uninstall, cancellation and process-use acceptance remain."],
  ["P2-06", "commands/lsp_cmds", [rust("commands/lsp_cmds", "generic_lsp_methods_require_an_explicit_negotiated_capability"), rust("lsp", "stderr_drains_oversized_lines_and_preserves_following_records"), rust("lsp", "stderr_preserves_unicode_across_chunks_and_truncated_prefixes"), rust("lsp", "protocol_logs_are_bounded_redacted_and_rate_limited")], "Noisy-server pending/backpressure and negotiated compatibility remain; stderr and protocol log budgets have isolated tests."],
  ["P2-07", "commands/lsp_cmds", [rust("commands/lsp_cmds", "document_limits_reject_oversize_and_negative_revisions"), front("Core/DocumentService")], "Out-of-order actual server sync and large-change resync remain."],
  ["P2-08", "lsp", [], "100 rapid restart cycles and old diagnostic/process isolation remain."],
  ["P2-09", "dap", [rust("dap", "output_window_ignores_forged_duplicate_acknowledgements"), rust("dap", "non_output_events_have_a_separate_bounded_budget")], "High-output adapter and 100 crash/cancel cycles remain."],
  ["P2-10", "pty", [], "Authorized/unauthorized cwd and UI trust display remain."],
  ["P2-11", "pty", [rust("pty", "output_window_blocks_at_four_and_close_releases_waiters")], "High-throughput PTY, process-tree cleanup and idle-session measurements remain."],
  ["P2-12", "process_service", [rust("process_service", "stdout_and_stderr_are_drained_concurrently_after_the_retention_limit")], "Cross-platform descendant cleanup and RSS measurements remain."],
  ["P2-13", "extensions/runtime", [rust("resource_limits", "shared_watcher_budget_is_released_across_one_hundred_cycles")], "Lease tests do not replace 100 actual load/unload resource measurements."],
  ["P2-14", "extensions/runtime", [rust("extensions/runtime", "invalid_component_is_rejected")], "Hash compilation cache benchmark, Store isolation and compatibility regressions remain."],
  ["P2-15", "marketplace_catalog", [rust("marketplace_catalog", "cache_rejects_tampering_cross_origin_and_rollback_and_marks_expiry")], "Production signed catalog/cache provenance requires external Marketplace data."],
  ["P2-16", "Src/Features/Extensions/Marketplace/MarketplaceSchema.ts", [front("Features/Extensions/Marketplace/MarketplaceSchema"), front("Features/Extensions/Marketplace/MarketplaceVirtualList")], "Large-catalog actual DOM/memory measurements remain."],
  ["P2-17", "Src/Features/Extensions/Marketplace/MarketplaceTasks.ts", [front("Features/Extensions/Marketplace/MarketplaceTasks")], "Two real independent installs and cancel/progress/refresh isolation remain."],
  ["P3-01", "Src/Layout/HotViewCache.ts", [front("Layout/HotViewCache"), "Src/UI/Core/ViewState.test.tsx", "Src/Features/Editor/EditorTab.test.tsx"], "Retained state eviction tests exist; settings subpanel drafts, benchmarks, actual 100 tabs and inactive Canvas/subscriptions remain."],
  ["P3-02", "scoped_file", [rust("scoped_file", "snapshot_detects_same_content_replacement_and_same_size_rewrite")], "Save I/O measurement and final conflict-check-to-rename interval review remain."],
  ["P3-03", "Src/Core/Agent/AgentToolScheduler.ts", [front("Core/Agent/AgentToolScheduler"), front("Core/Agent/AgentContextBudget")], "Long-session constraints, stable results and call/result pairing acceptance remain."],
  ["P3-04", "agent_storage", [rust("agent_storage", "ciphertext_authenticates_content_key_and_slot"), rust("agent_storage", "backend_rejects_malformed_recovery_and_future_task_schemas"), front("Core/Agent/LegacyChatArchive"), front("Core/Agent/AgentCheckpointStore")], "Quota/keyring/disk-full/Nth restore failure and crash/restart during rollback remain."],
  ["P3-05", "Src/Foundation/Security/ExtensionContent.ts", [front("Foundation/Security/ExtensionContent")], "Actual iframe image/font/CSS/form/navigation requests in WebView2 remain."],
];
const mappings = new Map(rows.map(([id, source, coverage, remaining]) => [id, { source, coverage, remaining }]));
for (const item of audit.items) {
  const mapping = mappings.get(item.id);
  if (!mapping) throw new Error(`Missing ${item.id}`);
  const source = mapping.source.includes(".") ? mapping.source : `src-tauri/src/${mapping.source}.rs`;
  for (const ref of [source, ...mapping.coverage]) {
    const [filename, name] = ref.split("#");
    const text = fs.readFileSync(path.join(root, filename), "utf8");
    if (name && !text.includes(`fn ${name}(`)) throw new Error(`Missing test ${ref}`);
  }
  item.implementation = [source];
  item.userVisible = descriptions[item.id];
  if (!item.userVisible) throw new Error(`Missing user-visible description ${item.id}`);
  item.coverage = mapping.coverage;
  if (item.id === "P1-06") {
    item.coverage.push(rust("commands/git", "interrupted_restore_resumes_after_reopening_workspace_at_every_operation"),
      rust("commands/git", "interrupted_restore_preserves_later_user_edits_and_corrupt_journals"));
    item.userVisible += "中断恢复使用持久日志核对原始或已恢复状态，遇到新的用户修改停止重试。";
    mapping.remaining = "Native approval/cancel, external concurrent writes and actual process crash/restart remain; operation-level interruption and journal-conflict tests exist.";
  }
  item.validation = [...mapping.coverage.map((ref) => `Coverage target: ${ref} (not final acceptance)`),
    ...(item.validation ?? []).filter((evidence) => !evidence.startsWith("Coverage target:"))];
  item.notes = [mapping.remaining];
  if (item.status !== "verified") {
    item.status = ["P0-03", "P1-19", "P2-15"].includes(item.id) ? "external-blocked" : "in-progress";
    item.desktopEvidence ??= false;
    item.negativeEvidence ??= false;
  }
}
fs.writeFileSync(file, `${JSON.stringify(audit, null, 2)}\n`);
console.log("Updated 50 real source/coverage references; acceptance requires separately recorded evidence.");
