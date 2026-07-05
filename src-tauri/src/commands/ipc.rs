use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct IpcRequest {
    pub action: String,
    pub payload: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct IpcResponse {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn aurona_bridge(req: IpcRequest) -> IpcResponse {
    let result = match req.action.as_str() {
        "sys:ping" => Ok(serde_json::json!("pong")),
        // Migrated IPC routes will go here
        _ => Err(format!("Unknown IPC Action: {}", req.action)),
    };

    match result {
        Ok(data) => IpcResponse { success: true, data: Some(data), error: None },
        Err(err) => IpcResponse { success: false, data: None, error: Some(err) },
    }
}

#[tauri::command]
pub fn open_devtools(window: tauri::WebviewWindow) {
    #[cfg(any(debug_assertions, feature = "devtools"))]
    {
        window.open_devtools();
    }

    #[cfg(not(any(debug_assertions, feature = "devtools")))]
    {
        println!("[Aurona] DevTools requested in release build");
    }
}
