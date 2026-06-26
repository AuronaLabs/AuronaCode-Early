use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::path::Path;

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
) -> Result<Vec<SearchResult>, String> {
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    let mut builder = WalkBuilder::new(&path);
    builder.hidden(false);

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

    let base_path = Path::new(&path);
    let max_results = 500; // Limit results

    for result in builder.build() {
        if results.len() >= max_results {
            break;
        }

        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };

        if entry.file_type().map_or(false, |ft| ft.is_file()) {
            let file_path = entry.path();
            if let Ok(content) = std::fs::read_to_string(file_path) {
                for (line_idx, line) in content.lines().enumerate() {
                    if results.len() >= max_results {
                        break;
                    }
                    if regex.is_match(line) {
                        let relative_path = file_path
                            .strip_prefix(base_path)
                            .unwrap_or(file_path)
                            .to_string_lossy()
                            .to_string();
                        
                        results.push(SearchResult {
                            file_path: relative_path.replace("\\", "/"),
                            line_number: line_idx + 1,
                            match_text: line.trim().to_string(),
                            index: results.len(),
                        });
                    }
                }
            }
        }
    }

    Ok(results)
}
