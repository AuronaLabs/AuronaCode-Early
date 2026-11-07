fn scoped_state(root: &std::path::Path) -> super::WorkspaceState {
    let state = super::WorkspaceState::new();
    let root = root.canonicalize().unwrap();
    *state.directory.lock().unwrap() =
        Some(cap_std::fs::Dir::open_ambient_dir(&root, cap_std::ambient_authority()).unwrap());
    *state.root.lock().unwrap() = Some(root);
    state
}

#[test]
fn production_scope_rejects_forged_roots_and_traversal() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(root.path().join("inside.txt"), "inside").unwrap();
    fs::write(outside.path().join("outside.txt"), "outside").unwrap();
    let state = scoped_state(root.path());
    assert!(state
        .access(&root.path().join("inside.txt").to_string_lossy(), true)
        .is_ok());
    assert!(state
        .access(&outside.path().join("outside.txt").to_string_lossy(), true)
        .is_err());
    assert!(state
        .access(&root.path().join("../outside.txt").to_string_lossy(), false)
        .is_err());
    assert!(state.access("", false).is_err());
    assert_eq!(
        state
            .access(&root.path().to_string_lossy(), true)
            .unwrap()
            .1,
        std::path::Path::new(".")
    );
}

#[cfg(unix)]
#[test]
fn unix_root_aliases_keep_children_scoped_and_root_protected() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(root.path().join("inside"), b"inside").unwrap();
    fs::write(outside.path().join("secret"), b"secret").unwrap();
    let alias = outside.path().join("workspace-alias");
    std::os::unix::fs::symlink(root.path(), &alias).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("escape")).unwrap();
    let state = scoped_state(root.path());
    assert!(state
        .file_access(&alias.join("inside").to_string_lossy())
        .is_ok());
    assert!(!state
        .exists(&alias.join("missing").to_string_lossy())
        .unwrap());
    assert!(state
        .write_access(&alias.join("new").to_string_lossy())
        .is_ok());
    assert!(state.write_access(&alias.to_string_lossy()).is_err());
    assert!(state
        .access(&alias.join("../secret").to_string_lossy(), true)
        .is_err());
    assert!(state
        .file_access(&alias.join("escape/secret").to_string_lossy())
        .is_err());
    state
        .authorize_path(&outside.path().join("secret").to_string_lossy())
        .unwrap();
    assert!(state
        .file_access(&outside.path().join("secret").to_string_lossy())
        .is_ok());
    std::os::unix::fs::symlink(outside.path(), outside.path().join("outside-alias")).unwrap();
    assert!(state
        .file_access(
            &outside
                .path()
                .join("outside-alias/secret")
                .to_string_lossy()
        )
        .is_ok());
}

#[cfg(windows)]
#[test]
fn windows_scope_accepts_case_and_dos_aliases_without_expanding_authority() {
    use std::ffi::OsString;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;

    fn short_path(path: &std::path::Path) -> std::path::PathBuf {
        let input = path
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let mut output = vec![0u16; 32768];
        let length =
            unsafe { GetShortPathNameW(input.as_ptr(), output.as_mut_ptr(), output.len() as u32) }
                as usize;
        assert!(length > 0 && length < output.len());
        OsString::from_wide(&output[..length]).into()
    }

    let root = tempfile::Builder::new()
        .prefix("Aurona Workspace Long Name ")
        .tempdir()
        .unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(root.path().join("Inside File.txt"), b"inside").unwrap();
    fs::write(outside.path().join("Selected File.txt"), b"outside").unwrap();
    fs::create_dir(root.path().join(".aurona-recovery")).unwrap();
    fs::write(root.path().join(".aurona-recovery/protected"), b"recovery").unwrap();
    let state = scoped_state(root.path());
    assert!(state
        .access(r"\\aurona-no-authority.invalid\share\file", true)
        .is_err());
    assert!(state
        .file_access(r"\\aurona-no-authority.invalid\share\file")
        .is_err());
    let short_root = short_path(root.path());
    for alias in [
        root.path().to_string_lossy().to_lowercase(),
        root.path().to_string_lossy().to_uppercase(),
        short_root.to_string_lossy().into_owned(),
    ] {
        let alias = std::path::Path::new(&alias);
        let inside = alias.join("Inside File.txt");
        let (directory, name) = state.file_access(&inside.to_string_lossy()).unwrap();
        let mut file = crate::scoped_file::open(&directory, &name).unwrap();
        let mut contents = Vec::new();
        use std::io::Read;
        file.read_to_end(&mut contents).unwrap();
        assert_eq!(contents, b"inside");
        assert!(state.exists(&inside.to_string_lossy()).unwrap());
        assert!(!state
            .exists(&alias.join("new.txt").to_string_lossy())
            .unwrap());
        assert!(state
            .write_access(&alias.join("new.txt").to_string_lossy())
            .is_ok());
        assert!(state.write_access(&alias.to_string_lossy()).is_err());
        assert!(state
            .access(&alias.join("../escape.txt").to_string_lossy(), false)
            .is_err());
        assert!(state
            .write_access(&alias.join(".AURONA-RECOVERY/protected").to_string_lossy())
            .is_err());
    }
    let protected = short_path(&root.path().join(".aurona-recovery/protected"));
    assert!(state.write_access(&protected.to_string_lossy()).is_err());

    let selected = outside.path().join("Selected File.txt");
    assert!(state
        .file_access(&selected.to_string_lossy().to_lowercase())
        .is_err());
    state.authorize_path(&selected.to_string_lossy()).unwrap();
    assert!(state
        .file_access(r"\\aurona-no-authority.invalid\share\file")
        .is_err());
    assert!(state
        .file_access(&selected.to_string_lossy().to_lowercase())
        .is_ok());
    assert!(state
        .file_access(&short_path(&selected).to_string_lossy())
        .is_ok());
    assert!(state.access(&selected.to_string_lossy(), true).is_err());
    assert!(state
        .file_access(&outside.path().join("unselected").to_string_lossy())
        .is_err());

    let link = root.path().join("junction");
    assert!(std::process::Command::new("cmd")
        .args(["/d", "/c", "mklink", "/J"])
        .arg(&link)
        .arg(outside.path())
        .output()
        .unwrap()
        .status
        .success());
    let linked = short_root.join("JUNCTION/Selected File.txt");
    assert!(state.file_access(&linked.to_string_lossy()).is_err());
    fs::remove_dir(link).unwrap();
}

#[test]
fn directory_pages_are_bounded_single_use_cancellable_and_invalidated_by_changes() {
    let root = tempfile::tempdir().unwrap();
    for i in 0..1025 {
        fs::write(root.path().join(format!("entry-{i}")), b"").unwrap();
    }
    let state = scoped_state(root.path());
    let path = root.path().to_string_lossy().into_owned();
    let first = super::directory_page(&state, path.clone(), None).unwrap();
    assert_eq!(
        first.entries.len(),
        crate::resource_limits::DIRECTORY_PAGE_ENTRIES
    );
    let cursor = first.next_cursor.unwrap();
    let second = super::directory_page(&state, path.clone(), Some(cursor.clone())).unwrap();
    assert!(super::directory_page(&state, path.clone(), Some(cursor)).is_err());
    let cursor = second.next_cursor.unwrap();
    state
        .directory_revision
        .fetch_add(1, super::Ordering::AcqRel);
    assert!(super::directory_page(&state, path.clone(), Some(cursor)).is_err());
    let first = super::directory_page(&state, path.clone(), None).unwrap();
    let cursor = first.next_cursor.unwrap();
    state.cursors.lock().unwrap().remove(&cursor);
    assert!(super::directory_page(&state, path.clone(), Some(cursor)).is_err());
    let mut count = 0;
    let mut cursor = None;
    loop {
        let page = super::directory_page(&state, path.clone(), cursor).unwrap();
        assert!(page.entries.len() <= crate::resource_limits::DIRECTORY_PAGE_ENTRIES);
        count += page.entries.len();
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(count, 1025);
    assert!(state.cursors.lock().unwrap().is_empty());
}

#[test]
fn mutation_access_rejects_root_aliases_recovery_data_and_stale_authorization() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("selected"), b"outside").unwrap();
    let state = scoped_state(root.path());
    for path in [
        root.path().to_path_buf(),
        root.path().join("."),
        root.path().join(".aurona-recovery"),
        root.path().join(".AURONA-RECOVERY"),
    ] {
        assert!(state.write_access(&path.to_string_lossy()).is_err());
    }
    assert!(state.write_access("").is_err());
    state.generation.fetch_add(1, super::Ordering::AcqRel);
    assert!(state
        .authorize_path_at(&outside.path().join("selected").to_string_lossy(), 0)
        .is_err());
    assert!(state.authorized.lock().unwrap().is_empty());
}

#[test]
fn parent_link_replacement_cannot_escape_during_reads_and_staged_writes() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let slot = root.path().join("slot");
    let link = root.path().join("link");
    let parked = root.path().join("parked");
    fs::create_dir(&slot).unwrap();
    fs::write(slot.join("text"), b"inside").unwrap();
    fs::write(outside.path().join("text"), b"secret").unwrap();
    #[cfg(windows)]
    assert!(std::process::Command::new("cmd")
        .args(["/d", "/c", "mklink", "/J"])
        .arg(&link)
        .arg(outside.path())
        .output()
        .unwrap()
        .status
        .success());
    #[cfg(unix)]
    std::os::unix::fs::symlink(outside.path(), &link).unwrap();
    let state = scoped_state(root.path());
    let target = slot.join("text");
    let (advance, step) = std::sync::mpsc::sync_channel(0);
    let (result, changed) = std::sync::mpsc::sync_channel(0);
    let worker = std::thread::spawn(move || {
        for _ in 0..100 {
            if step
                .recv_timeout(std::time::Duration::from_secs(2))
                .is_err()
            {
                return;
            }
            let replaced = fs::rename(&slot, &parked).is_ok();
            if replaced {
                fs::rename(&link, &slot).unwrap();
            }
            if result.send(replaced).is_err() {
                return;
            }
            if step
                .recv_timeout(std::time::Duration::from_secs(2))
                .is_err()
            {
                return;
            }
            if replaced {
                fs::rename(&slot, &link).unwrap();
                fs::rename(&parked, &slot).unwrap();
            }
            if result.send(false).is_err() {
                return;
            }
        }
        #[cfg(windows)]
        fs::remove_dir(&link).unwrap();
        #[cfg(unix)]
        fs::remove_file(&link).unwrap();
    });
    let mut replacements = 0;
    for _ in 0..100 {
        let (dir, name) = state.access(&target.to_string_lossy(), true).unwrap();
        advance.send(()).unwrap();
        let replaced = changed
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        if replaced {
            replacements += 1;
            assert!(state.access(&target.to_string_lossy(), true).is_err());
        }
        let mut file = crate::scoped_file::open(&dir, &name).unwrap();
        use std::io::Read;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, b"inside");
        drop(file);
        crate::scoped_file::write(&dir, &name, b"inside").unwrap();
        drop(dir);
        advance.send(()).unwrap();
        changed
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
    }
    worker.join().unwrap();
    #[cfg(unix)]
    assert_eq!(replacements, 100);
    eprintln!(
        "Parent replacement: {replacements} swapped, {} rejected by OS handle sharing",
        100 - replacements
    );
    assert_eq!(fs::read(outside.path().join("text")).unwrap(), b"secret");
}

#[test]
fn recovery_fingerprint_survives_a_rename_and_detects_same_size_rewrites() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("original"), "before").unwrap();
    let state = scoped_state(root.path());
    let (directory, name) = state
        .access(&root.path().join("original").to_string_lossy(), true)
        .unwrap();
    let before = super::tree_digest(&directory, &name).unwrap();
    directory.rename("original", &directory, "content").unwrap();
    assert_eq!(
        before,
        super::tree_digest(&directory, std::path::Path::new("content")).unwrap()
    );
    fs::write(root.path().join("content"), "after!").unwrap();
    assert_ne!(
        before.0,
        super::tree_digest(&directory, std::path::Path::new("content"))
            .unwrap()
            .0
    );
}

#[cfg(windows)]
#[test]
fn production_scope_refuses_a_junction_to_an_external_target() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("secret.txt"), "secret").unwrap();
    let link = root.path().join("link");
    let output = std::process::Command::new("cmd")
        .args(["/d", "/c", "mklink", "/J"])
        .arg(&link)
        .arg(outside.path())
        .output()
        .unwrap();
    assert!(output.status.success(), "Junction fixture failed");
    let state = scoped_state(root.path());
    assert!(state
        .access(&link.join("secret.txt").to_string_lossy(), true)
        .is_err());
    assert!(state.access(&link.to_string_lossy(), true).is_err());
    assert_eq!(
        fs::read_to_string(outside.path().join("secret.txt")).unwrap(),
        "secret"
    );
    fs::remove_dir(&link).unwrap();
}
use super::{
    copy_dir_all, copy_file_new, current_root, resolve_workspace_path, validate_copy_or_move_paths,
    WorkspaceState,
};
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_path(label: &str) -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before Unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "aurona-code-{label}-{}-{nonce}",
        std::process::id()
    ))
}

#[test]
fn copy_file_new_rejects_existing_destination_without_overwriting_it() {
    let root = temp_path("copy-file");
    fs::create_dir_all(&root).expect("create temp directory");
    let source = root.join("source.txt");
    let destination = root.join("destination.txt");
    fs::write(&source, "source").expect("write source");
    fs::write(&destination, "destination").expect("write destination");

    assert!(copy_file_new(&source, &destination).is_err());
    assert_eq!(
        fs::read_to_string(&destination).expect("read destination"),
        "destination"
    );

    fs::remove_dir_all(root).expect("remove temp directory");
}

#[test]
fn copy_dir_all_rejects_existing_destination_directory() {
    let root = temp_path("copy-directory");
    let source = root.join("source");
    let destination = root.join("destination");
    fs::create_dir_all(&source).expect("create source directory");
    fs::write(source.join("file.txt"), "source").expect("write source file");
    fs::create_dir_all(&destination).expect("create destination directory");
    fs::write(destination.join("file.txt"), "destination").expect("write destination file");

    assert!(copy_dir_all(&root, &source, &destination).is_err());
    assert_eq!(
        fs::read_to_string(destination.join("file.txt")).expect("read destination file"),
        "destination"
    );

    fs::remove_dir_all(root).expect("remove temp directory");
}

#[test]
fn workspace_validation_accepts_legitimate_names_containing_two_dots() {
    let root = temp_path("workspace-valid");
    let source = root.join("source..txt");
    let destination = root.join("destination..txt");
    fs::create_dir_all(&root).expect("create workspace");
    fs::write(&source, "source").expect("write source");

    let validated = validate_copy_or_move_paths(
        root.to_string_lossy().as_ref(),
        source.to_string_lossy().as_ref(),
        destination.to_string_lossy().as_ref(),
    )
    .expect("paths inside workspace should be accepted");

    assert_eq!(
        validated.1,
        source.canonicalize().expect("canonical source")
    );
    assert_eq!(
        validated.2,
        root.canonicalize()
            .expect("canonical workspace")
            .join("destination..txt")
    );
    fs::remove_dir_all(root).expect("remove temp directory");
}

#[test]
fn workspace_validation_rejects_source_outside_workspace() {
    let root = temp_path("workspace-source-root");
    let outside = temp_path("workspace-source-outside");
    let source = outside.join("source.txt");
    fs::create_dir_all(&root).expect("create workspace");
    fs::create_dir_all(&outside).expect("create outside directory");
    fs::write(&source, "source").expect("write source");

    let error = validate_copy_or_move_paths(
        root.to_string_lossy().as_ref(),
        source.to_string_lossy().as_ref(),
        root.join("destination.txt").to_string_lossy().as_ref(),
    )
    .expect_err("outside source should be rejected");

    assert!(error.contains("outside the active workspace"));
    fs::remove_dir_all(root).expect("remove workspace");
    fs::remove_dir_all(outside).expect("remove outside directory");
}

#[test]
fn workspace_validation_rejects_destination_outside_workspace() {
    let root = temp_path("workspace-destination-root");
    let outside = temp_path("workspace-destination-outside");
    let source = root.join("source.txt");
    fs::create_dir_all(&root).expect("create workspace");
    fs::create_dir_all(&outside).expect("create outside directory");
    fs::write(&source, "source").expect("write source");

    let error = validate_copy_or_move_paths(
        root.to_string_lossy().as_ref(),
        source.to_string_lossy().as_ref(),
        outside.join("destination.txt").to_string_lossy().as_ref(),
    )
    .expect_err("outside destination should be rejected");

    assert!(error.contains("outside the active workspace"));
    fs::remove_dir_all(root).expect("remove workspace");
    fs::remove_dir_all(outside).expect("remove outside directory");
}

#[test]
fn workspace_validation_rejects_copying_directory_into_itself() {
    let root = temp_path("workspace-recursive-copy");
    let source = root.join("source");
    fs::create_dir_all(&source).expect("create source directory");

    let error = validate_copy_or_move_paths(
        root.to_string_lossy().as_ref(),
        source.to_string_lossy().as_ref(),
        source.join("nested-copy").to_string_lossy().as_ref(),
    )
    .expect_err("recursive copy should be rejected");

    assert!(error.contains("into itself"));
    fs::remove_dir_all(root).expect("remove workspace");
}

#[test]
fn workspace_session_rejects_paths_outside_the_authorized_root() {
    let root = temp_path("session-root");
    let outside = temp_path("session-outside");
    fs::create_dir_all(&root).expect("create workspace");
    fs::create_dir_all(&outside).expect("create outside directory");
    fs::write(root.join("inside.txt"), "inside").expect("write inside file");
    fs::write(outside.join("outside.txt"), "outside").expect("write outside file");

    let state = WorkspaceState::new();
    let authorized = root.canonicalize().expect("workspace should canonicalize");
    *state.root.lock().expect("lock workspace root") = Some(authorized.clone());

    assert_eq!(current_root(&state).expect("root is set"), authorized);
    assert!(
        resolve_workspace_path(&authorized, root.join("inside.txt").to_str().unwrap(), true)
            .is_ok()
    );
    let error = resolve_workspace_path(
        &authorized,
        outside.join("outside.txt").to_str().unwrap(),
        true,
    )
    .expect_err("outside path must be rejected");
    assert!(error.contains("活动工作区之外"));

    fs::remove_dir_all(root).expect("remove workspace");
    fs::remove_dir_all(outside).expect("remove outside directory");
}

#[test]
fn workspace_session_accepts_not_yet_existing_targets_inside_the_root() {
    let root = temp_path("session-create");
    fs::create_dir_all(&root).expect("create workspace");
    let authorized = root.canonicalize().expect("workspace should canonicalize");

    let target = authorized.join("nested").join("new-file.txt");
    let resolved = resolve_workspace_path(&authorized, target.to_str().unwrap(), false)
        .expect("new target inside workspace should resolve");
    assert!(resolved.starts_with(&authorized));

    let error = resolve_workspace_path(
        &authorized,
        authorized
            .parent()
            .expect("temp dir has a parent")
            .join("outside-new.txt")
            .to_str()
            .unwrap(),
        false,
    )
    .expect_err("new target outside workspace must be rejected");
    assert!(error.contains("活动工作区之外"));

    fs::remove_dir_all(root).expect("remove workspace");
}

#[test]
fn workspace_authorization_covers_root_and_dialog_confirmed_paths() {
    let root = temp_path("auth-root");
    let outside = temp_path("auth-outside");
    fs::create_dir_all(&root).expect("create workspace");
    fs::create_dir_all(&outside).expect("create outside directory");
    let inside_file = root.join("inside.txt");
    let outside_file = outside.join("outside.txt");
    fs::write(&inside_file, "in").expect("write inside file");
    fs::write(&outside_file, "out").expect("write outside file");

    let state = WorkspaceState::new();
    *state.root.lock().expect("lock workspace root") =
        Some(root.canonicalize().expect("workspace should canonicalize"));

    assert!(state
        .contains(inside_file.to_str().unwrap())
        .expect("inside path resolves"));
    assert!(!state
        .contains(outside_file.to_str().unwrap())
        .expect("outside path resolves"));
    assert!(state
        .is_path_authorized(inside_file.to_str().unwrap())
        .expect("inside file is authorized"));
    assert!(!state
        .is_path_authorized(outside_file.to_str().unwrap())
        .expect("outside file is not authorized"));

    state
        .authorize_path(outside_file.to_str().unwrap())
        .expect("dialog-confirmed path should authorize");
    assert!(state
        .is_path_authorized(outside_file.to_str().unwrap())
        .expect("dialog-confirmed file becomes authorized"));

    drop(state);
    fs::remove_dir_all(root).expect("remove workspace");
    fs::remove_dir_all(outside).expect("remove outside directory");
}
