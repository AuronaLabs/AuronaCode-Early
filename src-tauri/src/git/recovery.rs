//! Nondestructive discard snapshots and resumable restoration.
use super::*;

pub(super) fn discard_fingerprint(
    workspace: &WorkspaceState,
    path: &str,
) -> Result<(String, usize), String> {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    let status = git_status_internal(path.to_string())?;
    if status.len() > 10_000 {
        return Err("[resource.limit] Git recovery change count exceeds limit".into());
    }
    for args in [
        &["status", "--porcelain=v1", "-z", "-uall"][..],
        &["diff", "--binary", "--no-ext-diff", "--no-textconv"],
        &[
            "diff",
            "--cached",
            "--binary",
            "--no-ext-diff",
            "--no-textconv",
        ],
    ] {
        let output = git_output(path, args)?;
        if !output.status.success() {
            return Err(command_error(&output));
        }
        hash.update(output.stdout);
    }
    for file in &status {
        validate_file_argument(&file.path)?;
        hash.update(file.path.as_bytes());
        let target = Path::new(path).join(&file.path);
        if target.try_exists().map_err(|e| e.to_string())? {
            hash.update(
                workspace
                    .content_digest(&target.to_string_lossy())?
                    .as_bytes(),
            );
        } else {
            hash.update(b"deleted");
        }
    }
    Ok((format!("{:x}", hash.finalize()), status.len()))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitRecovery {
    pub hash: String,
    pub created: String,
}

#[derive(Default)]
pub(super) struct RecoveryTree {
    files: std::collections::BTreeMap<String, (String, String)>,
    directories: std::collections::BTreeMap<String, RecoveryTree>,
}

pub(super) fn validate_recovery_path(path: &str) -> Result<(), String> {
    validate_file_argument(path)?;
    if Path::new(path).components().any(|part| {
        let name = part.as_os_str().to_string_lossy();
        name.eq_ignore_ascii_case(".git") || name.eq_ignore_ascii_case(".aurona-recovery")
    }) {
        return Err(
            "[git.recovery_protected] Recovery cannot modify repository or recovery storage".into(),
        );
    }
    Ok(())
}

impl RecoveryTree {
    pub(super) fn insert(&mut self, path: &str, mode: String, hash: String) -> Result<(), String> {
        validate_file_argument(path)?;
        let mut node = self;
        let mut names = path.split('/').peekable();
        while let Some(name) = names.next() {
            if names.peek().is_none() {
                if node.directories.contains_key(name)
                    || node.files.insert(name.into(), (mode, hash)).is_some()
                {
                    return Err("[git.recovery] Conflicting recovery paths".into());
                }
                return Ok(());
            }
            if node.files.contains_key(name) {
                return Err("[git.recovery] Conflicting recovery paths".into());
            }
            node = node.directories.entry(name.into()).or_default();
        }
        Err("[git.recovery] Empty recovery path".into())
    }

    pub(super) fn persist(&self, repository: &str) -> Result<String, String> {
        let mut input = Vec::new();
        for (name, (mode, hash)) in &self.files {
            input.extend_from_slice(format!("{mode} blob {hash}\t{name}\0").as_bytes());
        }
        for (name, directory) in &self.directories {
            let hash = directory.persist(repository)?;
            input.extend_from_slice(format!("040000 tree {hash}\t{name}\0").as_bytes());
        }
        git_input(repository, &["mktree", "-z"], &input)
    }
}

pub(super) fn recovery_commit(
    path: &str,
    tree: &str,
    parents: &[&str],
    message: &str,
) -> Result<String, String> {
    let mut args = vec![
        "-c",
        "user.name=Aurona Recovery",
        "-c",
        "user.email=recovery@aurona.local",
        "-c",
        "commit.gpgsign=false",
        "commit-tree",
        tree,
    ];
    for parent in parents {
        args.extend(["-p", parent]);
    }
    git_input(path, &args, message.as_bytes())
}

pub(super) fn create_discard_recovery(
    path: &str,
    mut read_file: impl FnMut(&str) -> Result<(Vec<u8>, String), String>,
) -> Result<GitRecovery, String> {
    let records = git_value(
        path,
        &[
            "for-each-ref",
            "--format=%(refname)",
            "refs/aurona/recovery/",
        ],
    )?;
    if records.lines().count() >= 128 {
        return Err("[resource.limit] Git recovery record limit reached; preserve or remove old records first".into());
    }
    let head = git_value(path, &["rev-parse", "HEAD"])?;
    let tracked = git_value(path, &["stash", "create"])?;
    let (tree, index) = if tracked.is_empty() {
        let tree = git_value(path, &["rev-parse", "HEAD^{tree}"])?;
        let index = recovery_commit(path, &tree, &[&head], "Aurona recovery index")?;
        (tree, index)
    } else {
        (
            git_value(path, &["rev-parse", &format!("{tracked}^{{tree}}")])?,
            git_value(path, &["rev-parse", &format!("{tracked}^2")])?,
        )
    };
    let mut bytes = 0usize;
    let status = git_status_internal(path.to_owned())?;
    if status.len() > 10_000 {
        return Err("[resource.limit] Git recovery change count exceeds limit".into());
    }
    // Git porcelain emits one record per index/worktree side. Recovery stores
    // the final worktree bytes once per path, while retaining whether a path
    // is untracked for its separate parent tree.
    let mut changed_paths = std::collections::BTreeMap::<String, bool>::new();
    for file in &status {
        changed_paths
            .entry(file.path.clone())
            .and_modify(|untracked| *untracked |= file.is_untracked)
            .or_insert(file.is_untracked);
    }
    // A fourth parent preserves working-tree bytes independently of Git filters.
    let mut raw = RecoveryTree::default();
    let mut untracked = RecoveryTree::default();
    for (file_path, is_untracked) in &changed_paths {
        validate_recovery_path(file_path)?;
        let target = Path::new(path).join(file_path);
        match std::fs::symlink_metadata(&target) {
            Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            _ => return Err("[git.recovery] Linked or nested repository recovery is unsupported; working tree preserved".into()),
        }
        let (contents, mode) = read_file(file_path)?;
        if !matches!(mode.as_str(), "100644" | "100755") {
            return Err("[git.recovery] Unsupported raw file mode".into());
        }
        bytes = bytes
            .checked_add(contents.len())
            .ok_or("[resource.limit] Git recovery exceeds limit")?;
        if contents.len() > crate::resource_limits::TEXT_BYTES || bytes > 256 * 1024 * 1024 {
            return Err(
                "[resource.limit] Git recovery exceeds 32 MiB per file or 256 MiB total".into(),
            );
        }
        let hash = git_input(path, &["hash-object", "-w", "--stdin"], &contents)?;
        let saved_size = git_value(path, &["cat-file", "-s", &hash])?;
        if saved_size.parse::<usize>().ok() != Some(contents.len()) {
            return Err("[git.recovery] Untracked recovery object failed verification".into());
        }
        if *is_untracked {
            untracked.insert(file_path, mode.clone(), hash.clone())?;
        }
        raw.insert(file_path, mode, hash)?;
    }
    let untracked_tree = untracked.persist(path)?;
    let untracked_commit = recovery_commit(
        path,
        &untracked_tree,
        &[],
        "Aurona recovery untracked files",
    )?;
    let message = format!("Aurona 0.4.14 recovery {:032x}", rand::random::<u128>());
    let raw_tree = raw.persist(path)?;
    let raw_commit = recovery_commit(path, &raw_tree, &[], "Aurona recovery raw bytes v1")?;
    // Preserve worktree deletions independently of Git's filters. Comparing
    // HEAD with the worktree (without rename detection) yields both sides of
    // renames; only missing paths are recorded as tombstones.
    let deleted_output = git_output(
        path,
        &["diff", "HEAD", "--name-only", "--no-renames", "-z", "--"],
    )?;
    if !deleted_output.status.success() {
        return Err(command_error(&deleted_output));
    }
    let mut deleted = RecoveryTree::default();
    let empty_blob = git_input(path, &["hash-object", "-w", "--stdin"], &[])?;
    let mut deleted_paths = std::collections::BTreeSet::new();
    for entry in deleted_output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
    {
        let file =
            std::str::from_utf8(entry).map_err(|_| "[git.recovery] Non-UTF8 deleted path")?;
        validate_recovery_path(file)?;
        if std::fs::symlink_metadata(Path::new(path).join(file))
            .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
        {
            deleted_paths.insert(file.to_owned());
        }
    }
    for file in deleted_paths {
        deleted.insert(&file, "100644".into(), empty_blob.clone())?;
    }
    let deleted_tree = deleted.persist(path)?;
    let deleted_commit = recovery_commit(
        path,
        &deleted_tree,
        &[],
        "Aurona recovery worktree deletions v1",
    )?;
    let hash = recovery_commit(
        path,
        &tree,
        &[
            &head,
            &index,
            &untracked_commit,
            &raw_commit,
            &deleted_commit,
        ],
        &message,
    )?;
    git_value(path, &["fsck", "--no-reflogs", "--no-dangling", &hash])?;
    git_value(
        path,
        &["update-ref", &format!("refs/aurona/recovery/{hash}"), &hash],
    )?;
    let persisted = git_value(
        path,
        &["rev-parse", &format!("refs/aurona/recovery/{hash}")],
    )?;
    if persisted != hash {
        return Err("[git.recovery] Recovery ref failed verification".into());
    }
    Ok(GitRecovery {
        hash,
        created: git_value(path, &["show", "-s", "--format=%cI", &persisted])?,
    })
}

pub(super) fn read_recovery_file(
    workspace: &WorkspaceState,
    path: &str,
    file: &str,
) -> Result<(Vec<u8>, String), String> {
    use std::io::{Read, Seek};
    validate_file_argument(file)?;
    let (directory, name) = workspace.file_access(&Path::new(path).join(file).to_string_lossy())?;
    let mut handle = crate::scoped_file::open(&directory, &name).map_err(|e| e.to_string())?;
    let snapshot = crate::scoped_file::snapshot(&handle)?;
    handle.rewind().map_err(|e| e.to_string())?;
    let mut contents = Vec::new();
    handle
        .by_ref()
        .take(crate::resource_limits::TEXT_BYTES as u64 + 1)
        .read_to_end(&mut contents)
        .map_err(|e| e.to_string())?;
    if contents.len() > crate::resource_limits::TEXT_BYTES {
        return Err("[resource.limit] Git recovery file exceeds 32 MiB".into());
    }
    crate::scoped_file::verify_snapshot(&directory, &name, &snapshot)?;
    use sha2::{Digest, Sha256};
    if format!("{:x}:{}", Sha256::digest(&contents), contents.len()) != snapshot.fingerprint {
        return Err("[file.conflict] Untracked file changed while creating recovery".into());
    }
    #[cfg(unix)]
    let mode = {
        use cap_std::fs::MetadataExt;
        if handle.metadata().map_err(|e| e.to_string())?.mode() & 0o111 != 0 {
            "100755"
        } else {
            "100644"
        }
    };
    #[cfg(not(unix))]
    let mode = "100644";
    Ok((contents, mode.into()))
}

pub(super) fn list_discard_recoveries(path: &str) -> Result<Vec<GitRecovery>, String> {
    let output = git_value(
        path,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(objectname) %(committerdate:iso-strict)",
            "refs/aurona/recovery/",
        ],
    )?;
    if output.lines().count() > 128 {
        return Err("[resource.limit] Too many Git recovery records".into());
    }
    output
        .lines()
        .map(|line| {
            let (hash, created) = line
                .split_once(' ')
                .ok_or("[git.recovery] Invalid recovery record")?;
            Ok(GitRecovery {
                hash: hash.into(),
                created: created.into(),
            })
        })
        .collect()
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct GitRestoreJournal {
    schema_version: u32,
    recovery: String,
    head: String,
    index_before: String,
    index_after: String,
    files: std::collections::BTreeMap<String, (Option<String>, Option<String>)>,
}

pub(super) const RESTORE_JOURNAL: &str = "aurona-restore-journal.json";

pub(super) fn current_recovery_blob(
    workspace: &WorkspaceState,
    repository: &str,
    file: &str,
) -> Result<Option<String>, String> {
    validate_recovery_path(file)?;
    if !workspace.exists(&Path::new(repository).join(file).to_string_lossy())? {
        return Ok(None);
    }
    let (bytes, _) = read_recovery_file(workspace, repository, file)?;
    git_input(repository, &["hash-object", "--stdin"], &bytes).map(Some)
}

pub(super) fn restore_discard_recovery(
    workspace: &WorkspaceState,
    path: &str,
    hash: &str,
) -> Result<(), String> {
    restore_discard_recovery_with_hook(workspace, path, hash, |_| Ok(()))
}

pub(super) fn restore_discard_recovery_with_hook(
    workspace: &WorkspaceState,
    path: &str,
    hash: &str,
    mut before_operation: impl FnMut(usize) -> Result<(), String>,
) -> Result<(), String> {
    if !matches!(hash.len(), 40 | 64) || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("[git.recovery] Invalid recovery hash".into());
    }
    let git_directory = git_value(path, &["rev-parse", "--absolute-git-dir"])?;
    let storage = workspace.directory_handle(&git_directory)?;
    let journal = match crate::scoped_file::open(&storage, Path::new(RESTORE_JOURNAL)) {
        Ok(file) => {
            use std::io::Read;
            let mut bytes = Vec::new();
            file.take(4 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > 4 * 1024 * 1024 {
                return Err("[resource.limit] Git restore journal exceeds limit".into());
            }
            Some(
                serde_json::from_slice::<GitRestoreJournal>(&bytes).map_err(|_| {
                    "[git.recovery_journal] Invalid restore journal; preserve it for recovery"
                })?,
            )
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    if journal.is_none() && !git_status_internal(path.to_owned())?.is_empty() {
        return Err(
            "[git.recovery_conflict] Restore requires a clean working tree and index".into(),
        );
    }
    let head = git_value(path, &["rev-parse", "HEAD"])?;
    let record = git_value(
        path,
        &["rev-parse", &format!("refs/aurona/recovery/{hash}")],
    )?;
    if record != hash || head != git_value(path, &["rev-parse", &format!("{hash}^1")])? {
        return Err("[git.recovery_conflict] Recovery record or repository HEAD changed".into());
    }
    let raw_parent = git_output(path, &["rev-parse", "--verify", &format!("{hash}^4")])?;
    if !raw_parent.status.success() {
        return Err("[git.recovery_format] Recovery record has no raw-byte snapshot; working tree preserved".into());
    }
    let mut raw_files = Vec::new();
    let mut bytes = 0usize;
    if raw_parent.status.success() {
        let output = git_output(path, &["ls-tree", "-rz", &format!("{hash}^4")])?;
        if !output.status.success() {
            return Err(command_error(&output));
        }
        for entry in output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|entry| !entry.is_empty())
        {
            let entry =
                std::str::from_utf8(entry).map_err(|_| "[git.recovery] Non-UTF8 recovery path")?;
            let (header, file) = entry
                .split_once('\t')
                .ok_or("[git.recovery] Invalid raw entry")?;
            validate_recovery_path(file)?;
            let fields = header.split_whitespace().collect::<Vec<_>>();
            if fields.len() != 3 || !matches!(fields[0], "100644" | "100755") || fields[1] != "blob"
            {
                return Err("[git.recovery] Invalid raw entry type".into());
            }
            let size = git_value(path, &["cat-file", "-s", fields[2]])?
                .parse::<usize>()
                .map_err(|_| "[git.recovery] Invalid raw blob size")?;
            bytes = bytes
                .checked_add(size)
                .ok_or("[resource.limit] Recovery size overflow")?;
            if size > crate::resource_limits::TEXT_BYTES
                || bytes > 256 * 1024 * 1024
                || raw_files.len() >= 10_000
            {
                return Err("[resource.limit] Raw recovery exceeds limit".into());
            }
            workspace.exists(&Path::new(path).join(file).to_string_lossy())?;
            raw_files.push((
                file.to_owned(),
                fields[2].to_owned(),
                size,
                fields[0].to_owned(),
            ));
        }
    }
    let deleted_parent = git_output(path, &["rev-parse", "--verify", &format!("{hash}^5")])?;
    let mut deleted_files = Vec::new();
    if deleted_parent.status.success() {
        let output = git_output(path, &["ls-tree", "-rz", &format!("{hash}^5")])?;
        if !output.status.success() {
            return Err(command_error(&output));
        }
        for entry in output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|entry| !entry.is_empty())
        {
            let entry = std::str::from_utf8(entry)
                .map_err(|_| "[git.recovery] Non-UTF8 deleted recovery path")?;
            let (header, file) = entry
                .split_once('\t')
                .ok_or("[git.recovery] Invalid deleted entry")?;
            let fields = header.split_whitespace().collect::<Vec<_>>();
            if fields.len() != 3 || !matches!(fields[0], "100644" | "100755") || fields[1] != "blob"
            {
                return Err("[git.recovery] Invalid deleted entry type".into());
            }
            validate_recovery_path(file)?;
            if deleted_files.len() >= 10_000 {
                return Err("[resource.limit] Too many recovery deletions".into());
            }
            workspace.exists(&Path::new(path).join(file).to_string_lossy())?;
            deleted_files.push(file.to_owned());
        }
    }
    let index_tree = git_value(path, &["rev-parse", &format!("{hash}^2^{{tree}}")])?;
    let index_current = git_value(path, &["write-tree"])?;
    let mut targets = std::collections::BTreeMap::new();
    for (file, blob, _, _) in &raw_files {
        if targets.insert(file.clone(), Some(blob.clone())).is_some() {
            return Err("[git.recovery] Duplicate restore target".into());
        }
    }
    for file in &deleted_files {
        if targets.insert(file.clone(), None).is_some() {
            return Err("[git.recovery] Conflicting restore targets".into());
        }
    }
    if targets.len() > 10_000 {
        return Err("[resource.limit] Too many restore targets".into());
    }
    let journal = if let Some(journal) = journal {
        if journal.schema_version != 1
            || journal.recovery != hash
            || journal.head != head
            || journal.index_after != index_tree
            || journal.files.len() != targets.len()
            || targets.iter().any(|(file, after)| {
                journal
                    .files
                    .get(file)
                    .is_none_or(|(_, expected)| expected != after)
            })
        {
            return Err("[git.recovery_journal] Journal does not match this recovery; original data preserved".into());
        }
        if index_current != journal.index_before && index_current != journal.index_after {
            return Err("[git.recovery_conflict] Index changed after interrupted restore".into());
        }
        for change in git_status_internal(path.to_owned())? {
            if !targets.contains_key(&change.path) {
                return Err(
                    "[git.recovery_conflict] New changes exist outside the interrupted restore"
                        .into(),
                );
            }
        }
        for (file, (before, after)) in &journal.files {
            let current = current_recovery_blob(workspace, path, file)?;
            if current != *before && current != *after {
                return Err(format!(
                    "[git.recovery_conflict] {file} changed after interrupted restore"
                ));
            }
        }
        journal
    } else {
        let mut files = std::collections::BTreeMap::new();
        for (file, after) in &targets {
            files.insert(
                file.clone(),
                (current_recovery_blob(workspace, path, file)?, after.clone()),
            );
        }
        let journal = GitRestoreJournal {
            schema_version: 1,
            recovery: hash.into(),
            head,
            index_before: index_current,
            index_after: index_tree.clone(),
            files,
        };
        let bytes = serde_json::to_vec(&journal).map_err(|e| e.to_string())?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err("[resource.limit] Git restore journal exceeds limit".into());
        }
        crate::scoped_file::write(&storage, Path::new(RESTORE_JOURNAL), &bytes)?;
        journal
    };
    // The durable journal accepts only pre-restore or intended bytes on retry.
    // Persist it before changing the index so a crash in any file is resumable.
    before_operation(0)?;
    // The index snapshot is an ordinary tree commit. read-tree restores the
    // exact staged state without applying a filtered stash patch to the
    // worktree; raw files below restore exact on-disk bytes separately.
    git_value(path, &["read-tree", &index_tree])?;
    let mut completed = 1;
    for file in deleted_files {
        before_operation(completed)?;
        if run_cancelled() {
            return Err(format!(
                "[git.cancelled] Raw restore interrupted; recovery {hash} is preserved"
            ));
        }
        let target = Path::new(path).join(&file);
        let (before, after) = &journal.files[&file];
        let current = current_recovery_blob(workspace, path, &file)?;
        if current != *before && current != *after {
            return Err(format!(
                "[git.recovery_conflict] {file} changed during restore"
            ));
        }
        if !workspace.exists(&target.to_string_lossy())? {
            continue;
        }
        let (directory, name) = workspace.write_access(&target.to_string_lossy())?;
        directory.remove_file(&name).map_err(|error| {
            format!("[git.recovery] Could not restore deletion for {file}; recovery {hash} is preserved: {error}")
        })?;
        completed += 1;
    }
    for (file, blob, size, mode) in raw_files {
        before_operation(completed)?;
        if run_cancelled() {
            return Err(format!(
                "[git.cancelled] Raw restore interrupted; recovery {hash} is preserved"
            ));
        }
        let (before, after) = &journal.files[&file];
        let current = current_recovery_blob(workspace, path, &file)?;
        if current != *before && current != *after {
            return Err(format!(
                "[git.recovery_conflict] {file} changed during restore"
            ));
        }
        // Untracked directories may have disappeared during discard. Create
        // each ancestor through its scoped parent handle and reopen nofollow.
        if let Some(parent) = Path::new(&file).parent() {
            let mut target = Path::new(path).to_owned();
            for component in parent.components() {
                target.push(component.as_os_str());
                if !workspace.exists(&target.to_string_lossy())? {
                    let (directory, name) = workspace.write_access(&target.to_string_lossy())?;
                    match directory.create_dir(&name) {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                        Err(error) => return Err(error.to_string()),
                    }
                }
                let (directory, name) = workspace.write_access(&target.to_string_lossy())?;
                directory
                    .open_dir_nofollow(&name)
                    .map_err(|error| error.to_string())?;
            }
        }
        let (directory, name) =
            workspace.write_access(&Path::new(path).join(file).to_string_lossy())?;
        let stage = crate::scoped_file::StagedFile::new(&directory)?;
        let output = crate::process_service::capture_to_file(
            "git",
            &["cat-file", "blob", &blob],
            Path::new(path),
            stage.file.try_clone().map_err(|e| e.to_string())?,
            size,
            run_cancelled,
        )?;
        if !output.status.success() {
            return Err(command_error(&output));
        }
        #[cfg(unix)]
        {
            use cap_std::fs::PermissionsExt;
            stage
                .file
                .set_permissions(cap_std::fs::Permissions::from_mode(if mode == "100755" {
                    0o755
                } else {
                    0o644
                }))
                .map_err(|e| e.to_string())?;
        }
        #[cfg(not(unix))]
        let _ = mode;
        stage.commit(&name)?;
        completed += 1;
    }
    if git_value(path, &["write-tree"])? != journal.index_after {
        return Err(
            "[git.recovery_conflict] Index changed during restore; journal preserved".into(),
        );
    }
    for (file, (_, after)) in &journal.files {
        if current_recovery_blob(workspace, path, file)? != *after {
            return Err(format!(
                "[git.recovery_conflict] {file} changed during final restore verification"
            ));
        }
    }
    storage
        .remove_file(RESTORE_JOURNAL)
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    crate::scoped_file::sync_directory(&storage)?;
    Ok(())
}
