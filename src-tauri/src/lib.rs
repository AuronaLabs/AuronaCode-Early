mod account_auth;
mod commands;
mod content_length;
mod dap;
mod editor;
mod lsp;
mod performance;
mod platform;
mod process_service;
mod pty;
mod search;

use commands::dap_cmds::DapState;
pub use commands::lsp_cmds::LspState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    platform::initialize_environment();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(pty::PtyState::new())
        .manage(editor::EditorState::new())
        .manage(performance::PerformanceState::new())
        .manage(search::SearchState::new())
        .manage(LspState::new())
        .manage(DapState::new())
        .manage(account_auth::AccountAuthState::default())
        .manage(commands::fs::WorkspaceState::new())
        .invoke_handler(tauri::generate_handler![
            account_auth::account_auth_status,
            account_auth::account_auth_start,
            account_auth::account_auth_cancel,
            account_auth::account_auth_refresh,
            account_auth::account_auth_restore,
            account_auth::account_auth_logout,
            account_auth::account_auth_shutdown,
            commands::git::git_check_is_repo,
            commands::git::git_init,
            commands::git::git_status,
            commands::git::git_add,
            commands::git::git_unstage,
            commands::git::git_commit,
            commands::git::git_current_branch,
            commands::git::git_push,
            commands::git::git_pull,
            commands::git::git_fetch,
            commands::git::git_switch_branch,
            commands::git::git_create_branch,
            commands::git::git_worktree_diff,
            commands::git::git_discard_file,
            commands::git::git_discard_all,
            commands::git::git_unstage_all,
            commands::git::git_get_remote,
            commands::git::git_set_remote,
            commands::git::git_diff_commit,
            commands::git::git_log,
            commands::git::git_get_full_status,
            pty::spawn_pty,
            pty::close_pty,
            pty::write_pty,
            pty::resize_pty,
            pty::get_available_shells,
            search::search_workspace,
            search::list_workspace_files,
            search::cancel_search,
            performance::get_performance_environment,
            performance::performance_ping,
            performance::run_performance_benchmark,
            performance::cancel_performance_benchmark,
            performance::record_startup_metrics,
            performance::get_startup_metrics,
            platform::platform_info,
            performance::load_performance_baseline,
            performance::save_performance_baseline,
            commands::lsp_cmds::lsp_start,
            commands::lsp_cmds::lsp_file_uri,
            commands::lsp_cmds::lsp_status,
            commands::lsp_cmds::lsp_stop,
            commands::lsp_cmds::lsp_restart,
            commands::lsp_cmds::lsp_stop_all,
            commands::lsp_cmds::lsp_did_open,
            commands::lsp_cmds::lsp_did_change,
            commands::lsp_cmds::lsp_did_save,
            commands::lsp_cmds::lsp_did_close,
            commands::lsp_cmds::lsp_call,
            commands::lsp_cmds::lsp_call_with_id,
            commands::lsp_cmds::lsp_cancel,
            commands::dap_cmds::dap_start,
            commands::dap_cmds::dap_request,
            commands::dap_cmds::dap_status,
            commands::dap_cmds::dap_stop,
            commands::dap_cmds::dap_stop_all,
            commands::dap_cmds::dap_python_debugpy_status,
            commands::dap_cmds::dap_install_python_debugpy,
            commands::fs::reveal_in_os,
            commands::fs::fs_copy_or_move,
            commands::fs::workspace_set_root,
            commands::fs::fs_read_dir,
            commands::fs::fs_exists,
            commands::fs::fs_read_text_file,
            commands::fs::fs_write_text_file,
            commands::fs::fs_mkdir,
            commands::fs::fs_remove,
            commands::fs::fs_rename,
            commands::fs::fs_export_dialog_file,
            commands::fs::fs_watch_start,
            commands::fs::fs_watch_stop,
            commands::ipc::open_devtools,
            commands::ipc::get_app_data_size,
            commands::ipc::get_app_log_size,
            commands::ipc::get_storage_breakdown,
            commands::ipc::clear_app_logs,
            commands::ipc::clear_err_logs,
            commands::ipc::clear_webview_cache,
            commands::ipc::clear_performance_baseline,
            commands::ipc::clear_other_app_data,
            commands::ipc::clear_editor_recovery,
            commands::ipc::mark_splashscreen_shown,
            commands::ipc::close_splashscreen,
            editor::open_editor_file,
            editor::editor_open_dialog,
            editor::apply_editor_edits,
            editor::get_editor_lines,
            editor::save_editor_file,
            editor::close_editor_file,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Aurona Code");
}
