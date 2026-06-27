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

        walker.run(|| {
            let regex = regex.clone();
            let base_path = base_path.clone();
            let result_count = Arc::clone(&result_count);
            let app = app_clone.clone();

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
                    if let Ok(content) = std::fs::read_to_string(file_path) {
                        for (line_idx, line) in content.lines().enumerate() {
                            let current_count = result_count.load(Ordering::Relaxed);
                            if current_count >= max_results {
                                return ignore::WalkState::Quit;
                            }
                            
                            if regex.is_match(line) {
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
                                
                                let _ = app.emit("search-result", res);
                            }
                        }
                    }
                }
                ignore::WalkState::Continue
            })
        });
    })
    .await
    .map_err(|e| e.to_string())?;

    let _ = app.emit("search-done", ());

    Ok(())
}
