use crate::ffmpeg::{check_ffmpeg, format_duration, get_video_duration, split_video, split_video_by_ranges, FFmpegStatus, SplitResult, TimeRange, VideoInfo};
use tauri::AppHandle;

#[tauri::command]
pub async fn check_ffmpeg_command(app_handle: AppHandle) -> FFmpegStatus {
    check_ffmpeg(&app_handle).await
}

#[tauri::command]
pub async fn get_video_info(app_handle: AppHandle, path: String) -> Result<VideoInfo, String> {
    let duration = get_video_duration(&app_handle, &path).await?;
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

#[tauri::command]
pub async fn split_video_command(
    app_handle: AppHandle,
    input_path: String,
    output_dir: String,
    segment_duration: u32,
) -> Result<SplitResult, String> {
    split_video(&app_handle, &input_path, &output_dir, segment_duration).await
}

#[tauri::command]
pub async fn split_video_by_ranges_command(
    app_handle: AppHandle,
    input_path: String,
    output_dir: String,
    ranges: Vec<TimeRange>,
) -> Result<SplitResult, String> {
    split_video_by_ranges(&app_handle, &input_path, &output_dir, ranges).await
}

/// Select output directory (uses native dialog)
#[tauri::command]
pub async fn select_directory() -> Result<Option<String>, String> {
    // This will be handled by tauri-plugin-dialog on the frontend
    Ok(None)
}
