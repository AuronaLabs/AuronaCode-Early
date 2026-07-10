mod pty;
mod search;
mod lsp;
mod commands;

pub use commands::lsp_cmds::LspState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .manage(pty::PtyState::new())
        .manage(LspState {
            clients: tokio::sync::Mutex::new(std::collections::HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::git::git_check_is_repo,
            commands::git::git_init,
            commands::git::git_status,
            commands::git::git_add,
            commands::git::git_unstage,
            commands::git::git_commit,
            commands::git::git_current_branch,
            commands::git::git_push,
            commands::git::git_pull,
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
            commands::lsp_cmds::lsp_start,
            commands::lsp_cmds::lsp_did_open,
            commands::lsp_cmds::lsp_did_change,
            commands::lsp_cmds::lsp_did_close,
            commands::lsp_cmds::lsp_call,
            commands::lsp_cmds::lsp_call_with_id,
            commands::lsp_cmds::lsp_cancel,
            commands::fs::reveal_in_os,
            commands::fs::fs_copy_or_move,
            commands::ipc::aurona_bridge,
            commands::ipc::open_devtools,
            commands::ipc::get_app_data_size,
            commands::ipc::get_app_log_size,
            commands::ipc::clear_other_app_data,
            commands::ipc::close_splashscreen,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Aurona Code");
}

