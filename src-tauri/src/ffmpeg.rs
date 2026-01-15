use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;

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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FFmpegStatus {
    pub found: bool,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub version: Option<String>,
    pub os_info: String,
    pub error: Option<String>,
}

fn get_os_info() -> String {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    let os_name = match os {
        "macos" => "macOS",
        "linux" => "Linux",
        "windows" => "Windows",
        _ => os,
    };

    let arch_name = match arch {
        "x86_64" => "x64",
        "aarch64" => "ARM64",
        "x86" => "x86",
        _ => arch,
    };

    format!("{} ({})", os_name, arch_name)
}

pub async fn check_ffmpeg(app_handle: &AppHandle) -> FFmpegStatus {
    let os_info = get_os_info();
    let ffmpeg_sidecar = app_handle.shell().sidecar("ffmpeg");
    let ffprobe_sidecar = app_handle.shell().sidecar("ffprobe");

    if ffmpeg_sidecar.is_err() || ffprobe_sidecar.is_err() {
        return FFmpegStatus {
            found: false,
            ffmpeg_path: ffmpeg_sidecar.ok().map(|_| "sidecar:ffmpeg".to_string()),
            ffprobe_path: ffprobe_sidecar.ok().map(|_| "sidecar:ffprobe".to_string()),
            version: None,
            os_info,
            error: Some("内置 FFmpeg 未找到，请重新安装应用。".to_string()),
        };
    }

    let version = match app_handle.shell().sidecar("ffmpeg") {
        Ok(command) => match command.args(["-version"]).output().await {
            Ok(output) if output.status.success() => String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .map(|line| line.to_string()),
            _ => None,
        },
        Err(_) => None,
    };

    FFmpegStatus {
        found: true,
        ffmpeg_path: Some("sidecar:ffmpeg".to_string()),
        ffprobe_path: Some("sidecar:ffprobe".to_string()),
        version,
        os_info,
        error: None,
    }
}

pub async fn get_video_duration(app_handle: &AppHandle, path: &str) -> Result<f64, String> {
    let output = app_handle
        .shell()
        .sidecar("ffprobe")
        .map_err(|e| format!("Failed to locate ffprobe sidecar: {}", e))?
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .await
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

pub fn format_duration(seconds: f64) -> String {
    let hours = (seconds / 3600.0).floor() as u32;
    let minutes = ((seconds % 3600.0) / 60.0).floor() as u32;
    let secs = (seconds % 60.0).floor() as u32;
    format!("{:02}:{:02}:{:02}", hours, minutes, secs)
}

pub async fn split_video(
    app_handle: &AppHandle,
    input_path: &str,
    output_dir: &str,
    segment_duration: u32,
) -> Result<SplitResult, String> {
    let total_duration = get_video_duration(app_handle, input_path).await?;
    let total_segments = (total_duration / segment_duration as f64).ceil() as u32;

    let path = std::path::Path::new(input_path);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mp4");

    let progress = SplitProgress {
        current_segment: 0,
        total_segments,
        percentage: 0.0,
        current_file: "正在切分...".to_string(),
    };
    let _ = app_handle.emit("split-progress", &progress);

    let output_pattern = format!("{}/{}_%03d.{}", output_dir, stem, extension);

    let output = app_handle
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("Failed to locate ffmpeg sidecar: {}", e))?
        .args([
            "-y",
            "-i",
            input_path,
            "-c",
            "copy",
            "-map",
            "0",
            "-f",
            "segment",
            "-segment_time",
            &segment_duration.to_string(),
            "-reset_timestamps",
            "1",
            "-break_non_keyframes",
            "0",
            &output_pattern,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let first_file = format!("{}/{}_{:03}.{}", output_dir, stem, 0, extension);
        if !std::path::Path::new(&first_file).exists() {
            return Err(format!("FFmpeg failed: {}", stderr));
        }
    }

    let mut output_files = Vec::new();
    for i in 0..total_segments + 5 {
        let file_path = format!("{}/{}_{:03}.{}", output_dir, stem, i, extension);
        if std::path::Path::new(&file_path).exists() {
            output_files.push(file_path);
        } else {
            break;
        }
    }

    let final_progress = SplitProgress {
        current_segment: output_files.len() as u32,
        total_segments: output_files.len() as u32,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TimeRange {
    pub start_seconds: f64,
    pub end_seconds: f64,
}

pub async fn split_video_by_ranges(
    app_handle: &AppHandle,
    input_path: &str,
    output_dir: &str,
    ranges: Vec<TimeRange>,
) -> Result<SplitResult, String> {
    let path = std::path::Path::new(input_path);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mp4");

    let total_segments = ranges.len() as u32;
    let mut output_files = Vec::new();

    for (i, range) in ranges.iter().enumerate() {
        let progress = SplitProgress {
            current_segment: i as u32 + 1,
            total_segments,
            percentage: ((i as f64) / (total_segments as f64)) * 100.0,
            current_file: format!("正在切分片段 {}/{}...", i + 1, total_segments),
        };
        let _ = app_handle.emit("split-progress", &progress);

        let output_file = format!("{}/{}_{:03}.{}", output_dir, stem, i, extension);
        let start_time = format!("{:.3}", range.start_seconds);
        let end_time = format!("{:.3}", range.end_seconds);

        let output = app_handle
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| format!("Failed to locate ffmpeg sidecar: {}", e))?
            .args([
                "-y",
                "-i",
                input_path,
                "-ss",
                &start_time,
                "-to",
                &end_time,
                "-map",
                "0",
                "-c:v",
                "libx264",
                "-c:a",
                "aac",
                "-c:s",
                "copy",
                "-c:d",
                "copy",
                "-preset",
                "veryfast",
                "-crf",
                "18",
                "-reset_timestamps",
                "1",
                &output_file,
            ])
            .output()
            .await
            .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("FFmpeg failed on segment {}: {}", i + 1, stderr));
        }

        if std::path::Path::new(&output_file).exists() {
            output_files.push(output_file);
        }
    }

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
