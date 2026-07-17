use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;
use ts_rs::TS;

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct SearchResult {
    pub file_path: String,
    pub line_number: usize,
    pub match_text: String,
    pub index: usize,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub limit_reached: bool,
}

pub struct SearchState {
    requests: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl SearchState {
    pub fn new() -> Self {
        Self {
            requests: Mutex::new(HashMap::new()),
        }
    }
}

pub async fn search_workspace_internal(
    path: String,
    query: String,
    is_case_sensitive: bool,
    is_regex: bool,
    cancelled: Arc<AtomicBool>,
) -> Result<SearchResponse, String> {
    let root = PathBuf::from(&path)
        .canonicalize()
        .map_err(|error| format!("Unable to resolve search workspace: {error}"))?;
    if !root.is_dir() {
        return Err("Search workspace must be a directory".to_string());
    }

    if query.trim().is_empty() {
        return Ok(SearchResponse {
            results: Vec::new(),
            limit_reached: false,
        });
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

    tokio::task::spawn_blocking(move || {
        const MAX_RESULTS: usize = 500;

        let mut builder = WalkBuilder::new(&root);
        builder.hidden(false);

        let walker = builder.build_parallel();
        let base_path = root;
        let result_count = Arc::new(AtomicUsize::new(0));
        let limit_reached = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let results = Arc::new(std::sync::Mutex::new(Vec::new()));

        walker.run(|| {
            let regex = regex.clone();
            let base_path = base_path.clone();
            let result_count = Arc::clone(&result_count);
            let limit_reached = Arc::clone(&limit_reached);
            let results = Arc::clone(&results);
            let cancelled = Arc::clone(&cancelled);

            Box::new(move |result| {
                if cancelled.load(Ordering::Acquire) {
                    return ignore::WalkState::Quit;
                }
                if result_count.load(Ordering::Relaxed) >= MAX_RESULTS {
                    limit_reached.store(true, Ordering::Relaxed);
                    return ignore::WalkState::Quit;
                }

                let entry = match result {
                    Ok(e) => e,
                    Err(_) => return ignore::WalkState::Continue,
                };

                if entry.file_type().is_some_and(|ft| ft.is_file()) {
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
                            if cancelled.load(Ordering::Acquire) {
                                return ignore::WalkState::Quit;
                            }
                            let line = match line_res {
                                Ok(l) => l,
                                Err(_) => break, // 遇到非 UTF-8 字符直接跳出
                            };

                            if regex.is_match(&line) {
                                let relative_path = file_path
                                    .strip_prefix(&base_path)
                                    .unwrap_or(file_path)
                                    .to_string_lossy()
                                    .to_string();

                                let index = match result_count.fetch_update(
                                    Ordering::Relaxed,
                                    Ordering::Relaxed,
                                    |count| (count < MAX_RESULTS).then_some(count + 1),
                                ) {
                                    Ok(index) => index,
                                    Err(_) => {
                                        limit_reached.store(true, Ordering::Relaxed);
                                        return ignore::WalkState::Quit;
                                    }
                                };

                                let search_result = SearchResult {
                                    file_path: relative_path.replace("\\", "/"),
                                    line_number: line_idx + 1,
                                    match_text: line.trim().to_string(),
                                    index,
                                };

                                if let Ok(mut collected) = results.lock() {
                                    collected.push(search_result);
                                } else {
                                    return ignore::WalkState::Quit;
                                }
                            }
                        }
                    }
                }
                ignore::WalkState::Continue
            })
        });

        let mut results = results
            .lock()
            .map_err(|_| "Search result collection failed".to_string())?
            .clone();
        results.sort_by(|left, right| {
            left.file_path
                .cmp(&right.file_path)
                .then(left.line_number.cmp(&right.line_number))
        });

        Ok(SearchResponse {
            results,
            limit_reached: limit_reached.load(Ordering::Relaxed),
        })
    })
    .await
    .map_err(|error| format!("Search task failed: {error}"))?
}

#[tauri::command]
pub async fn search_workspace(
    path: String,
    query: String,
    is_case_sensitive: bool,
    is_regex: bool,
    request_id: String,
    state: State<'_, SearchState>,
) -> Result<SearchResponse, String> {
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut requests = state
            .requests
            .lock()
            .map_err(|_| "Search cancellation state is unavailable".to_string())?;
        requests.insert(request_id.clone(), cancelled.clone());
    }
    let result =
        search_workspace_internal(path, query, is_case_sensitive, is_regex, cancelled).await;
    if let Ok(mut requests) = state.requests.lock() {
        requests.remove(&request_id);
    }
    result
}

#[tauri::command]
pub fn cancel_search(request_id: String, state: State<'_, SearchState>) -> Result<bool, String> {
    let requests = state
        .requests
        .lock()
        .map_err(|_| "Search cancellation state is unavailable".to_string())?;
    if let Some(cancelled) = requests.get(&request_id) {
        cancelled.store(true, Ordering::Release);
        return Ok(true);
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::search_workspace_internal;
    use std::fs;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_workspace() -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after the Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("aurona-search-test-{unique}"))
    }

    #[tokio::test]
    async fn search_returns_sorted_results_and_reports_the_result_limit() {
        let workspace = temp_workspace();
        fs::create_dir_all(&workspace).expect("test workspace should be created");
        fs::write(workspace.join("z-last.txt"), "needle\n").expect("test file should be written");
        fs::write(workspace.join("a-first.txt"), "needle\n").expect("test file should be written");
        fs::write(
            workspace.join("limit.txt"),
            (0..501).map(|_| "needle\n").collect::<String>(),
        )
        .expect("test file should be written");

        let response = search_workspace_internal(
            workspace.to_string_lossy().to_string(),
            "needle".to_string(),
            false,
            false,
            Arc::new(AtomicBool::new(false)),
        )
        .await
        .expect("search should succeed");

        assert_eq!(response.results.len(), 500);
        assert!(response.limit_reached);
        assert!(response
            .results
            .windows(2)
            .all(|pair| pair[0].file_path <= pair[1].file_path));

        fs::remove_dir_all(workspace).expect("test workspace should be removed");
    }
}
