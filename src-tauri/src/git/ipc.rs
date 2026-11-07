//! Tauri Git adapters over repository and recovery use cases.
use super::*;

#[tauri::command]
pub async fn git_push(app: tauri::AppHandle, path: String) -> Result<(), String> {
    run_scoped(app, path, true, move |path| {
        let output = git_output(&path, &["push"])?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn git_pull(app: tauri::AppHandle, path: String) -> Result<(), String> {
    run_scoped(app, path, true, move |path| {
        let output = git_output(&path, &["pull"])?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn git_fetch(app: tauri::AppHandle, path: String) -> Result<(), String> {
    run_scoped(app, path, true, move |path| {
        let output = git_output(&path, &["fetch", "--prune"])?;
        if output.status.success() {
            Ok(())
        } else {
            Err(command_error(&output))
        }
    })
    .await
}

#[tauri::command]
pub async fn git_check_is_repo(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    run_scoped(app, path, false, git_check_is_repo_internal).await
}

#[tauri::command]
pub async fn git_init(app: tauri::AppHandle, path: String) -> Result<(), String> {
    run_scoped_target(app, path, true, true, git_init_internal).await
}

#[tauri::command]
pub async fn git_status(app: tauri::AppHandle, path: String) -> Result<Vec<GitFile>, String> {
    run_scoped(app, path, false, git_status_internal).await
}

#[tauri::command]
pub async fn git_add(app: tauri::AppHandle, path: String, file: String) -> Result<(), String> {
    if file != "." {
        validate_file_argument(&file)?;
    }
    run_scoped(app, path, true, move |path| git_add_internal(path, file)).await
}

#[tauri::command]
pub async fn git_unstage(app: tauri::AppHandle, path: String, file: String) -> Result<(), String> {
    validate_file_argument(&file)?;
    run_scoped(app, path, true, move |path| {
        git_unstage_internal(path, file)
    })
    .await
}

#[tauri::command]
pub async fn git_commit(
    app: tauri::AppHandle,
    path: String,
    message: String,
) -> Result<(), String> {
    if message.len() > 64 * 1024 {
        return Err("[resource.limit] Commit message exceeds limit".into());
    }
    run_scoped(app, path, true, move |path| {
        git_commit_internal(path, message)
    })
    .await
}

#[tauri::command]
pub async fn git_current_branch(app: tauri::AppHandle, path: String) -> Result<String, String> {
    run_scoped(app, path, false, git_current_branch_internal).await
}

#[tauri::command]
pub async fn git_switch_branch(
    app: tauri::AppHandle,
    path: String,
    branch: String,
) -> Result<(), String> {
    run_scoped(app, path, true, move |path| {
        git_switch_branch_internal(path, branch)
    })
    .await
}

#[tauri::command]
pub async fn git_create_branch(
    app: tauri::AppHandle,
    path: String,
    branch: String,
) -> Result<(), String> {
    run_scoped(app, path, true, move |path| {
        git_create_branch_internal(path, branch)
    })
    .await
}

#[tauri::command]
pub async fn git_worktree_diff(
    app: tauri::AppHandle,
    path: String,
    file: String,
    staged: bool,
) -> Result<String, String> {
    validate_file_argument(&file)?;
    run_scoped(app, path, false, move |path| {
        git_worktree_diff_internal(path, file, staged)
    })
    .await
}

#[tauri::command]
pub async fn git_apply_hunk(
    app: tauri::AppHandle,
    path: String,
    file: String,
    staged: bool,
    hunk_index: usize,
    expected_diff: String,
) -> Result<(), String> {
    validate_file_argument(&file)?;
    if expected_diff.len() > 4 * 1024 * 1024 {
        return Err("[resource.limit] Patch exceeds limit".into());
    }
    run_scoped(app, path, true, move |path| {
        git_apply_hunk_internal(path, file, staged, hunk_index, expected_diff)
    })
    .await
}

#[tauri::command]
pub async fn git_discard_file(
    app: tauri::AppHandle,
    path: String,
    file: String,
) -> Result<(), String> {
    validate_file_argument(&file)?;
    run_scoped(app, path, true, move |path| {
        git_discard_file_internal(path, file)
    })
    .await
}

#[tauri::command]
pub async fn git_discard_all(
    app: tauri::AppHandle,
    path: String,
) -> Result<Option<GitRecovery>, String> {
    let generation = app.state::<WorkspaceState>().generation();
    let preview_app = app.clone();
    let preview = run_scoped(app.clone(), path.clone(), false, move |path| {
        discard_fingerprint(&preview_app.state::<WorkspaceState>(), &path)
    })
    .await?;
    if preview.1 == 0 {
        return Ok(None);
    }
    if crate::authorization_dialogs::security_preference(&app, "requireGitDiscardApproval", true) {
        use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let (title, body) = crate::authorization_dialogs::text(
            &app,
            "git",
            &[
                ("path", &path),
                ("entries", &preview.1.to_string()),
                ("fingerprint", &preview.0),
            ],
        );
        app.dialog()
            .message(body)
            .title(title)
            .buttons(MessageDialogButtons::YesNo)
            .show(move |approved| {
                let _ = sender.send(approved);
            });
        if !tokio::time::timeout(std::time::Duration::from_secs(60), receiver)
            .await
            .map_err(|_| "[confirmation.expired] Git confirmation expired")?
            .unwrap_or(false)
        {
            return Err("[operation.cancelled] Git discard cancelled".into());
        }
    }
    let recovery_app = app.clone();
    run_scoped(app, path, true, move |path| {
        let workspace = recovery_app.state::<WorkspaceState>();
        if generation != workspace.generation()
            || discard_fingerprint(&workspace, &path)? != preview
        {
            return Err("[confirmation.changed] Git state changed after preview".into());
        }
        let record = create_discard_recovery(&path, |file| read_recovery_file(&workspace, &path, file))?;
        if generation != workspace.generation() || discard_fingerprint(&workspace, &path)? != preview {
            return Err("[confirmation.changed] Git state changed while creating recovery; working tree preserved".into());
        }
        let untracked = git_status_internal(path.clone())?.into_iter().filter(|file| file.is_untracked).collect::<Vec<_>>();
        git_value(&path, &["-c", "core.autocrlf=false", "reset", "--hard", "HEAD"])?;
        for file in untracked {
            if run_cancelled() {
                return Err(format!("[git.cancelled] Discard interrupted; recovery {} is preserved", record.hash));
            }
            let (directory, name) = workspace.write_access(&Path::new(&path).join(&file.path).to_string_lossy())?;
            directory.remove_file(name).map_err(|e| format!("[git.recovery] Discard interrupted; recovery {} is preserved: {e}", record.hash))?;
        }
        Ok(Some(record))
    })
    .await
}

#[tauri::command]
pub async fn git_restore_discard(
    app: tauri::AppHandle,
    path: String,
    stash_hash: String,
) -> Result<(), String> {
    let restore_app = app.clone();
    run_scoped(app, path, true, move |path| {
        restore_discard_recovery(&restore_app.state::<WorkspaceState>(), &path, &stash_hash)
    })
    .await
}

#[tauri::command]
pub async fn git_list_discard_recoveries(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<GitRecovery>, String> {
    run_scoped(app, path, false, move |path| list_discard_recoveries(&path)).await
}

#[tauri::command]
pub async fn git_unstage_all(app: tauri::AppHandle, path: String) -> Result<(), String> {
    run_scoped(app, path, true, git_unstage_all_internal).await
}

#[tauri::command]
pub async fn git_get_remote(app: tauri::AppHandle, path: String) -> Result<String, String> {
    run_scoped(app, path, false, git_get_remote_internal)
        .await
        .map(|url| crate::redaction::redact(&url))
}

#[tauri::command]
pub async fn git_set_remote(
    app: tauri::AppHandle,
    path: String,
    url: String,
) -> Result<(), String> {
    if url.len() > 8192 || url.contains('\0') {
        return Err("[git.remote] Invalid remote URL".into());
    }
    run_scoped(app, path, true, move |path| {
        git_set_remote_internal(path, url)
    })
    .await
}

#[tauri::command]
pub async fn git_diff_commit(
    app: tauri::AppHandle,
    path: String,
    hash: String,
) -> Result<String, String> {
    run_scoped(app, path, false, move |path| {
        git_diff_commit_internal(path, hash)
    })
    .await
}

#[tauri::command]
pub async fn git_log(app: tauri::AppHandle, path: String) -> Result<Vec<GitCommit>, String> {
    run_scoped(app, path, false, git_log_internal).await
}

#[tauri::command]
pub async fn git_get_full_status(
    app: tauri::AppHandle,
    path: String,
) -> Result<GitFullStatus, String> {
    let generation = app.state::<WorkspaceState>().generation();
    let key = (path.clone(), generation);
    let state = app.state::<GitState>();
    let cell = {
        let mut statuses = state.statuses.lock().await;
        if statuses.len() >= 64 && !statuses.contains_key(&key) {
            return Err("[resource.limit] Too many Git status requests".into());
        }
        statuses.entry(key.clone()).or_default().clone()
    };
    let result = cell
        .get_or_init(|| collect_full_status(app.clone(), path))
        .await
        .clone();
    state.statuses.lock().await.remove(&key);
    if app.state::<WorkspaceState>().generation() != generation {
        return Err("[workspace.generation] Workspace changed after Git status".into());
    }
    result
}

#[tauri::command]
pub fn git_cancel(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let cwd = app.state::<WorkspaceState>().require_directory(&path)?;
    let state = app.state::<GitState>();
    let active = state
        .active
        .lock()
        .map_err(|_| "[git.lock] Cancellation registry unavailable")?;
    for flag in active
        .get(&cwd)
        .into_iter()
        .flatten()
        .filter_map(Weak::upgrade)
    {
        flag.store(true, std::sync::atomic::Ordering::Release);
    }
    Ok(())
}
