// 声明 Windows 子系统为 GUI，防止启动时弹出 CMD 控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    aurona_code_lib::run();
}
