use crate::ffmpeg::{check_ffmpeg, format_duration, get_video_duration, split_video, FFmpegStatus, SplitResult, VideoInfo};
use tauri::AppHandle;

/// Check if FFmpeg is installed and get its path
#[tauri::command]
pub fn check_ffmpeg_command() -> FFmpegStatus {
    check_ffmpeg()
}

/// Get video information including duration
#[tauri::command]
pub fn get_video_info(path: String) -> Result<VideoInfo, String> {
    let duration = get_video_duration(&path)?;
    let duration_formatted = format_duration(duration);

    let filename = std::path::Path::new(&path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(VideoInfo {
        path,
        duration,
        duration_formatted,
        filename,
    })
}

/// Split video by specified duration (in seconds)
#[tauri::command]
pub async fn split_video_command(
    app_handle: AppHandle,
    input_path: String,
    output_dir: String,
    segment_duration: u32,
) -> Result<SplitResult, String> {
    // Run in blocking thread to avoid blocking async runtime
    tokio::task::spawn_blocking(move || {
        split_video(&app_handle, &input_path, &output_dir, segment_duration)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Select output directory (uses native dialog)
#[tauri::command]
pub async fn select_directory() -> Result<Option<String>, String> {
    // This will be handled by tauri-plugin-dialog on the frontend
    Ok(None)
}
