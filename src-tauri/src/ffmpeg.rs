use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VideoInfo {
    pub path: String,
    pub duration: f64,
    pub duration_formatted: String,
    pub filename: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SplitProgress {
    pub current_segment: u32,
    pub total_segments: u32,
    pub percentage: f64,
    pub current_file: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SplitResult {
    pub success: bool,
    pub output_files: Vec<String>,
    pub error: Option<String>,
}

/// Get video duration using FFmpeg
pub fn get_video_duration(path: &str) -> Result<f64, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }

    let duration_str = String::from_utf8_lossy(&output.stdout);
    duration_str
        .trim()
        .parse::<f64>()
        .map_err(|e| format!("Failed to parse duration: {}", e))
}

/// Format seconds to HH:MM:SS
pub fn format_duration(seconds: f64) -> String {
    let hours = (seconds / 3600.0).floor() as u32;
    let minutes = ((seconds % 3600.0) / 60.0).floor() as u32;
    let secs = (seconds % 60.0).floor() as u32;
    format!("{:02}:{:02}:{:02}", hours, minutes, secs)
}

/// Split video into segments
pub fn split_video(
    app_handle: &AppHandle,
    input_path: &str,
    output_dir: &str,
    segment_duration: u32,
) -> Result<SplitResult, String> {
    // Get video duration first
    let total_duration = get_video_duration(input_path)?;
    let total_segments = (total_duration / segment_duration as f64).ceil() as u32;

    // Extract filename without extension
    let path = std::path::Path::new(input_path);
    let stem = path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let extension = path.extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mp4");

    let mut output_files = Vec::new();

    for i in 0..total_segments {
        let start_time = i * segment_duration;
        let output_file = format!("{}/{}_{:03}.{}", output_dir, stem, i + 1, extension);

        // Emit progress event
        let progress = SplitProgress {
            current_segment: i + 1,
            total_segments,
            percentage: ((i + 1) as f64 / total_segments as f64) * 100.0,
            current_file: output_file.clone(),
        };
        let _ = app_handle.emit("split-progress", &progress);

        // Run FFmpeg to split segment
        let output = Command::new("ffmpeg")
            .args([
                "-y",  // Overwrite output
                "-i", input_path,
                "-ss", &start_time.to_string(),
                "-t", &segment_duration.to_string(),
                "-c", "copy",  // No re-encoding
                "-map", "0",
                "-avoid_negative_ts", "make_zero",
                &output_file,
            ])
            .output()
            .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // FFmpeg often writes warnings to stderr, check if file was created
            if !std::path::Path::new(&output_file).exists() {
                return Err(format!("FFmpeg failed for segment {}: {}", i + 1, stderr));
            }
        }

        output_files.push(output_file);
    }

    // Emit completion
    let final_progress = SplitProgress {
        current_segment: total_segments,
        total_segments,
        percentage: 100.0,
        current_file: "完成".to_string(),
    };
    let _ = app_handle.emit("split-progress", &final_progress);

    Ok(SplitResult {
        success: true,
        output_files,
        error: None,
    })
}
