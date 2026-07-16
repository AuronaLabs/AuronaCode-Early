use crate::search;
use ropey::Rope;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use sysinfo::System;
use tauri::{AppHandle, Manager, State};

const BASELINE_FILE: &str = "performance-baseline.json";
const SAMPLE_FILE_COUNT: usize = 320;
const SAMPLE_FILE_BYTES: usize = 4_096;
const SEARCH_FILE_COUNT: usize = 256;

pub struct PerformanceState {
    started_at: Instant,
    latest_startup: Mutex<Option<StartupMetrics>>,
}

impl PerformanceState {
    pub fn new() -> Self {
        Self {
            started_at: Instant::now(),
            latest_startup: Mutex::new(None),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupMetricsInput {
    pub frontend_bootstrap_ms: f64,
    pub main_interactive_ms: f64,
    pub splash_minimum_ms: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupMetrics {
    pub backend_to_main_ms: f64,
    pub frontend_bootstrap_ms: f64,
    pub main_interactive_ms: f64,
    pub splash_minimum_ms: f64,
    pub recorded_at_ms: u128,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceScale {
    pub path_open: bool,
    pub top_level_entries: Option<usize>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceEnvironment {
    pub app_version: String,
    pub operating_system: String,
    pub architecture: String,
    pub logical_cpu_cores: usize,
    pub available_memory_bytes: u64,
    pub run_mode: String,
    pub backend_status: String,
    pub workspace: WorkspaceScale,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceBenchmarkResult {
    pub id: String,
    pub name: String,
    pub duration_ns: u128,
    pub value: f64,
    pub unit: String,
    pub status: String,
    pub details: String,
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn temp_directory(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "aurona-performance-{label}-{}-{}",
        std::process::id(),
        now_millis()
    ))
}

fn benchmark_result(
    id: &str,
    name: &str,
    started: Instant,
    operations: usize,
    details: impl Into<String>,
) -> PerformanceBenchmarkResult {
    let duration = started.elapsed();
    let seconds = duration.as_secs_f64().max(f64::MIN_POSITIVE);
    PerformanceBenchmarkResult {
        id: id.to_string(),
        name: name.to_string(),
        duration_ns: duration.as_nanos(),
        value: operations as f64 / seconds,
        unit: "ops/s".to_string(),
        status: "ok".to_string(),
        details: details.into(),
    }
}

fn with_temporary_directory<T>(
    label: &str,
    work: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    let directory = temp_directory(label);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Unable to create benchmark directory: {error}"))?;
    let result = work(&directory);
    let cleanup = fs::remove_dir_all(&directory);
    match (result, cleanup) {
        (Ok(value), Ok(())) => Ok(value),
        (Ok(_), Err(error)) => Err(format!(
            "Benchmark completed but temporary cleanup failed: {error}"
        )),
        (Err(error), _) => Err(error),
    }
}

fn run_filesystem_benchmark() -> Result<Vec<PerformanceBenchmarkResult>, String> {
    with_temporary_directory("filesystem", |directory| {
        let content = "x".repeat(SAMPLE_FILE_BYTES);
        let mut results = Vec::new();

        let started = Instant::now();
        for index in 0..SAMPLE_FILE_COUNT {
            fs::write(directory.join(format!("sample-{index:03}.txt")), &content)
                .map_err(|error| format!("Unable to create benchmark file: {error}"))?;
        }
        results.push(benchmark_result(
            "filesystem-create",
            "小文件创建",
            started,
            SAMPLE_FILE_COUNT,
            format!("{SAMPLE_FILE_COUNT} 个临时文件，每个 {SAMPLE_FILE_BYTES} B"),
        ));

        let started = Instant::now();
        let mut total_bytes = 0_u64;
        for index in 0..SAMPLE_FILE_COUNT {
            let metadata = fs::metadata(directory.join(format!("sample-{index:03}.txt")))
                .map_err(|error| format!("Unable to read benchmark metadata: {error}"))?;
            total_bytes += metadata.len();
        }
        results.push(benchmark_result(
            "filesystem-metadata",
            "文件元数据读取",
            started,
            SAMPLE_FILE_COUNT,
            format!("读取 {SAMPLE_FILE_COUNT} 个文件的元数据，共 {total_bytes} B"),
        ));

        let started = Instant::now();
        for index in 0..SAMPLE_FILE_COUNT {
            let _ = fs::read_to_string(directory.join(format!("sample-{index:03}.txt")))
                .map_err(|error| format!("Unable to read benchmark file: {error}"))?;
        }
        results.push(benchmark_result(
            "filesystem-read",
            "小文件读取",
            started,
            SAMPLE_FILE_COUNT,
            "读取全部临时文件内容",
        ));

        let started = Instant::now();
        for index in 0..SAMPLE_FILE_COUNT {
            fs::write(
                directory.join(format!("sample-{index:03}.txt")),
                format!("{content}{index}"),
            )
            .map_err(|error| format!("Unable to write benchmark file: {error}"))?;
        }
        results.push(benchmark_result(
            "filesystem-write",
            "小文件写入",
            started,
            SAMPLE_FILE_COUNT,
            "覆写全部临时文件内容",
        ));

        let started = Instant::now();
        let entries = fs::read_dir(directory)
            .map_err(|error| format!("Unable to enumerate benchmark directory: {error}"))?
            .count();
        results.push(benchmark_result(
            "filesystem-enumerate",
            "目录遍历",
            started,
            entries,
            format!("Enumerated {entries} temporary files"),
        ));

        let started = Instant::now();
        for index in 0..SAMPLE_FILE_COUNT {
            fs::remove_file(directory.join(format!("sample-{index:03}.txt")))
                .map_err(|error| format!("Unable to delete benchmark file: {error}"))?;
        }
        results.push(benchmark_result(
            "filesystem-delete",
            "小文件删除",
            started,
            SAMPLE_FILE_COUNT,
            "删除全部临时文件",
        ));

        Ok(results)
    })
}

fn run_editor_benchmark() -> Vec<PerformanceBenchmarkResult> {
    let source = (0..12_000)
        .map(|index| format!("let value_{index} = {index};\n"))
        .collect::<String>();
    let mut results = Vec::new();

    let started = Instant::now();
    let mut rope = Rope::from_str(&source);
    results.push(benchmark_result(
        "editor-create",
        "文档创建",
        started,
        rope.len_lines(),
        format!("载入 {} 行源码样本", rope.len_lines()),
    ));

    let started = Instant::now();
    let insert_at = rope.len_chars() / 2;
    rope.insert(insert_at, "// Aurona benchmark insertion\n");
    results.push(benchmark_result(
        "editor-insert",
        "文本插入",
        started,
        1,
        "在 Rope 文档中部插入文本",
    ));

    let started = Instant::now();
    let line = rope.line(rope.len_lines() / 2).to_string();
    results.push(benchmark_result(
        "editor-read-line",
        "行读取",
        started,
        1,
        format!("读取中部一行的 {} 个字符", line.chars().count()),
    ));

    let started = Instant::now();
    let snapshot = rope.clone();
    results.push(benchmark_result(
        "editor-snapshot",
        "文档快照",
        started,
        snapshot.len_lines(),
        format!("复制 {} 行 Rope 文档快照", snapshot.len_lines()),
    ));

    let started = Instant::now();
    let mut offsets = Vec::with_capacity(500);
    for line_index in (100..600).rev() {
        offsets.push(rope.line_to_char(line_index));
    }
    for offset in offsets {
        rope.insert(offset, "// benchmark batch edit\n");
    }
    results.push(benchmark_result(
        "editor-batch-edit",
        "批量局部编辑",
        started,
        500,
        "执行 500 次非连续 Rope 局部插入",
    ));

    let started = Instant::now();
    let shifted_insert_at = insert_at + 500 * "// benchmark batch edit\n".chars().count();
    rope.remove(
        shifted_insert_at..shifted_insert_at + "// Aurona benchmark insertion\n".chars().count(),
    );
    results.push(benchmark_result(
        "editor-delete",
        "文本删除",
        started,
        1,
        "删除先前插入的 Rope 文本",
    ));

    let started = Instant::now();
    drop(rope);
    results.push(benchmark_result(
        "editor-release",
        "文档释放",
        started,
        1,
        "释放性能测试 Rope 文档",
    ));

    results
}

async fn run_search_benchmark() -> Result<Vec<PerformanceBenchmarkResult>, String> {
    let directory = temp_directory("search");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Unable to create search benchmark directory: {error}"))?;

    let result = async {
        for index in 0..SEARCH_FILE_COUNT {
            fs::write(
                directory.join(format!("aurona-search-{index:03}.txt")),
                format!(
                    "export const benchmark_{index} = {{ marker: 'Aurona benchmark marker', index: {index} }};\n// realistic search fixture\n"
                ),
            )
            .map_err(|error| format!("Unable to create search benchmark data: {error}"))?;
        }

        let started = Instant::now();
        let response = search::search_workspace(
            directory.to_string_lossy().to_string(),
            "Aurona benchmark marker".to_string(),
            false,
            false,
        )
        .await?;
        let duration = started.elapsed();
        Ok(vec![PerformanceBenchmarkResult {
            id: "search-content".to_string(),
            name: "多文件内容搜索".to_string(),
            duration_ns: duration.as_nanos(),
            value: response.results.len() as f64,
            unit: "matches".to_string(),
            status: "ok".to_string(),
            details: format!(
                "在 {SEARCH_FILE_COUNT} 个临时源码样本中找到 {} 处匹配",
                response.results.len(),
            ),
        }])
    }
    .await;

    let cleanup = fs::remove_dir_all(&directory);
    match (result, cleanup) {
        (Ok(value), Ok(())) => Ok(value),
        (Ok(_), Err(error)) => Err(format!(
            "Search benchmark completed but cleanup failed: {error}"
        )),
        (Err(error), _) => Err(error),
    }
}

#[tauri::command]
pub async fn get_performance_environment(
    app: AppHandle,
    workspace_path: Option<String>,
) -> Result<PerformanceEnvironment, String> {
    let app_version = app.package_info().version.to_string();
    tokio::task::spawn_blocking(move || {
        let mut system = System::new();
        system.refresh_memory();
        let workspace = workspace_path
            .as_deref()
            .map(PathBuf::from)
            .filter(|path| path.is_dir())
            .map(|path| WorkspaceScale {
                path_open: true,
                top_level_entries: fs::read_dir(path)
                    .ok()
                    .map(|entries| entries.take(10_000).count()),
            })
            .unwrap_or(WorkspaceScale {
                path_open: false,
                top_level_entries: None,
            });

        Ok(PerformanceEnvironment {
            app_version,
            operating_system: System::long_os_version()
                .unwrap_or_else(|| std::env::consts::OS.to_string()),
            architecture: std::env::consts::ARCH.to_string(),
            logical_cpu_cores: std::thread::available_parallelism()
                .map(|count| count.get())
                .unwrap_or(1),
            available_memory_bytes: system.available_memory(),
            run_mode: if cfg!(debug_assertions) {
                "development"
            } else {
                "release"
            }
            .to_string(),
            backend_status: "ready".to_string(),
            workspace,
        })
    })
    .await
    .map_err(|error| format!("Environment inspection task failed: {error}"))?
}

#[tauri::command]
pub async fn run_performance_benchmark(
    kind: String,
) -> Result<Vec<PerformanceBenchmarkResult>, String> {
    match kind.as_str() {
        "filesystem" => tokio::task::spawn_blocking(run_filesystem_benchmark)
            .await
            .map_err(|error| format!("Filesystem benchmark task failed: {error}"))?,
        "editor" => tokio::task::spawn_blocking(|| Ok(run_editor_benchmark()))
            .await
            .map_err(|error| format!("Editor benchmark task failed: {error}"))?,
        "search" => run_search_benchmark().await,
        _ => Err(format!("Unknown performance benchmark: {kind}")),
    }
}

#[tauri::command]
pub fn record_startup_metrics(
    state: State<PerformanceState>,
    input: StartupMetricsInput,
) -> Result<StartupMetrics, String> {
    let metrics = StartupMetrics {
        backend_to_main_ms: state.started_at.elapsed().as_secs_f64() * 1_000.0,
        frontend_bootstrap_ms: input.frontend_bootstrap_ms,
        main_interactive_ms: input.main_interactive_ms,
        splash_minimum_ms: input.splash_minimum_ms,
        recorded_at_ms: now_millis(),
    };
    let mut latest = state
        .latest_startup
        .lock()
        .map_err(|_| "Startup metrics state is unavailable".to_string())?;
    *latest = Some(metrics.clone());
    Ok(metrics)
}

#[tauri::command]
pub fn get_startup_metrics(
    state: State<PerformanceState>,
) -> Result<Option<StartupMetrics>, String> {
    state
        .latest_startup
        .lock()
        .map(|metrics| metrics.clone())
        .map_err(|_| "Startup metrics state is unavailable".to_string())
}

#[tauri::command]
pub async fn load_performance_baseline(
    app: AppHandle,
) -> Result<Option<serde_json::Value>, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to get app data directory: {error}"))?
        .join(BASELINE_FILE);
    tokio::task::spawn_blocking(move || {
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)
            .map_err(|error| format!("Unable to read performance baseline: {error}"))?;
        serde_json::from_str(&content)
            .map(Some)
            .map_err(|error| format!("Performance baseline is invalid: {error}"))
    })
    .await
    .map_err(|error| format!("Performance baseline read task failed: {error}"))?
}

#[tauri::command]
pub async fn save_performance_baseline(
    app: AppHandle,
    baseline: serde_json::Value,
) -> Result<(), String> {
    if !baseline.is_object() {
        return Err("Performance baseline must be a JSON object".to_string());
    }
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to get app data directory: {error}"))?
        .join(BASELINE_FILE);
    tokio::task::spawn_blocking(move || {
        let parent = path
            .parent()
            .ok_or_else(|| "Performance baseline path has no parent".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create app data directory: {error}"))?;
        let temporary = path.with_extension("json.tmp");
        let content = serde_json::to_vec_pretty(&baseline)
            .map_err(|error| format!("Unable to encode performance baseline: {error}"))?;
        fs::write(&temporary, content)
            .map_err(|error| format!("Unable to write temporary performance baseline: {error}"))?;
        fs::rename(&temporary, &path)
            .map_err(|error| format!("Unable to save performance baseline: {error}"))
    })
    .await
    .map_err(|error| format!("Performance baseline write task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{
        run_editor_benchmark, run_filesystem_benchmark, run_search_benchmark, SEARCH_FILE_COUNT,
    };

    #[test]
    fn filesystem_benchmark_is_bounded_and_returns_all_operations() {
        let results = run_filesystem_benchmark().expect("filesystem benchmark should complete");
        assert_eq!(results.len(), 6);
        assert!(results.iter().all(|result| result.status == "ok"));
    }

    #[test]
    fn editor_benchmark_exercises_all_rope_operations() {
        let results = run_editor_benchmark();
        assert_eq!(results.len(), 7);
        assert!(results.iter().all(|result| result.duration_ns > 0));
    }

    #[tokio::test]
    async fn search_benchmark_uses_the_real_search_command() {
        let results = run_search_benchmark()
            .await
            .expect("search benchmark should complete");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "search-content");
        assert_eq!(results[0].value, SEARCH_FILE_COUNT as f64);
    }
}
