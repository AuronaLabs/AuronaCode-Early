use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub file_path: String,
    pub line_number: usize,
    pub match_text: String,
    pub index: usize,
}

#[tauri::command]
pub async fn search_workspace(
    path: String,
    query: String,
    is_case_sensitive: bool,
    is_regex: bool,
    app: AppHandle,
) -> Result<(), String> {
    if query.is_empty() {
        return Ok(());
    }

    let regex = if is_regex {
        RegexBuilder::new(&query)
            .case_insensitive(!is_case_sensitive)
            .build()
            .map_err(|e| e.to_string())?
    } else {
        let escaped = regex::escape(&query);
        RegexBuilder::new(&escaped)
            .case_insensitive(!is_case_sensitive)
            .build()
            .map_err(|e| e.to_string())?
    };

    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let mut builder = WalkBuilder::new(&path);
        builder.hidden(false);
        
        let walker = builder.build_parallel();
        let base_path = Path::new(&path).to_path_buf();
        let max_results = 500;
        let result_count = Arc::new(AtomicUsize::new(0));

        let (tx, rx) = std::sync::mpsc::channel();

        // Spawn a thread to receive and batch emit results
        let app_emitter = app_clone.clone();
        let batch_thread = std::thread::spawn(move || {
            let mut batch: Vec<SearchResult> = Vec::new();
            for res in rx {
                batch.push(res);
                if batch.len() >= 50 {
                    let _ = app_emitter.emit("search-result", &batch);
                    batch.clear();
                }
            }
            if !batch.is_empty() {
                let _ = app_emitter.emit("search-result", &batch);
            }
        });

        walker.run(|| {
            let regex = regex.clone();
            let base_path = base_path.clone();
            let result_count = Arc::clone(&result_count);
            let tx = tx.clone();

            Box::new(move |result| {
                if result_count.load(Ordering::Relaxed) >= max_results {
                    return ignore::WalkState::Quit;
                }

                let entry = match result {
                    Ok(e) => e,
                    Err(_) => return ignore::WalkState::Continue,
                };

                if entry.file_type().map_or(false, |ft| ft.is_file()) {
                    let file_path = entry.path();
                    
                    if let Ok(file) = std::fs::File::open(file_path) {
                        if let Ok(metadata) = file.metadata() {
                            // 忽略大于 2MB 的文件，避免内存爆炸
                            if metadata.len() > 2 * 1024 * 1024 {
                                return ignore::WalkState::Continue;
                            }
                        }

                        let reader = std::io::BufReader::new(file);
                        use std::io::BufRead;
                        for (line_idx, line_res) in reader.lines().enumerate() {
                            let line = match line_res {
                                Ok(l) => l,
                                Err(_) => break, // 遇到非 UTF-8 字符直接跳出
                            };

                            let current_count = result_count.load(Ordering::Relaxed);
                            if current_count >= max_results {
                                return ignore::WalkState::Quit;
                            }
                            
                            if regex.is_match(&line) {
                                let relative_path = file_path
                                    .strip_prefix(&base_path)
                                    .unwrap_or(file_path)
                                    .to_string_lossy()
                                    .to_string();
                                
                                let new_count = result_count.fetch_add(1, Ordering::Relaxed);
                                if new_count >= max_results {
                                    return ignore::WalkState::Quit;
                                }

                                let res = SearchResult {
                                    file_path: relative_path.replace("\\", "/"),
                                    line_number: line_idx + 1,
                                    match_text: line.trim().to_string(),
                                    index: new_count,
                                };
                                
                                let _ = tx.send(res);
                            }
                        }
                    }
                }
                ignore::WalkState::Continue
            })
        });

        drop(tx); // Close the channel so the receiver thread stops
        let _ = batch_thread.join();
    })
    .await
    .map_err(|e| e.to_string())?;

    let _ = app.emit("search-done", ());

    Ok(())
}
