use super::*;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

struct TestRepository(PathBuf);

impl Drop for TestRepository {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn run_git(path: &Path, args: &[&str]) {
    let output = git_output(path.to_string_lossy().as_ref(), args).expect("git should start");
    assert!(output.status.success(), "{}", command_error(&output));
}

fn create_test_repository() -> TestRepository {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be valid")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("aurona-git-test-{suffix}"));
    fs::create_dir_all(&path).expect("temporary repository should be created");
    run_git(&path, &["init"]);
    run_git(&path, &["config", "user.email", "tests@aurona.local"]);
    run_git(&path, &["config", "user.name", "Aurona Tests"]);
    fs::write(path.join("main.txt"), "first\n").expect("fixture should be written");
    run_git(&path, &["add", "--", "main.txt"]);
    run_git(&path, &["commit", "-m", "initial"]);
    TestRepository(path)
}

#[test]
fn creates_switches_and_lists_branches() {
    let repository = create_test_repository();
    let path = repository.0.to_string_lossy().to_string();
    git_create_branch_internal(path.clone(), "feature/editor".to_string())
        .expect("branch should be created");
    let branches = git_branches_internal(path.clone()).expect("branches should be listed");
    assert!(branches
        .iter()
        .any(|branch| branch.name == "feature/editor" && branch.is_current));
    let original = branches
        .iter()
        .find(|branch| branch.name != "feature/editor")
        .expect("original branch should exist")
        .name
        .clone();
    git_switch_branch_internal(path, original).expect("original branch should be restored");
}

#[test]
fn reads_and_discards_a_worktree_diff() {
    let repository = create_test_repository();
    let path = repository.0.to_string_lossy().to_string();
    fs::write(repository.0.join("main.txt"), "first\nsecond\n").expect("fixture should be updated");
    let diff = git_worktree_diff_internal(path.clone(), "main.txt".to_string(), false)
        .expect("diff should load");
    assert!(diff.contains("+second"));
    git_discard_file_internal(path, "main.txt".to_string()).expect("change should be discarded");
    assert_eq!(
        fs::read_to_string(repository.0.join("main.txt"))
            .expect("fixture should remain")
            .replace("\r\n", "\n"),
        "first\n"
    );
}

#[test]
fn reads_and_discards_an_untracked_file() {
    let repository = create_test_repository();
    let path = repository.0.to_string_lossy().to_string();
    fs::write(repository.0.join("new.txt"), "untracked\n")
        .expect("untracked fixture should be written");
    let diff = git_worktree_diff_internal(path.clone(), "new.txt".to_string(), false)
        .expect("untracked diff should load");
    assert!(diff.contains("+untracked"));
    git_discard_file_internal(path, "new.txt".to_string())
        .expect("untracked file should be discarded");
    assert!(!repository.0.join("new.txt").exists());
}

#[test]
fn discard_backup_is_nondestructive_and_restores_index_worktree_and_untracked() {
    let repository = create_test_repository();
    let workspace = WorkspaceState::test_root(&repository.0);
    let path = repository.0.to_string_lossy().to_string();
    fs::write(repository.0.join("main.txt"), "staged\n").unwrap();
    run_git(&repository.0, &["add", "main.txt"]);
    fs::write(repository.0.join("main.txt"), "unstaged\n").unwrap();
    fs::create_dir(repository.0.join("nested")).unwrap();
    fs::write(repository.0.join("nested/new.txt"), "untracked\n").unwrap();
    fs::write(repository.0.join(".gitignore"), "ignored.txt\n").unwrap();
    fs::write(repository.0.join("ignored.txt"), "keep\n").unwrap();
    let before = git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap();
    let record = create_discard_recovery(&path, |file| {
        Ok((fs::read(repository.0.join(file)).unwrap(), "100644".into()))
    })
    .unwrap();
    assert_eq!(
        git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap(),
        before
    );
    assert_eq!(
        fs::read_to_string(repository.0.join("main.txt")).unwrap(),
        "unstaged\n"
    );
    assert!(restore_discard_recovery(&workspace, &path, &record.hash).is_err());
    run_git(
        &repository.0,
        &["-c", "core.autocrlf=false", "reset", "--hard", "HEAD"],
    );
    fs::remove_file(repository.0.join("nested/new.txt")).unwrap();
    fs::remove_file(repository.0.join(".gitignore")).unwrap();
    // Keep the ignore rule outside the worktree while checking the restore.
    fs::write(repository.0.join(".git/info/exclude"), "ignored.txt\n").unwrap();
    restore_discard_recovery(&workspace, &path, &record.hash).unwrap();
    assert_eq!(
        git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap(),
        before
    );
    assert_eq!(git_value(&path, &["show", ":main.txt"]).unwrap(), "staged");
    assert_eq!(
        fs::read_to_string(repository.0.join("main.txt"))
            .unwrap()
            .replace("\r\n", "\n"),
        "unstaged\n"
    );
    assert_eq!(
        fs::read_to_string(repository.0.join("nested/new.txt")).unwrap(),
        "untracked\n"
    );
    assert_eq!(
        fs::read_to_string(repository.0.join("ignored.txt")).unwrap(),
        "keep\n"
    );
    assert!(list_discard_recoveries(&path)
        .unwrap()
        .iter()
        .any(|item| item.hash == record.hash));
}

#[test]
fn initialization_uses_selected_directory_without_authorizing_its_parent_repository() {
    let repository = create_test_repository();
    let target = repository.0.join("nested-workspace");
    fs::create_dir(&target).unwrap();
    let target = target.canonicalize().unwrap();
    let workspace = WorkspaceState::test_root(&target);
    assert!(authorized_repository_root(&workspace, &target, false).is_err());
    assert_eq!(
        authorized_repository_root(&workspace, &target, true).unwrap(),
        target
    );
    git_init_internal(target.to_string_lossy().into_owned()).unwrap();
    assert_eq!(
        authorized_repository_root(&workspace, &target, false).unwrap(),
        target
    );
    assert!(workspace
        .require_directory(&repository.0.to_string_lossy())
        .is_err());
}

#[test]
fn incomplete_discard_backup_never_changes_the_worktree() {
    let repository = create_test_repository();
    let path = repository.0.to_string_lossy().to_string();
    fs::write(repository.0.join("main.txt"), "modified\n").unwrap();
    fs::write(repository.0.join("new.txt"), "untracked\n").unwrap();
    let before = git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap();
    assert!(create_discard_recovery(&path, |_| Err("disk full".into())).is_err());
    assert_eq!(
        git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap(),
        before
    );
    assert!(list_discard_recoveries(&path).unwrap().is_empty());
    assert_eq!(
        fs::read_to_string(repository.0.join("main.txt")).unwrap(),
        "modified\n"
    );
}

#[test]
fn filtered_and_normalized_tracked_files_restore_exact_raw_bytes() {
    let repository = create_test_repository();
    let workspace = WorkspaceState::test_root(&repository.0);
    let path = repository.0.to_string_lossy().to_string();
    fs::write(repository.0.join(".gitattributes"), "main.txt eol=crlf\n").unwrap();
    run_git(&repository.0, &["add", ".gitattributes"]);
    run_git(&repository.0, &["commit", "-m", "line ending fixture"]);
    fs::write(repository.0.join("main.txt"), "modified\r\n").unwrap();
    let before = git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap();
    let record = create_discard_recovery(&path, |file| {
        Ok((fs::read(repository.0.join(file)).unwrap(), "100644".into()))
    })
    .unwrap();
    assert_eq!(
        git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap(),
        before
    );
    assert_eq!(
        fs::read(repository.0.join("main.txt")).unwrap(),
        b"modified\r\n"
    );
    run_git(&repository.0, &["reset", "--hard", "HEAD"]);
    restore_discard_recovery(&workspace, &path, &record.hash).unwrap();
    assert_eq!(
        fs::read(repository.0.join("main.txt")).unwrap(),
        b"modified\r\n"
    );
    assert_eq!(
        git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap(),
        before
    );
    fs::remove_file(repository.0.join(".gitattributes")).unwrap();
    run_git(&repository.0, &["add", ".gitattributes"]);
    run_git(&repository.0, &["commit", "-m", "autocrlf fixture"]);
    run_git(&repository.0, &["config", "core.autocrlf", "true"]);
    let record = create_discard_recovery(&path, |file| {
        Ok((fs::read(repository.0.join(file)).unwrap(), "100644".into()))
    })
    .unwrap();
    run_git(&repository.0, &["reset", "--hard", "HEAD"]);
    restore_discard_recovery(&workspace, &path, &record.hash).unwrap();
    assert_eq!(
        fs::read(repository.0.join("main.txt")).unwrap(),
        b"modified\r\n"
    );
}

#[test]
fn raw_recovery_streams_large_binary_without_process_output_truncation() {
    let repository = create_test_repository();
    let workspace = WorkspaceState::test_root(&repository.0);
    let path = repository.0.to_string_lossy().to_string();
    let bytes = vec![0x81; 5 * 1024 * 1024];
    fs::write(repository.0.join("large.bin"), &bytes).unwrap();
    let record =
        create_discard_recovery(&path, |file| read_recovery_file(&workspace, &path, file)).unwrap();
    fs::remove_file(repository.0.join("large.bin")).unwrap();
    restore_discard_recovery(&workspace, &path, &record.hash).unwrap();
    assert_eq!(fs::read(repository.0.join("large.bin")).unwrap(), bytes);
}

#[test]
fn raw_recovery_restores_staged_renames_worktree_deletions_and_new_directories() {
    let repository = create_test_repository();
    let workspace = WorkspaceState::test_root(&repository.0);
    let path = repository.0.to_string_lossy().to_string();
    fs::write(repository.0.join("deleted.txt"), "delete me\n").unwrap();
    run_git(&repository.0, &["add", "deleted.txt"]);
    run_git(&repository.0, &["commit", "-m", "deletion fixture"]);
    run_git(&repository.0, &["mv", "main.txt", "renamed.txt"]);
    fs::remove_file(repository.0.join("deleted.txt")).unwrap();
    fs::create_dir_all(repository.0.join("new/nested")).unwrap();
    fs::write(repository.0.join("new/nested/bytes.bin"), b"new\0bytes").unwrap();
    let before = git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap();
    let record =
        create_discard_recovery(&path, |file| read_recovery_file(&workspace, &path, file)).unwrap();
    run_git(&repository.0, &["reset", "--hard", "HEAD"]);
    fs::remove_dir_all(repository.0.join("new")).unwrap();
    restore_discard_recovery(&workspace, &path, &record.hash).unwrap();
    assert!(!repository.0.join("main.txt").exists());
    assert!(!repository.0.join("deleted.txt").exists());
    assert_eq!(
        fs::read(repository.0.join("new/nested/bytes.bin")).unwrap(),
        b"new\0bytes"
    );
    assert_eq!(
        git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap(),
        before
    );
}

#[test]
fn interrupted_restore_resumes_after_reopening_workspace_at_every_operation() {
    for failure in 0..4 {
        let repository = create_test_repository();
        let path = repository.0.to_string_lossy().to_string();
        let workspace = WorkspaceState::test_root(&repository.0);
        fs::write(repository.0.join("deleted.txt"), "delete me\n").unwrap();
        run_git(&repository.0, &["add", "deleted.txt"]);
        run_git(&repository.0, &["commit", "-m", "restore fixture"]);
        fs::remove_file(repository.0.join("deleted.txt")).unwrap();
        fs::write(repository.0.join("main.txt"), "staged\n").unwrap();
        run_git(&repository.0, &["add", "main.txt"]);
        fs::write(repository.0.join("main.txt"), "raw after staged\r\n").unwrap();
        fs::write(repository.0.join("new.bin"), b"untracked\0bytes").unwrap();
        let before = git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap();
        let index_before = git_value(&path, &["write-tree"]).unwrap();
        let record =
            create_discard_recovery(&path, |file| read_recovery_file(&workspace, &path, file))
                .unwrap();
        run_git(&repository.0, &["reset", "--hard", "HEAD"]);
        fs::remove_file(repository.0.join("new.bin")).unwrap();
        let error =
            restore_discard_recovery_with_hook(&workspace, &path, &record.hash, |operation| {
                if operation == failure {
                    Err("injected interruption".into())
                } else {
                    Ok(())
                }
            })
            .unwrap_err();
        assert!(error.contains("injected interruption"), "{error}");
        assert!(repository.0.join(".git").join(RESTORE_JOURNAL).exists());
        drop(workspace);
        let reopened = WorkspaceState::test_root(&repository.0);
        restore_discard_recovery(&reopened, &path, &record.hash).unwrap();
        assert!(!repository.0.join(".git").join(RESTORE_JOURNAL).exists());
        assert!(!repository.0.join("deleted.txt").exists());
        assert_eq!(
            fs::read(repository.0.join("main.txt")).unwrap(),
            b"raw after staged\r\n"
        );
        assert_eq!(
            fs::read(repository.0.join("new.bin")).unwrap(),
            b"untracked\0bytes"
        );
        assert_eq!(git_value(&path, &["write-tree"]).unwrap(), index_before);
        assert_eq!(
            git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap(),
            before
        );
    }
}

#[test]
fn interrupted_restore_preserves_later_user_edits_and_corrupt_journals() {
    let repository = create_test_repository();
    let path = repository.0.to_string_lossy().to_string();
    let workspace = WorkspaceState::test_root(&repository.0);
    fs::write(repository.0.join("main.txt"), "recovered\n").unwrap();
    fs::write(repository.0.join("new.bin"), b"untracked\0bytes").unwrap();
    let record =
        create_discard_recovery(&path, |file| read_recovery_file(&workspace, &path, file)).unwrap();
    run_git(&repository.0, &["reset", "--hard", "HEAD"]);
    fs::remove_file(repository.0.join("new.bin")).unwrap();
    restore_discard_recovery_with_hook(&workspace, &path, &record.hash, |operation| {
        if operation == 2 {
            Err("injected interruption".into())
        } else {
            Ok(())
        }
    })
    .unwrap_err();
    fs::write(
        repository.0.join("main.txt"),
        "user changed after interruption\n",
    )
    .unwrap();
    let before_index = git_value(&path, &["write-tree"]).unwrap();
    let error = restore_discard_recovery(&workspace, &path, &record.hash).unwrap_err();
    assert!(error.contains("git.recovery_conflict"), "{error}");
    assert_eq!(
        fs::read(repository.0.join("main.txt")).unwrap(),
        b"user changed after interruption\n"
    );
    assert!(!repository.0.join("new.bin").exists());
    assert_eq!(git_value(&path, &["write-tree"]).unwrap(), before_index);
    let log = repository.0.join(".git").join(RESTORE_JOURNAL);
    fs::write(&log, b"{corrupt").unwrap();
    let error = restore_discard_recovery(&workspace, &path, &record.hash).unwrap_err();
    assert!(error.contains("git.recovery_journal"), "{error}");
    assert_eq!(fs::read(log).unwrap(), b"{corrupt");
    assert_eq!(
        fs::read(repository.0.join("main.txt")).unwrap(),
        b"user changed after interruption\n"
    );
}

#[test]
fn recovery_rejects_protected_paths_before_restoring_the_index() {
    let repository = create_test_repository();
    let workspace = WorkspaceState::test_root(&repository.0);
    let path = repository.0.to_string_lossy().to_string();
    let head = git_value(&path, &["rev-parse", "HEAD"]).unwrap();
    let head_tree = git_value(&path, &["rev-parse", "HEAD^{tree}"]).unwrap();
    let index = recovery_commit(&path, &head_tree, &[&head], "index").unwrap();
    let empty = RecoveryTree::default().persist(&path).unwrap();
    let untracked = recovery_commit(&path, &empty, &[], "untracked").unwrap();
    let deleted = recovery_commit(&path, &empty, &[], "deleted").unwrap();
    for protected in [".git/config", ".aurona-recovery/log"] {
        let blob = git_input(&path, &["hash-object", "-w", "--stdin"], b"malicious").unwrap();
        let mut raw = RecoveryTree::default();
        raw.insert(protected, "100644".into(), blob).unwrap();
        let raw_tree = raw.persist(&path).unwrap();
        let raw = recovery_commit(&path, &raw_tree, &[], "raw").unwrap();
        let record = recovery_commit(
            &path,
            &head_tree,
            &[&head, &index, &untracked, &raw, &deleted],
            "record",
        )
        .unwrap();
        git_value(
            &path,
            &[
                "update-ref",
                &format!("refs/aurona/recovery/{record}"),
                &record,
            ],
        )
        .unwrap();
        let before = fs::read(repository.0.join(".git/index")).unwrap();
        let error = restore_discard_recovery(&workspace, &path, &record).unwrap_err();
        assert!(error.contains("git.recovery_protected"), "{error}");
        assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), before);
    }
}

#[test]
fn recovery_reads_use_the_scoped_snapshot_format_and_reject_unselected_files() {
    let repository = create_test_repository();
    let workspace = WorkspaceState::new();
    let file = repository.0.join("new.txt");
    fs::write(&file, b"untracked\0bytes\n").unwrap();
    assert!(read_recovery_file(&workspace, &repository.0.to_string_lossy(), "new.txt").is_err());
    workspace.authorize_path(&file.to_string_lossy()).unwrap();
    let (contents, mode) =
        read_recovery_file(&workspace, &repository.0.to_string_lossy(), "new.txt").unwrap();
    assert_eq!(contents, b"untracked\0bytes\n");
    assert_eq!(mode, "100644");
    assert!(read_recovery_file(&workspace, &repository.0.to_string_lossy(), "../new.txt").is_err());
}

#[test]
fn reports_the_destination_path_for_a_staged_rename() {
    let repository = create_test_repository();
    let path = repository.0.to_string_lossy().to_string();
    run_git(&repository.0, &["mv", "main.txt", "renamed.txt"]);

    let files = git_status_internal(path).expect("status should load");
    assert!(files
        .iter()
        .any(|file| { file.path == "renamed.txt" && file.status == "R" && file.is_staged }));
    assert!(!files.iter().any(|file| file.path == "main.txt"));
}

#[test]
fn distinguishes_missing_origin_from_broken_origin() {
    let repository = create_test_repository();
    let path = repository.0.to_string_lossy().to_string();
    assert_eq!(git_get_remote_internal(path.clone()).unwrap(), "");

    run_git(
        &repository.0,
        &["remote", "add", "origin", "https://example.com/repo.git"],
    );
    assert_eq!(
        git_get_remote_internal(path.clone()).unwrap(),
        "https://example.com/repo.git"
    );

    run_git(&repository.0, &["config", "--unset", "remote.origin.url"]);
    assert!(git_get_remote_internal(path).is_err());
}

#[test]
fn stages_and_unstages_one_hunk_without_touching_other_changes() {
    let repository = create_test_repository();
    let path = repository.0.to_string_lossy().to_string();
    let original = (1..=25)
        .map(|number| format!("line {number}\n"))
        .collect::<String>();
    fs::write(repository.0.join("main.txt"), &original).unwrap();
    run_git(&repository.0, &["add", "--", "main.txt"]);
    run_git(&repository.0, &["commit", "-m", "expand fixture"]);

    let changed = original
        .replace("line 3\n", "line 3 changed\n")
        .replace("line 20\n", "line 20 changed\n");
    fs::write(repository.0.join("main.txt"), changed).unwrap();

    let unstaged = git_worktree_diff_internal(path.clone(), "main.txt".into(), false).unwrap();
    assert_eq!(unstaged.matches("\n@@ -").count(), 2);
    git_apply_hunk_internal(path.clone(), "main.txt".into(), false, 0, unstaged.clone())
        .expect("first hunk should stage");

    let staged = git_worktree_diff_internal(path.clone(), "main.txt".into(), true).unwrap();
    assert!(staged.contains("+line 3 changed"));
    assert!(!staged.contains("+line 20 changed"));
    let remaining = git_worktree_diff_internal(path.clone(), "main.txt".into(), false).unwrap();
    assert!(!remaining.contains("+line 3 changed"));
    assert!(remaining.contains("+line 20 changed"));
    assert!(git_apply_hunk_internal(path.clone(), "main.txt".into(), false, 0, unstaged).is_err());

    git_apply_hunk_internal(path.clone(), "main.txt".into(), true, 0, staged)
        .expect("staged hunk should unstage");
    assert!(
        git_worktree_diff_internal(path.clone(), "main.txt".into(), true)
            .unwrap()
            .is_empty()
    );
    let restored = git_worktree_diff_internal(path, "main.txt".into(), false).unwrap();
    assert!(restored.contains("+line 3 changed"));
    assert!(restored.contains("+line 20 changed"));
}

#[test]
fn does_not_offer_partial_staging_for_new_files() {
    let repository = create_test_repository();
    let path = repository.0.to_string_lossy().to_string();
    fs::write(repository.0.join("new.txt"), "new file\n").unwrap();
    run_git(&repository.0, &["add", "--", "new.txt"]);
    let diff = git_worktree_diff_internal(path, "new.txt".into(), true).unwrap();
    assert!(selected_hunk_patch(&diff, 0).is_err());
}
