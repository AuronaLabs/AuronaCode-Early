use super::*;
use aurona::extensions::context::Host as _;
use std::path::PathBuf;

#[test]
fn bundled_compat_executes_real_demo_and_preserves_session() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let package = super::super::aurx::open_package(
        &std::fs::read(root.join("resources/extensions/aurona.vscode-compat.aurx")).unwrap(),
    )
    .unwrap();
    let demo = super::super::aurx::open_vsix_package(
        &std::fs::read(root.join("resources/extensions-demo/vscode-demo.vsix")).unwrap(),
    )
    .unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let context = || {
        let mut context = test_context(None);
        context.extension_id = demo.id().into();
        context.test_frontend_events = Some(events.clone());
        context
    };
    let runtime = ExtensionRuntime::new(&package.wasm, ExtensionLimits::trusted_compat()).unwrap();
    let first = runtime.render(context(), demo.js_source.clone()).unwrap();
    let value: serde_json::Value = serde_json::from_str(&first.html).unwrap();
    assert_eq!(value["mode"], "declarative");
    assert!(
        first.html.contains("vscodeDemo.helloWorld")
            && first.html.contains("vscodeDemo.showStatus")
    );
    runtime
        .on_action(
            context(),
            "run:vscodeDemo.helloWorld".into(),
            demo.js_source.clone(),
        )
        .unwrap();
    runtime
        .on_action(
            context(),
            "run:vscodeDemo.showStatus".into(),
            demo.js_source.clone(),
        )
        .unwrap();
    let second = runtime.render(context(), demo.js_source.clone()).unwrap();
    assert_eq!(second.html.matches("Extension is now active").count(), 1);
    let captured = events.lock().unwrap();
    assert!(captured
        .iter()
        .any(|(event, payload)| event == "extension://notification"
            && payload["message"]
                .as_str()
                .is_some_and(|text| text.contains("Hello from VSCode"))));
    assert!(captured
        .iter()
        .any(|(event, payload)| event == "extension://status-message"
            && payload["timeoutMs"] == 4000));
    drop(captured);
    drop(runtime);
    assert!(events
        .lock()
        .unwrap()
        .iter()
        .any(|(event, payload)| event == "extension://status-message" && payload["message"] == ""));
}

fn test_environment() -> ContextEnvironment {
    ContextEnvironment {
        theme: "coral-sunset".to_string(),
        accent_color: "coral".to_string(),
        color_scheme: "dark".to_string(),
        locale: "zh-CN".to_string(),
        font_weight: "normal".to_string(),
        font_size: "default".to_string(),
        app_version: "0.3.13".to_string(),
        platform: "windows".to_string(),
    }
}

fn test_context(workspace_root: Option<PathBuf>) -> ExtensionContext {
    ExtensionContext::new(workspace_root, test_environment())
}

fn grant(context: &mut ExtensionContext, permission: &str) {
    context
        .permissions
        .insert(permission.to_string(), ContextPermissionState::Granted);
}

fn deny(context: &mut ExtensionContext, permission: &str) {
    context
        .permissions
        .insert(permission.to_string(), ContextPermissionState::Denied);
}

#[test]
fn editor_content_requires_grant() {
    let mut context = test_context(None);
    context.editor_snapshot = Some(ContextEditorSnapshot {
        path: Some("/repo/README.md".to_string()),
        language: Some("markdown".to_string()),
        content: Some("# secret".to_string()),
        version: 3,
    });
    deny(&mut context, "editor.current.read");
    let snapshot = context.get_editor_snapshot();
    assert_eq!(snapshot.content, None);
    assert_eq!(snapshot.version, 0);

    let mut context = test_context(None);
    context.editor_snapshot = Some(ContextEditorSnapshot {
        path: Some("/repo/README.md".to_string()),
        language: Some("markdown".to_string()),
        content: Some("# visible".to_string()),
        version: 3,
    });
    grant(&mut context, "editor.current.read");
    let snapshot = context.get_editor_snapshot();
    assert_eq!(snapshot.content.as_deref(), Some("# visible"));
    assert_eq!(snapshot.version, 3);
}

#[test]
fn unavailable_permissions_report_clearly_instead_of_denied() {
    let context = test_context(None);
    // terminal.execute 已登记但当前版本未开放：应给出"尚未开放"，
    // 与"用户明确拒绝"区分开
    let error = context.require("terminal.execute").unwrap_err();
    assert!(error.contains("尚未开放"), "{error}");
    // request-permission 在 WIT 三态约束下只能回退为 Denied
    let mut context = test_context(None);
    assert_eq!(
        context.request_permission("terminal.execute".to_string()),
        ContextPermissionState::Denied
    );
}

#[test]
fn rejects_workspace_escape() {
    let temp = std::env::temp_dir().join(format!("aurona-ext-workspace-{}", std::process::id()));
    std::fs::create_dir_all(&temp).unwrap();
    std::fs::write(temp.join("file.txt"), b"ok").unwrap();
    let mut host = test_context(Some(temp.clone()));
    grant(&mut host, "workspace.read");
    assert_eq!(
        host.read_workspace_file("file.txt".to_string()),
        Ok("ok".to_string())
    );
    assert!(host
        .read_workspace_file("../secret.txt".to_string())
        .is_err());
    assert!(host
        .read_workspace_file("C:\\Windows\\win.ini".to_string())
        .is_err());
    assert!(host
        .read_workspace_file("//server/share/file".to_string())
        .is_err());
    assert_eq!(
        host.read_workspace_file("file.txt".to_string()),
        Ok("ok".to_string())
    );
    std::fs::remove_dir_all(&temp).ok();
}

#[test]
fn write_workspace_file_enforces_safety() {
    let temp = std::env::temp_dir().join(format!("aurona-ext-write-{}", std::process::id()));
    std::fs::create_dir_all(&temp).unwrap();
    let mut host = test_context(Some(temp.clone()));

    // 只有 workspace.read 时必须拒绝写入：read 不能顶替 write
    grant(&mut host, "workspace.read");
    let error = host
        .write_workspace_file(".aurona/planner.json".to_string(), "{}".to_string())
        .unwrap_err();
    assert!(error.contains("workspace.write"), "{error}");

    // 显式持有 workspace.write 后才能写
    grant(&mut host, "workspace.write");
    assert_eq!(
        host.write_workspace_file(
            ".aurona/planner.json".to_string(),
            "{\"tasks\":[]}".to_string()
        ),
        Ok(true)
    );
    assert!(temp.join(".aurona").join("planner.json").exists());
    let content = std::fs::read_to_string(temp.join(".aurona").join("planner.json")).unwrap();
    assert_eq!(content, "{\"tasks\":[]}");

    // 拒绝路径逃逸
    assert!(host
        .write_workspace_file("../escape.txt".to_string(), "bad".to_string())
        .is_err());
    if cfg!(windows) {
        // Windows 上盘符路径是绝对路径；Unix 上反斜杠只是普通文件名字符
        assert!(host
            .write_workspace_file("C:\\Windows\\system.txt".to_string(), "bad".to_string())
            .is_err());
    } else {
        assert!(host
            .write_workspace_file("/etc/passwd".to_string(), "bad".to_string())
            .is_err());
    }

    // 拒绝写入 .git 系统敏感目录
    assert!(host
        .write_workspace_file(".git/config".to_string(), "bad".to_string())
        .is_err());

    std::fs::remove_dir_all(&temp).ok();
}

#[test]
fn environment_reports_metadata() {
    let mut context = test_context(None);
    context.environment.app_version = "0.3.13".to_string();
    context.environment.platform = "windows".to_string();
    let env = context.get_environment();
    assert_eq!(env.theme, "coral-sunset");
    assert_eq!(env.locale, "zh-CN");
    assert_eq!(env.app_version, "0.3.13");
    assert_eq!(env.platform, "windows");
}

#[test]
fn workspace_info_and_list_files_requires_grant() {
    let temp = std::env::temp_dir().join(format!("aurona-ext-list-{}", std::process::id()));
    std::fs::create_dir_all(&temp).unwrap();
    std::fs::write(temp.join("a.md"), b"test").unwrap();
    std::fs::create_dir(temp.join("sub")).unwrap();

    let mut host = test_context(Some(temp.clone()));
    host.workspace_name = Some("MyWorkspace".to_string());
    deny(&mut host, "workspace.read");

    let info = host.get_workspace_info();
    assert!(!info.has_workspace);
    assert_eq!(info.name, None);
    assert!(host.list_workspace_files(".".to_string(), 10).is_err());

    grant(&mut host, "workspace.read");
    let info = host.get_workspace_info();
    assert!(info.has_workspace);
    assert_eq!(info.name.as_deref(), Some("MyWorkspace"));

    let files = host.list_workspace_files(".".to_string(), 10).unwrap();
    assert_eq!(files.len(), 2);
    assert_eq!(files[0].name, "a.md");
    assert!(!files[0].is_directory);
    assert_eq!(files[1].name, "sub");
    assert!(files[1].is_directory);

    assert!(host.list_workspace_files("../".to_string(), 10).is_err());
    std::fs::remove_dir_all(&temp).ok();
}

#[test]
fn invalid_component_is_rejected() {
    let result = ExtensionRuntime::new(b"not a wasm component", ExtensionLimits::default());
    assert!(result.is_err());
}

#[test]
fn resources_return_to_owner_baseline_across_twenty_lifecycles() {
    let owner = "test.twenty-lifecycles";
    for cycle in 0..20 {
        let lease = runtime_lease(owner).unwrap();
        push_host_event(
            owner,
            &Some(lease.clone()),
            serde_json::json!({"type": "workspace-changed", "cycle": cycle}).to_string(),
        )
        .unwrap();
        cleanup_extension_resources(Some(owner));
        cleanup_extension_resources(Some(owner));
        assert!(!lease.load(std::sync::atomic::Ordering::Acquire));
        assert!(!resources::RUNTIME_LEASES
            .lock()
            .unwrap()
            .contains_key(owner));
        assert!(!resources::HOST_EVENT_QUEUES
            .lock()
            .unwrap()
            .contains_key(owner));
        assert!(push_host_event(
            owner,
            &Some(lease),
            "{\"type\":\"document-changed\"}".into()
        )
        .is_err());
    }
}

#[test]
fn workspace_write_rejects_linked_parents_and_git_targets() {
    let root = std::env::temp_dir().join(format!(
        "aurona-ext-write-links-{}-{}",
        std::process::id(),
        rand::random::<u64>()
    ));
    let outside = std::env::temp_dir().join(format!(
        "aurona-ext-write-outside-{}-{}",
        std::process::id(),
        rand::random::<u64>()
    ));
    std::fs::create_dir_all(root.join(".git")).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    let mut host = test_context(Some(root.clone()));
    grant(&mut host, "workspace.write");

    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink(&outside, root.join("linked"));
    #[cfg(windows)]
    let linked = std::os::windows::fs::symlink_dir(&outside, root.join("linked"));
    if linked.is_ok() {
        assert!(host
            .write_workspace_file("linked/nested/file.txt".to_string(), "bad".to_string())
            .is_err());
        assert!(!outside.join("nested").exists());
    }

    #[cfg(unix)]
    let git_link = std::os::unix::fs::symlink(root.join(".git"), root.join("git-alias"));
    #[cfg(windows)]
    let git_link = std::os::windows::fs::symlink_dir(root.join(".git"), root.join("git-alias"));
    if git_link.is_ok() {
        assert!(host
            .write_workspace_file("git-alias/config".to_string(), "bad".to_string())
            .is_err());
        assert!(!root.join(".git").join("config").exists());
    }

    std::fs::remove_dir_all(root).ok();
    std::fs::remove_dir_all(outside).ok();
}

#[test]
fn storage_keys_cannot_escape_the_extension_directory() {
    let directory = std::env::temp_dir().join(format!(
        "aurona-extension-storage-test-{}-{}",
        std::process::id(),
        rand::random::<u64>()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    assert_eq!(
        resolve_storage_file(&directory, "normal-key_1").unwrap(),
        directory.join("normal-key_1.json")
    );
    for key in [
        "",
        ".",
        "..",
        "../../extensions-permissions",
        "a/b",
        "a\\b",
        "C:evil",
    ] {
        assert!(resolve_storage_file(&directory, key).is_err(), "{key}");
    }
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn events_require_current_owner_declared_kind_bounded_payload_and_preserve_order() {
    let owner = "test.event-owner";
    let other = "test.event-other";
    let lease = Some(runtime_lease(owner).unwrap());
    let other_lease = Some(runtime_lease(other).unwrap());
    let event = |index| serde_json::json!({"type":"document-changed", "index":index}).to_string();
    assert!(push_host_event(owner, &None, event(0)).is_err());
    assert!(push_host_event(owner, &other_lease, event(0)).is_err());
    assert!(push_host_event(owner, &lease, "{\"type\":\"execute\"}".into()).is_err());
    assert!(push_host_event(
        owner,
        &lease,
        "x".repeat(crate::resource_limits::EXTENSION_PAYLOAD_BYTES + 1)
    )
    .is_err());
    for index in 0..MAX_EVENT_QUEUE {
        push_host_event(owner, &lease, event(index)).unwrap();
    }
    assert!(push_host_event(owner, &lease, event(MAX_EVENT_QUEUE)).is_err());
    let events = drain_host_events(owner);
    assert_eq!(events.len(), MAX_EVENT_QUEUE);
    for (index, actual) in events.iter().enumerate() {
        assert_eq!(actual, &event(index));
    }
    cleanup_extension_resources(Some(owner));
    assert!(push_host_event(owner, &lease, event(0)).is_err());
    let fresh = Some(runtime_lease(owner).unwrap());
    assert!(push_host_event(owner, &lease, event(0)).is_err());
    push_host_event(owner, &fresh, event(0)).unwrap();
    cleanup_extension_resources(Some(owner));
    cleanup_extension_resources(Some(other));
}
