//! WIT host capability implementations.
use super::*;

impl aurona::extensions::context::Host for ExtensionContext {
    fn runtime_metadata(&mut self) -> String {
        use sha2::{Digest, Sha256};
        let root = self
            .workspace_root
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned());
        let identity = crate::extensions::state::workspace_identity(self.workspace_root.as_deref());
        let workspace_id = format!("{:x}", Sha256::digest(identity.as_bytes()));
        serde_json::json!({
            "extensionId": self.extension_id,
            "extensionPath": format!("/extensions/{}", self.extension_id),
            "workspaceId": workspace_id,
            "workspacePath": if self.require("workspace.read").is_ok_and(|permission| permission == ContextPermissionState::Granted) { root } else { None },
            "platform": self.environment.platform,
            "colorScheme": self.environment.color_scheme,
        }).to_string()
    }
    fn get_environment(&mut self) -> ContextEnvironment {
        ContextEnvironment {
            theme: self.environment.theme.clone(),
            accent_color: self.environment.accent_color.clone(),
            color_scheme: self.environment.color_scheme.clone(),
            locale: self.environment.locale.clone(),
            font_weight: self.environment.font_weight.clone(),
            font_size: self.environment.font_size.clone(),
            app_version: self.environment.app_version.clone(),
            platform: self.environment.platform.clone(),
        }
    }

    fn get_editor_snapshot(&mut self) -> ContextEditorSnapshot {
        let granted = self.is_granted("editor.current.read");
        match &self.editor_snapshot {
            Some(snapshot) if granted => ContextEditorSnapshot {
                path: snapshot.path.clone(),
                language: snapshot.language.clone(),
                content: snapshot.content.clone(),
                version: snapshot.version,
            },
            _ => ContextEditorSnapshot {
                path: None,
                language: None,
                content: None,
                version: 0,
            },
        }
    }

    fn get_editor_selection(&mut self) -> Option<ContextSelectionRange> {
        if self.is_granted("editor.current.read") {
            self.editor_selection
        } else {
            None
        }
    }

    fn get_editor_selection_text(&mut self) -> Option<String> {
        if self.is_granted("editor.current.read") {
            self.editor_selection_text.clone()
        } else {
            None
        }
    }

    fn get_workspace_info(&mut self) -> ContextWorkspaceInfo {
        if self.is_granted("workspace.read") {
            if let Some(root) = self.workspace_root.as_ref() {
                let root_name = root
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string());
                return ContextWorkspaceInfo {
                    has_workspace: true,
                    name: self.workspace_name.clone().or_else(|| root_name.clone()),
                    root_name,
                };
            }
        }
        ContextWorkspaceInfo {
            has_workspace: false,
            name: None,
            root_name: None,
        }
    }

    fn request_permission(&mut self, permission: String) -> ContextPermissionState {
        // WIT 契约只能返回三态：对未开放的权限返回 Denied，
        // 具体原因由后续的能力调用（如 write-workspace-file）给出明确错误。
        self.require(&permission)
            .unwrap_or(ContextPermissionState::Denied)
    }

    fn read_workspace_file(&mut self, path: String) -> Result<String, String> {
        self.require_granted("workspace.read")?;
        let resolved = self.resolve_workspace_path(&path)?;
        if !resolved.is_file() {
            return Err(format!("不是文件: {path}"));
        }

        let metadata = std::fs::metadata(&resolved)
            .map_err(|error| format!("无法读取文件 {path}: {error}"))?;
        if metadata.len() > MAX_WORKSPACE_READ_BYTES {
            return Err(format!("文件过大，拒绝读取: {path}"));
        }

        std::fs::read_to_string(&resolved).map_err(|error| format!("读取文件 {path} 失败: {error}"))
    }

    fn read_workspace_range(
        &mut self,
        path: String,
        offset: u64,
        length: u32,
    ) -> Result<String, String> {
        self.require_granted("workspace.read")?;
        let resolved = self.resolve_workspace_path(&path)?;
        if !resolved.is_file() {
            return Err(format!("不是文件: {path}"));
        }
        // 单次分块上限：防止扩展用超大 length 绕过分块语义
        let length = (length as u64).min(MAX_WORKSPACE_RANGE_BYTES);

        use std::io::{Read, Seek, SeekFrom};
        let mut file = std::fs::File::open(&resolved)
            .map_err(|error| format!("打开文件 {path} 失败: {error}"))?;
        let file_len = file
            .metadata()
            .map_err(|error| format!("读取文件大小 {path} 失败: {error}"))?
            .len();
        if offset >= file_len {
            return Ok(String::new());
        }
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| format!("定位文件偏移 {path} 失败: {error}"))?;

        // 多读一些字节保证 UTF-8 边界可截断，再裁剪到完整字符边界
        let mut buffer = vec![0u8; (length as usize + 4).min((file_len - offset) as usize + 4)];
        let mut read_total = 0usize;
        loop {
            let read = file
                .read(&mut buffer[read_total..])
                .map_err(|error| format!("读取文件 {path} 失败: {error}"))?;
            if read == 0 {
                break;
            }
            read_total += read;
            if read_total >= buffer.len() {
                break;
            }
        }
        buffer.truncate(read_total);
        buffer.truncate(buffer.len().min(length as usize + 3));
        // 截到 UTF-8 字符边界（拒绝截断半个多字节字符）
        let mut end = buffer.len().min(length as usize);
        while end > 0 && std::str::from_utf8(&buffer[..end]).is_err() {
            end -= 1;
        }
        String::from_utf8(buffer[..end].to_vec())
            .map_err(|error| format!("文件 {path} 不是有效的 UTF-8 文本: {error}"))
    }

    fn get_workspace_file_metadata(&mut self, path: String) -> Result<ContextFileEntry, String> {
        self.require_granted("workspace.read")?;
        let resolved = self.resolve_workspace_path(&path)?;
        let metadata = std::fs::metadata(&resolved)
            .map_err(|error| format!("读取文件元数据 {path} 失败: {error}"))?;
        Ok(ContextFileEntry {
            name: resolved
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone()),
            is_directory: metadata.is_dir(),
            size_bytes: metadata.len(),
        })
    }

    fn write_workspace_file(&mut self, path: String, content: String) -> Result<bool, String> {
        // 写文件必须显式持有 workspace.write：read 不能顶替 write。
        // 修复此前"设置里的 workspace.write 开关对行为零影响"的装饰性问题。
        self.require_granted("workspace.write")?;
        let root = self
            .workspace_root
            .as_ref()
            .ok_or_else(|| "尚未打开工作区".to_string())?;

        let requested = Path::new(&path);
        let mut safe = true;
        for component in requested.components() {
            match component {
                Component::ParentDir
                | Component::RootDir
                | Component::Prefix(_)
                | Component::CurDir => {
                    safe = false;
                    break;
                }
                Component::Normal(_) => {}
            }
        }
        if !safe || requested.is_absolute() {
            return Err(format!("不允许写入工作区外的路径: {path}"));
        }

        // 禁止写入 .git 等敏感目录
        for part in requested.iter() {
            let part_str = part.to_string_lossy();
            if part_str.eq_ignore_ascii_case(".git") {
                return Err(format!("禁止修改系统版本控制目录: {path}"));
            }
        }

        if content.len() > MAX_WORKSPACE_WRITE_BYTES {
            return Err(format!("写入内容过大（超过 10MB 限制）: {path}"));
        }

        let canonical_root = root
            .canonicalize()
            .map_err(|error| format!("无法解析工作区根目录 {}: {error}", root.display()))?;

        let target_path = canonical_root.join(requested);
        if let Some(parent) = target_path.parent() {
            let mut existing = parent;
            while !existing.exists() {
                existing = existing
                    .parent()
                    .ok_or_else(|| "Workspace write path has no existing ancestor".to_string())?;
            }
            ensure_workspace_write_location(&canonical_root, existing)?;
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("创建父目录失败 {}: {error}", parent.display()))?;
            ensure_workspace_write_location(&canonical_root, parent)?;
        }

        if let Ok(metadata) = std::fs::symlink_metadata(&target_path) {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("Workspace write target is not a regular file".to_string());
            }
            ensure_workspace_write_location(&canonical_root, &target_path)?;
        }

        std::fs::write(&target_path, content.as_bytes())
            .map_err(|error| format!("写入文件 {path} 失败: {error}"))?;

        Ok(true)
    }

    fn list_workspace_files(
        &mut self,
        directory: String,
        max_count: u32,
    ) -> Result<Vec<ContextFileEntry>, String> {
        self.require_granted("workspace.read")?;
        let root = self
            .workspace_root
            .as_ref()
            .ok_or_else(|| "尚未打开工作区".to_string())?;

        let dir_path = Path::new(&directory);
        let mut safe = true;
        for component in dir_path.components() {
            match component {
                Component::ParentDir | Component::Prefix(_) => {
                    safe = false;
                    break;
                }
                _ => {}
            }
        }
        if !safe {
            return Err(format!("不安全的工作区目录路径: {directory}"));
        }

        let canonical_root = root
            .canonicalize()
            .map_err(|error| format!("无法解析工作区根目录 {}: {error}", root.display()))?;
        let target_dir = if directory.is_empty() || directory == "." {
            canonical_root.clone()
        } else {
            canonical_root
                .join(dir_path)
                .canonicalize()
                .map_err(|error| format!("无法解析工作区目录 {directory}: {error}"))?
        };

        if !target_dir.starts_with(&canonical_root) {
            return Err(format!("不允许访问工作区外的目录: {directory}"));
        }
        if !target_dir.is_dir() {
            return Err(format!("指定路径不是目录: {directory}"));
        }

        let limit = max_count.min(MAX_WORKSPACE_LIST_ENTRIES) as usize;
        let mut entries = Vec::new();
        let read_dir = std::fs::read_dir(&target_dir)
            .map_err(|error| format!("列出目录 {directory} 失败: {error}"))?;

        for entry in read_dir {
            if entries.len() >= limit {
                break;
            }
            if let Ok(entry) = entry {
                let name = entry.file_name().to_string_lossy().to_string();
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
                entries.push(ContextFileEntry {
                    name,
                    is_directory: is_dir,
                    size_bytes,
                });
            }
        }
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(entries)
    }

    fn watch_workspace_path(&mut self, path: String) -> Result<u64, String> {
        use notify::Watcher;
        use std::sync::mpsc;
        use std::time::Duration;

        self.require_granted("workspace.read")?;
        let target = self.resolve_workspace_path(&path)?;

        // notify 只能监听目录：文件路径改为监听其父目录，并按精确路径过滤事件
        let watch_target;
        let filter_path: Option<std::path::PathBuf> = if target.is_dir() {
            watch_target = target.clone();
            None
        } else {
            watch_target = target
                .parent()
                .ok_or_else(|| format!("无法定位父目录: {path}"))?
                .to_path_buf();
            Some(target.clone())
        };

        let watch_id = WATCH_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let registry_extension_id = self.extension_id.clone();
        let thread_extension_id = self.extension_id.clone();
        let mut registry = WATCH_REGISTRY
            .lock()
            .map_err(|_| "[host.error] Watch registry unavailable")?;
        self.require_current()?;
        if registry.len() >= 64
            || registry
                .values()
                .filter(|watch| watch.extension_id == registry_extension_id)
                .count()
                >= 4
        {
            return Err("[resource.limit] Extension watcher limit reached".into());
        }
        use tauri::Manager;
        let app = self
            .app
            .clone()
            .ok_or("[host.unavailable] Watcher requires an active host")?;
        let generation = app.state::<crate::workspace::WorkspaceState>().generation();
        let watcher_lease =
            crate::resource_limits::acquire_watcher(generation, Some(&registry_extension_id))?;
        let lease = self.runtime_lease.clone();

        let (sender, receiver) = mpsc::sync_channel::<notify::Result<notify::Event>>(256);
        let overflow = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let callback_overflow = overflow.clone();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                if sender.try_send(event).is_err() {
                    callback_overflow.store(true, std::sync::atomic::Ordering::Release);
                }
            })
            .map_err(|error| format!("无法创建文件监听器: {error}"))?;
        watcher
            .watch(&watch_target, notify::RecursiveMode::NonRecursive)
            .map_err(|error| format!("无法监听 {path}: {error}"))?;

        // 聚合线程：300ms 窗口合并事件后写入扩展事件队列（poll-events 拉取）
        std::thread::spawn(move || {
            let mut pending = crate::resource_limits::WatchBatch::default();
            let mut flush_at = std::time::Instant::now() + Duration::from_millis(100);
            loop {
                if app.state::<crate::workspace::WorkspaceState>().generation() != generation
                    || lease
                        .as_ref()
                        .is_some_and(|lease| !lease.load(std::sync::atomic::Ordering::Acquire))
                {
                    break;
                }
                match receiver
                    .recv_timeout(flush_at.saturating_duration_since(std::time::Instant::now()))
                {
                    Ok(Ok(event)) => {
                        for changed in event.paths {
                            if filter_path
                                .as_ref()
                                .is_some_and(|prefix| &changed != prefix)
                            {
                                continue;
                            }
                            pending.push(changed.to_string_lossy().into_owned());
                        }
                    }
                    Ok(Err(_)) => {
                        overflow.store(true, std::sync::atomic::Ordering::Release);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
                if std::time::Instant::now() >= flush_at {
                    let overflowed = overflow.swap(false, std::sync::atomic::Ordering::AcqRel);
                    if pending.has_events() || overflowed {
                        let (paths, batch_overflow) = pending.take();
                        let payload = serde_json::json!({ "type": "workspace-changed", "watchId": watch_id,
                            "paths": paths, "overflow": overflowed || batch_overflow });
                        if push_host_event(&thread_extension_id, &lease, payload.to_string())
                            .is_err()
                        {
                            overflow.store(true, std::sync::atomic::Ordering::Release);
                        }
                    }
                    flush_at = std::time::Instant::now() + Duration::from_millis(100);
                }
            }
        });

        registry.insert(
            watch_id,
            ExtensionWatchEntry {
                extension_id: registry_extension_id,
                _watcher: watcher,
                _lease: watcher_lease,
            },
        );
        Ok(watch_id)
    }

    fn unwatch_workspace_path(&mut self, watch_id: u64) -> Result<bool, String> {
        self.require_granted("workspace.read")?;
        // 仅允许移除自己注册的 watch：其他扩展的监视项不可见也不可动
        let removed = WATCH_REGISTRY.lock().ok().and_then(|mut guard| {
            let owned = guard
                .get(&watch_id)
                .is_some_and(|entry| entry.extension_id == self.extension_id);
            if owned {
                guard.remove(&watch_id).map(|_| ())
            } else {
                None
            }
        });
        Ok(removed.is_some())
    }

    fn log(&mut self, level: String, message: String) {
        eprintln!("[aurona-extension][{level}] {message}");
    }

    fn show_notification(&mut self, level: String, message: String) -> Result<bool, String> {
        // 通知走前端 toast（glass 语言），不再只落 stderr
        self.emit_to_frontend(
            "extension://notification",
            serde_json::json!({
                "extensionId": self.extension_id,
                "level": level,
                "message": message,
            }),
        )?;
        Ok(true)
    }

    fn write_clipboard(&mut self, text: String) -> Result<bool, String> {
        // 剪贴板经前端桥接（webview 持有系统能力），clipboard.access 已开放
        self.require_granted("clipboard.access")?;
        let response = self.request_frontend_blocking(
            "clipboard-write",
            serde_json::json!({ "text": text }),
            std::time::Duration::from_secs(5),
        )?;
        let value = Self::parse_host_response(&response)?;
        match value.get("error") {
            Some(error) => Err(format!(
                "[clipboard.error] 剪贴板写入失败: {}",
                error.as_str().unwrap_or("unknown")
            )),
            None => Ok(true),
        }
    }

    fn read_clipboard(&mut self) -> Result<String, String> {
        self.require_granted("clipboard.access")?;
        let response = self.request_frontend_blocking(
            "clipboard-read",
            serde_json::json!({}),
            std::time::Duration::from_secs(5),
        )?;
        let value = Self::parse_host_response(&response)?;
        match value.get("error") {
            Some(error) => Err(format!(
                "[clipboard.error] 剪贴板读取失败: {}",
                error.as_str().unwrap_or("unknown")
            )),
            None => Ok(value
                .get("value")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()),
        }
    }

    fn get_icon_svg(&mut self, name: String) -> Option<String> {
        // 标准 24x24 线性图标（stroke: currentColor）。按需扩充；
        // 图标名与前端 IconManager 的常用名保持一致，扩展侧可放心引用。
        const OPEN: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">";
        let path = match name.as_str() {
            "check" => "<polyline points=\"20 6 9 17 4 12\"/>",
            "trash" => "<path d=\"M3 6h18\"/><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\"/><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\"/>",
            "plus" => "<line x1=\"12\" y1=\"5\" x2=\"12\" y2=\"19\"/><line x1=\"5\" y1=\"12\" x2=\"19\" y2=\"12\"/>",
            "clipboard" => "<path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\"/><rect x=\"8\" y=\"2\" width=\"8\" height=\"4\" rx=\"1\" ry=\"1\"/>",
            "calendar" => "<rect x=\"3\" y=\"4\" width=\"18\" height=\"18\" rx=\"2\" ry=\"2\"/><line x1=\"16\" y1=\"2\" x2=\"16\" y2=\"6\"/><line x1=\"8\" y1=\"2\" x2=\"8\" y2=\"6\"/><line x1=\"3\" y1=\"10\" x2=\"21\" y2=\"10\"/>",
            "code" => "<polyline points=\"16 18 22 12 16 6\"/><polyline points=\"8 6 2 12 8 18\"/>",
            "zap" => "<polygon points=\"13 2 3 14 12 14 11 22 21 10 12 10 13 2\"/>",
            "terminal" => "<polyline points=\"4 17 10 11 4 5\"/><line x1=\"12\" y1=\"19\" x2=\"20\" y2=\"19\"/>",
            "search" => "<circle cx=\"11\" cy=\"11\" r=\"8\"/><line x1=\"21\" y1=\"21\" x2=\"16.65\" y2=\"16.65\"/>",
            "settings" => "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z\"/>",
            "home" => "<path d=\"M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/><polyline points=\"9 22 9 12 15 12 15 22\"/>",
            "clock" => "<circle cx=\"12\" cy=\"12\" r=\"10\"/><polyline points=\"12 6 12 12 16 14\"/>",
            "user" => "<path d=\"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2\"/><circle cx=\"12\" cy=\"7\" r=\"4\"/>",
            "file" => "<path d=\"M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><polyline points=\"13 2 13 9 20 9\"/>",
            "folder" => "<path d=\"M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z\"/>",
            "star" => "<polygon points=\"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2\"/>",
            "x" => "<line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/>",
            _ => return None,
        };
        Some(format!("{OPEN}{path}</svg>"))
    }

    fn execute_command(
        &mut self,
        command_id: String,
        arguments: Vec<String>,
    ) -> Result<String, String> {
        // 命令走前端命令注册表执行（请求-响应桥），结果或错误回传扩展
        let response = self.request_frontend_blocking(
            "command",
            serde_json::json!({
                "commandId": command_id,
                "arguments": arguments,
            }),
            std::time::Duration::from_secs(15),
        )?;
        let value = Self::parse_host_response(&response)?;
        match value.get("error") {
            Some(error) => Err(format!(
                "[command.error] 命令执行失败: {}",
                error.as_str().unwrap_or("unknown")
            )),
            None => Ok(value
                .get("result")
                .and_then(|v| v.as_str())
                .unwrap_or("ok")
                .to_string()),
        }
    }

    fn set_status_message(&mut self, message: String, timeout_ms: u32) -> Result<bool, String> {
        self.require_current()?;
        // 状态栏消息由前端 StatusBar 渲染（transient item）
        self.emit_to_frontend(
            "extension://status-message",
            serde_json::json!({
                "extensionId": self.extension_id,
                "message": message,
                "timeoutMs": timeout_ms,
            }),
        )?;
        Ok(true)
    }

    fn insert_editor_text(&mut self, text: String) -> Result<bool, String> {
        // 写入通路：require 权限后，把插入请求以事件交给前端编辑器桥
        // （ExtensionEditorBridge → EditorAdapter → 活动引擎）。
        self.require_granted("editor.current.write")?;
        self.emit_to_frontend(
            "extension://editor/insert-text",
            serde_json::json!({
                "extensionId": self.extension_id,
                "text": text,
            }),
        )?;
        Ok(true)
    }

    fn reveal_editor_line(&mut self, line: u32) -> Result<bool, String> {
        // 定位到某行属于编辑器操控，与插入文本同属 editor.current.write。
        self.require_granted("editor.current.write")?;
        self.emit_to_frontend(
            "extension://editor/reveal-line",
            serde_json::json!({
                "extensionId": self.extension_id,
                "line": line,
            }),
        )?;
        Ok(true)
    }

    fn get_sdk_version(&mut self) -> u32 {
        1
    }

    fn contribute_fliuno_items(
        &mut self,
        items: Vec<aurona::extensions::context::FliunoItem>,
    ) -> Result<bool, String> {
        // 与 request-permission 走同一条 require() 路径，
        // 修复此前"扩展主动请求 fliuno.search 恒为 Denied，但宿主却单独放行"的双轨问题。
        self.require_granted("fliuno.search")?;
        if items.len() > MAX_FLIUNO_ITEMS {
            return Err(format!(
                "Fliuno 贡献项超出上限（最多 {MAX_FLIUNO_ITEMS} 个）"
            ));
        }
        // bindgen 生成类型未实现 Serialize：映射为宿主侧结构后再发事件，
        // 前端 ExtensionFliunoRegistry 把它们注册为该扩展的搜索源。
        let payload: Vec<FliunoContributedItem> = items
            .into_iter()
            .map(|item| FliunoContributedItem {
                id: item.id,
                title: item.title,
                subtitle: item.subtitle,
                icon: item.icon,
                action: item.action,
            })
            .collect();
        self.emit_to_frontend(
            "extension://fliuno/contribute-items",
            serde_json::json!({
                "extensionId": self.extension_id,
                "items": payload,
            }),
        )?;
        Ok(true)
    }

    fn git_repository_info(&mut self) -> Option<ContextGitRepoInfo> {
        // WIT 契约返回 option：仓库不存在或查询失败时统一给 None，
        // 权限不足同样表现为 None（不泄露仓库状态）。
        let result = (|| -> Result<ContextGitRepoInfo, String> {
            let root = self.git_workspace_root()?;
            let root_str = root.to_string_lossy().to_string();
            if !crate::git::git_check_is_repo_internal(root_str.clone())? {
                return Err("not a repository".to_string());
            }
            let branch = crate::git::git_current_branch_internal(root_str.clone())?;
            let has_remote = !crate::git::git_get_remote_internal(root_str.clone())?.is_empty();
            let (ahead, behind) = crate::git::git_tracking_status_internal(root_str.clone())?;
            Ok(ContextGitRepoInfo {
                root: root_str,
                branch,
                ahead,
                behind,
                has_remote,
            })
        })();
        match result {
            Ok(info) => Some(info),
            Err(error) => {
                eprintln!(
                    "[aurona-git] 扩展 {} 查询仓库信息失败: {error}",
                    self.extension_id
                );
                None
            }
        }
    }

    fn git_status(&mut self) -> Result<Vec<ContextGitFileStatus>, String> {
        let root = self.git_workspace_root()?;
        let files = crate::git::git_status_internal(root.to_string_lossy().to_string())?;
        Ok(files
            .into_iter()
            .map(|file| ContextGitFileStatus {
                path: file.path,
                change: file.status,
                staged: file.is_staged,
            })
            .collect())
    }

    fn git_log(&mut self, limit: u32) -> Result<Vec<ContextGitLogEntry>, String> {
        let root = self.git_workspace_root()?;
        let mut commits = crate::git::git_log_internal(root.to_string_lossy().to_string())?;
        // git log 返回新在前；截断到扩展请求的条数并限制绝对上限。
        let limit = (limit as usize).min(MAX_GIT_LOG_ENTRIES);
        commits.truncate(limit);
        Ok(commits
            .into_iter()
            .map(|commit| ContextGitLogEntry {
                hash: commit.hash,
                author: commit.author,
                message: commit.message,
                date: commit.date,
            })
            .collect())
    }

    fn git_diff(&mut self, path: String) -> Result<String, String> {
        let root = self.git_workspace_root()?;
        let root_str = root.to_string_lossy().to_string();
        crate::git::git_worktree_diff_internal(root_str, path, false)
    }

    fn git_stage(&mut self, paths: Vec<String>) -> Result<bool, String> {
        let root = self.git_write_root()?;
        let root_str = root.to_string_lossy().to_string();
        for path in &paths {
            crate::git::git_add_internal(root_str.clone(), path.clone())?;
        }
        Ok(true)
    }

    fn git_unstage(&mut self, paths: Vec<String>) -> Result<bool, String> {
        let root = self.git_write_root()?;
        let root_str = root.to_string_lossy().to_string();
        for path in &paths {
            crate::git::git_unstage_internal(root_str.clone(), path.clone())?;
        }
        Ok(true)
    }

    fn git_commit(&mut self, message: String) -> Result<bool, String> {
        let root = self.git_write_root()?;
        if message.trim().is_empty() {
            return Err("提交信息不能为空".to_string());
        }
        crate::git::git_commit_internal(root.to_string_lossy().to_string(), message)?;
        Ok(true)
    }

    fn storage_get(&mut self, key: String) -> Result<Option<String>, String> {
        // 沙箱键值存储：每个扩展按 id 分离保存在 APPDATA 下
        let storage_dir = self.get_storage_dir();
        let file_path = resolve_storage_file(&storage_dir, &key)?;
        if file_path.exists() {
            let content =
                std::fs::read_to_string(&file_path).map_err(|e| format!("读取存储项失败: {e}"))?;
            Ok(Some(content))
        } else {
            Ok(None)
        }
    }

    fn storage_set(&mut self, key: String, value: String) -> Result<bool, String> {
        let storage_dir = self.get_storage_dir();
        std::fs::create_dir_all(&storage_dir).map_err(|e| format!("创建存储目录失败: {e}"))?;
        let file_path = resolve_storage_file(&storage_dir, &key)?;
        std::fs::write(&file_path, value).map_err(|e| format!("写入存储项失败: {e}"))?;
        Ok(true)
    }

    fn storage_delete(&mut self, key: String) -> Result<bool, String> {
        let storage_dir = self.get_storage_dir();
        let file_path = resolve_storage_file(&storage_dir, &key)?;
        if file_path.exists() {
            std::fs::remove_file(file_path).map_err(|error| error.to_string())?;
        }
        Ok(true)
    }

    fn storage_list_keys(&mut self) -> Result<Vec<String>, String> {
        let storage_dir = self.get_storage_dir();
        if !storage_dir.exists() {
            return Ok(Vec::new());
        }
        validate_storage_dir(&storage_dir)?;
        let mut keys = Vec::new();
        if let Ok(entries) = std::fs::read_dir(storage_dir) {
            for entry in entries.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    if let Some(stripped) = name.strip_suffix(".json") {
                        keys.push(stripped.to_string());
                    }
                }
            }
        }
        Ok(keys)
    }

    fn show_dialog_confirm(&mut self, title: String, message: String) -> Result<bool, String> {
        // 确认对话框走前端 Modal（请求-响应桥），用户取消/确认都有应答
        let response = self.request_frontend_blocking(
            "confirm",
            serde_json::json!({
                "title": title,
                "message": message,
            }),
            std::time::Duration::from_secs(120),
        )?;
        let value = Self::parse_host_response(&response)?;
        Ok(value
            .get("confirmed")
            .and_then(|confirmed| confirmed.as_bool())
            .unwrap_or(false))
    }

    fn show_input_box(
        &mut self,
        title: String,
        placeholder: String,
    ) -> Result<Option<String>, String> {
        let response = self.request_frontend_blocking(
            "input",
            serde_json::json!({
                "title": title,
                "placeholder": placeholder,
            }),
            std::time::Duration::from_secs(120),
        )?;
        let value = Self::parse_host_response(&response)?;
        if value.get("cancelled").and_then(|c| c.as_bool()) == Some(true) {
            return Ok(None);
        }
        Ok(Some(
            value
                .get("value")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        ))
    }

    fn show_quick_pick(
        &mut self,
        items: Vec<aurona::extensions::context::QuickPickItem>,
        title: String,
        placeholder: String,
    ) -> Result<Option<String>, String> {
        let payload: Vec<serde_json::Value> = items
            .into_iter()
            .map(|item| {
                serde_json::json!({
                    "id": item.id,
                    "label": item.label,
                    "detail": item.detail,
                    "icon": item.icon,
                })
            })
            .collect();
        let response = self.request_frontend_blocking(
            "quick-pick",
            serde_json::json!({
                "items": payload,
                "title": title,
                "placeholder": placeholder,
            }),
            std::time::Duration::from_secs(120),
        )?;
        let value = Self::parse_host_response(&response)?;
        if value.get("cancelled").and_then(|c| c.as_bool()) == Some(true) {
            return Ok(None);
        }
        Ok(value.get("id").and_then(|id| id.as_str()).map(String::from))
    }

    fn poll_events(&mut self) -> Vec<String> {
        if self.require_current().is_err() {
            return Vec::new();
        }
        drain_host_events(&self.extension_id)
    }

    fn storage_clear(&mut self) -> Result<bool, String> {
        let storage_dir = self.get_storage_dir();
        if !storage_dir.exists() {
            return Ok(true);
        }
        validate_storage_dir(&storage_dir)?;
        std::fs::remove_dir_all(&storage_dir).map_err(|e| format!("清空存储失败: {e}"))?;
        Ok(true)
    }
}
