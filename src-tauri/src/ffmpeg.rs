use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};
use tiny_http::{Header, ListenAddr, Response, Server, StatusCode};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VideoInfo {
    pub path: String,
    pub duration: f64,
    pub duration_formatted: String,
    pub filename: String,
    pub file_size: u64,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PreviewSource {
    pub kind: String,
    pub path: String,
}

struct HlsServerState {
    port: u16,
    dirs: Arc<Mutex<HashMap<String, std::path::PathBuf>>>,
    jobs: Arc<Mutex<HashMap<String, Instant>>>,
}

static HLS_SERVER: OnceLock<HlsServerState> = OnceLock::new();

fn ensure_hls_server() -> Result<&'static HlsServerState, String> {
    if let Some(server) = HLS_SERVER.get() {
        return Ok(server);
    }

    let server = Server::http("127.0.0.1:0")
        .map_err(|e| format!("Failed to start HLS server: {}", e))?;
    let port = match server.server_addr() {
        ListenAddr::IP(addr) => addr.port(),
        _ => return Err("Failed to determine HLS server port".to_string()),
    };

    let dirs = Arc::new(Mutex::new(HashMap::new()));
    let dirs_thread = dirs.clone();
    let jobs = Arc::new(Mutex::new(HashMap::new()));

    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            handle_hls_request(request, &dirs_thread);
        }
    });

    let state = HlsServerState { port, dirs, jobs };
    if HLS_SERVER.set(state).is_err() {
        return HLS_SERVER
            .get()
            .ok_or_else(|| "Failed to initialize HLS server".to_string());
    }

    HLS_SERVER
        .get()
        .ok_or_else(|| "Failed to initialize HLS server".to_string())
}

fn handle_hls_request(request: tiny_http::Request, dirs: &Arc<Mutex<HashMap<String, std::path::PathBuf>>>) {
    let url = request.url().to_string();
    let path = url.split('?').next().unwrap_or(&url);
    let parts = path.trim_start_matches('/').split('/').collect::<Vec<_>>();

    if parts.len() < 3 || parts[0] != "hls" {
        let response = Response::empty(StatusCode(404))
            .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap());
        let _ = request.respond(response);
        return;
    }

    let id = parts[1];
    let file_rel = parts[2..].join("/");
    if file_rel.contains("..") {
        let response = Response::empty(StatusCode(404))
            .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap());
        let _ = request.respond(response);
        return;
    }

    let dir = {
        let map = match dirs.lock() {
            Ok(m) => m,
            Err(_) => {
                let response = Response::empty(StatusCode(404))
                    .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap());
                let _ = request.respond(response);
                return;
            }
        };
        map.get(id).cloned()
    };

    let dir = match dir {
        Some(d) => d,
        None => {
            let response = Response::empty(StatusCode(404))
                .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap());
            let _ = request.respond(response);
            return;
        }
    };

    let file_path = dir.join(file_rel);
    let file = match std::fs::File::open(&file_path) {
        Ok(f) => f,
        Err(_) => {
            let response = Response::empty(StatusCode(404))
                .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap());
            let _ = request.respond(response);
            return;
        }
    };

    let extension = file_path.extension().and_then(|s| s.to_str());
    let content_type = match extension {
        Some("m3u8") => "application/vnd.apple.mpegurl",
        Some("ts") => "video/mp2t",
        Some("m4s") => "video/iso.segment",
        _ => "application/octet-stream",
    };

    let mut response = Response::from_file(file)
        .with_header(Header::from_bytes("Content-Type", content_type).unwrap())
        .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap());

    if matches!(extension, Some("m3u8")) {
        response = response.with_header(Header::from_bytes("Cache-Control", "no-store").unwrap());
    }
    let _ = request.respond(response);
}

fn register_hls_dir(id: &str, dir: &Path) -> Result<u16, String> {
    let server = ensure_hls_server()?;
    let mut map = server
        .dirs
        .lock()
        .map_err(|_| "Failed to lock HLS map".to_string())?;
    map.insert(id.to_string(), dir.to_path_buf());
    Ok(server.port)
}

fn playlist_has_segments(path: &Path) -> bool {
    let contents = match std::fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(_) => return false,
    };

    contents.lines().any(|line| {
        let trimmed = line.trim();
        !trimmed.is_empty() && !trimmed.starts_with('#')
    })
}

pub async fn prepare_hls_source(
    app_handle: &AppHandle,
    input_path: &str,
    min_size_bytes: u64,
    segment_seconds: u64,
    start_seconds: Option<f64>,
    window_seconds: Option<u64>,
) -> Result<PreviewSource, String> {
    let metadata = std::fs::metadata(input_path)
        .map_err(|e| format!("Failed to read input metadata: {}", e))?;
    let file_size = metadata.len();

    if file_size < min_size_bytes {
        return Ok(PreviewSource {
            kind: "file".to_string(),
            path: input_path.to_string(),
        });
    }

    let segment_seconds = segment_seconds.max(2);
    let window_seconds = window_seconds.unwrap_or(600).max(segment_seconds * 3);
    let start_seconds = start_seconds.unwrap_or(0.0);
    let start_seconds = if start_seconds.is_finite() {
        start_seconds.max(0.0)
    } else {
        0.0
    };
    let aligned_start = (start_seconds / segment_seconds as f64).floor() * segment_seconds as f64;
    let aligned_start_key = (aligned_start * 1000.0).round() as u64;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    input_path.hash(&mut hasher);
    file_size.hash(&mut hasher);
    segment_seconds.hash(&mut hasher);
    window_seconds.hash(&mut hasher);
    aligned_start_key.hash(&mut hasher);
    if let Ok(modified) = metadata.modified() {
        if let Ok(duration) = modified.duration_since(SystemTime::UNIX_EPOCH) {
            duration.as_secs().hash(&mut hasher);
            duration.subsec_nanos().hash(&mut hasher);
        }
    }
    let hash = hasher.finish();

    let hls_dir = std::env::temp_dir()
        .join("video-splitter-hls")
        .join(format!("{hash}"));
    let playlist_path = hls_dir.join("index.m3u8");
    let hls_id = format!("{hash}");

    if playlist_path.exists() && playlist_has_segments(&playlist_path) {
        let port = register_hls_dir(&hls_id, &hls_dir)?;
        return Ok(PreviewSource {
            kind: "hls".to_string(),
            path: format!("http://127.0.0.1:{port}/hls/{hls_id}/index.m3u8"),
        });
    }

    std::fs::create_dir_all(&hls_dir)
        .map_err(|e| format!("Failed to create HLS dir: {}", e))?;

    let server = ensure_hls_server()?;
    let spawn_needed = {
        let mut jobs = server
            .jobs
            .lock()
            .map_err(|_| "Failed to lock HLS job map".to_string())?;
        match jobs.get(&hls_id) {
            Some(started) if started.elapsed() < Duration::from_secs(30) => false,
            _ => {
                jobs.insert(hls_id.clone(), Instant::now());
                true
            }
        }
    };

    if spawn_needed {
        let force_key_frames = format!("expr:gte(t,n_forced*{segment_seconds})");
        let aligned_start_str = format!("{:.3}", aligned_start);

        let mut args: Vec<String> = Vec::new();
        args.extend([
            "-y".to_string(),
            "-ss".to_string(),
            aligned_start_str,
            "-i".to_string(),
            input_path.to_string(),
            "-t".to_string(),
            window_seconds.to_string(),
            "-map".to_string(),
            "0:v:0?".to_string(),
            "-map".to_string(),
            "0:a:0?".to_string(),
        ]);
        args.extend([
            "-c:v".to_string(),
            "libx264".to_string(),
            "-preset".to_string(),
            "veryfast".to_string(),
            "-crf".to_string(),
            "23".to_string(),
            "-force_key_frames".to_string(),
            force_key_frames,
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "128k".to_string(),
            "-hls_time".to_string(),
            segment_seconds.to_string(),
            "-hls_list_size".to_string(),
            "0".to_string(),
            "-hls_playlist_type".to_string(),
            "event".to_string(),
            "-hls_flags".to_string(),
            "independent_segments".to_string(),
            "-hls_segment_filename".to_string(),
            "segment_%05d.ts".to_string(),
            "index.m3u8".to_string(),
        ]);

        let _ = app_handle
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| format!("Failed to locate ffmpeg sidecar: {}", e))?
            .current_dir(&hls_dir)
            .args(args)
            .spawn()
            .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;
    }

    let start = Instant::now();
    loop {
        if playlist_path.exists() && playlist_has_segments(&playlist_path) {
            break;
        }

        if start.elapsed() > Duration::from_secs(30) {
            if let Ok(mut jobs) = server.jobs.lock() {
                jobs.remove(&hls_id);
            }
            return Err("HLS 分片生成超时，请重试".to_string());
        }

        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    if let Ok(mut jobs) = server.jobs.lock() {
        jobs.remove(&hls_id);
    }

    let port = register_hls_dir(&hls_id, &hls_dir)?;

    Ok(PreviewSource {
        kind: "hls".to_string(),
        path: format!("http://127.0.0.1:{port}/hls/{hls_id}/index.m3u8"),
    })
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
