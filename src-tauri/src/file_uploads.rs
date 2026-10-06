use crate::{commands::fs::WorkspaceState, scoped_file::StagedFile};
use std::{
    collections::HashMap,
    io::Write,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Manager, State};

struct Upload {
    stage: StagedFile,
    target: PathBuf,
    generation: u64,
    expected: usize,
    written: usize,
    touched: Instant,
}
#[derive(Default)]
pub struct FileUploadState(Mutex<HashMap<String, Upload>>);

impl FileUploadState {
    pub fn clear(&self) {
        if let Ok(mut entries) = self.0.lock() {
            entries.clear();
        }
    }
}

#[tauri::command]
pub fn fs_write_begin(
    app: tauri::AppHandle,
    state: State<FileUploadState>,
    path: String,
    size_bytes: usize,
) -> Result<String, String> {
    if size_bytes > crate::resource_limits::TEXT_BYTES {
        return Err("[resource.limit] Text exceeds 32 MiB".into());
    }
    let workspace = app.state::<WorkspaceState>();
    let generation = workspace.generation();
    let (directory, target) = workspace.write_access(&path)?;
    let stage = StagedFile::new(&directory)?;
    let mut entries = state
        .0
        .lock()
        .map_err(|_| "[file.upload] Registry unavailable")?;
    entries.retain(|_, entry| {
        entry.touched.elapsed() < Duration::from_secs(120) && entry.generation == generation
    });
    if entries.len() >= 8 {
        return Err("[resource.limit] File upload quota reached".into());
    }
    let id = format!("write-{:032x}", rand::random::<u128>());
    entries.insert(
        id.clone(),
        Upload {
            stage,
            target,
            generation,
            expected: size_bytes,
            written: 0,
            touched: Instant::now(),
        },
    );
    Ok(id)
}

#[tauri::command]
pub fn fs_write_chunk(
    workspace: State<WorkspaceState>,
    state: State<FileUploadState>,
    upload_id: String,
    offset: usize,
    contents: String,
) -> Result<(), String> {
    if contents.len() > crate::resource_limits::FILE_CHUNK_BYTES {
        return Err("[resource.limit] File chunk exceeds 256 KiB".into());
    }
    let mut entries = state
        .0
        .lock()
        .map_err(|_| "[file.upload] Registry unavailable")?;
    let entry = entries
        .get_mut(&upload_id)
        .ok_or("[file.upload] Missing or consumed write handle")?;
    if entry.generation != workspace.generation()
        || entry.touched.elapsed() >= Duration::from_secs(120)
    {
        entries.remove(&upload_id);
        return Err("[workspace.generation] Write handle expired".into());
    }
    if entry.written != offset || entry.written.saturating_add(contents.len()) > entry.expected {
        return Err("[file.upload] Out of order or oversized file chunk".into());
    }
    entry
        .stage
        .file
        .write_all(contents.as_bytes())
        .map_err(|e| e.to_string())?;
    entry.written += contents.len();
    entry.touched = Instant::now();
    Ok(())
}

#[tauri::command]
pub fn fs_write_commit(
    workspace: State<WorkspaceState>,
    state: State<FileUploadState>,
    upload_id: String,
) -> Result<(), String> {
    let entry = state
        .0
        .lock()
        .map_err(|_| "[file.upload] Registry unavailable")?
        .remove(&upload_id)
        .ok_or("[file.upload] Missing or consumed write handle")?;
    if entry.written != entry.expected || entry.touched.elapsed() >= Duration::from_secs(120) {
        return Err("[file.upload] Incomplete or expired write".into());
    }
    workspace.with_generation(entry.generation, || entry.stage.commit(&entry.target))
}

#[tauri::command]
pub fn fs_write_cancel(state: State<FileUploadState>, upload_id: String) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "[file.upload] Registry unavailable")?
        .remove(&upload_id);
    Ok(())
}
