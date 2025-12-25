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

/// Helper to find executable in common paths (multi-platform)
pub fn find_executable(name: &str) -> Option<String> {
    // Platform-specific common paths
    #[cfg(target_os = "macos")]
    let common_paths = vec![
        format!("/opt/homebrew/bin/{}", name),
        format!("/usr/local/bin/{}", name),
        format!("/usr/bin/{}", name),
    ];
    
    #[cfg(target_os = "linux")]
    let common_paths = vec![
        format!("/usr/bin/{}", name),
        format!("/usr/local/bin/{}", name),
        format!("/snap/bin/{}", name),
    ];
    
    #[cfg(target_os = "windows")]
    let common_paths = vec![
        format!("C:\\Program Files\\ffmpeg\\bin\\{}.exe", name),
        format!("C:\\ffmpeg\\bin\\{}.exe", name),
        format!("C:\\Program Files (x86)\\ffmpeg\\bin\\{}.exe", name),
    ];
    
    // Check common paths first
    for path in &common_paths {
        if std::path::Path::new(&path).exists() {
            return Some(path.clone());
        }
    }
    
    // Try to find in PATH using "which" (Unix) or "where" (Windows)
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(output) = Command::new("which").arg(name).output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() && std::path::Path::new(&path).exists() {
                    return Some(path);
                }
            }
        }
    }
    
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = Command::new("where").arg(name).output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !path.is_empty() && std::path::Path::new(&path).exists() {
                    return Some(path);
                }
            }
        }
    }
    
    None
}

/// Get executable path, fallback to name if not found
fn get_executable(name: &str) -> String {
    find_executable(name).unwrap_or_else(|| name.to_string())
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

/// Get OS information string
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

/// Check if ffmpeg and ffprobe are installed
pub fn check_ffmpeg() -> FFmpegStatus {
    let ffmpeg_path = find_executable("ffmpeg");
    let ffprobe_path = find_executable("ffprobe");
    let os_info = get_os_info();
    
    if ffmpeg_path.is_none() || ffprobe_path.is_none() {
        return FFmpegStatus {
            found: false,
            ffmpeg_path,
            ffprobe_path,
            version: None,
            os_info,
            error: Some("FFmpeg 未安装或未找到。请安装 FFmpeg 后重试。".to_string()),
        };
    }
    
    // Try to get version
    let version = if let Some(ref path) = ffmpeg_path {
        Command::new(path)
            .arg("-version")
            .output()
            .ok()
            .and_then(|output| {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    stdout.lines().next().map(|s| s.to_string())
                } else {
                    None
                }
            })
    } else {
        None
    };
    
    FFmpegStatus {
        found: true,
        ffmpeg_path,
        ffprobe_path,
        version,
        os_info,
        error: None,
    }
}

/// Get video duration using FFmpeg
pub fn get_video_duration(path: &str) -> Result<f64, String> {
    let ffprobe_cmd = get_executable("ffprobe");
    let output = Command::new(&ffprobe_cmd)
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .map_err(|e| format!("Failed to run {}: {}", ffprobe_cmd, e))?;

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

/// Split video into segments using FFmpeg segment muxer
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

    // Emit initial progress
    let progress = SplitProgress {
        current_segment: 0,
        total_segments,
        percentage: 0.0,
        current_file: "正在切分...".to_string(),
    };
    let _ = app_handle.emit("split-progress", &progress);

    // Output pattern for segment files
    let output_pattern = format!("{}/{}_%03d.{}", output_dir, stem, extension);

    // Use FFmpeg segment muxer for reliable splitting
    // -segment_time: duration of each segment
    // -reset_timestamps 1: reset timestamps for each segment (prevents black frames)
    // -map 0: include all streams
    // -c copy: no re-encoding
    // -break_non_keyframes 0: only break on keyframes (prevents corrupted segments)
    let ffmpeg_cmd = get_executable("ffmpeg");
    let output = Command::new(&ffmpeg_cmd)
        .args([
            "-y",
            "-i", input_path,
            "-c", "copy",
            "-map", "0",
            "-f", "segment",
            "-segment_time", &segment_duration.to_string(),
            "-reset_timestamps", "1",
            "-break_non_keyframes", "0",
            &output_pattern,
        ])
        .output()
        .map_err(|e| format!("Failed to run {}: {}", ffmpeg_cmd, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Check if any files were created
        let first_file = format!("{}/{}_{:03}.{}", output_dir, stem, 0, extension);
        if !std::path::Path::new(&first_file).exists() {
            return Err(format!("FFmpeg failed: {}", stderr));
        }
    }

    // Collect output files
    let mut output_files = Vec::new();
    for i in 0..total_segments + 5 {  // Check a few extra in case of rounding
        let file_path = format!("{}/{}_{:03}.{}", output_dir, stem, i, extension);
        if std::path::Path::new(&file_path).exists() {
            output_files.push(file_path);
        } else {
            break;
        }
    }

    // Emit completion
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
