import { useState, useRef, useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import Hls from 'hls.js';
import { usePreviewSource } from '../hooks/usePreviewSource';

interface VideoPlayerProps {
    filePath: string;
    title?: string;
    fileSize?: number; // 文件大小（字节）
    totalDuration?: number; // 真实总时长（秒）
    onClose?: () => void;
    onTimeUpdate?: (time: number) => void;
    seekTo?: number | null;
}

const VideoPlayer = ({ filePath, title, fileSize, totalDuration, onClose, onTimeUpdate, seekTo }: VideoPlayerProps) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [hlsError, setHlsError] = useState<string | null>(null);
    const [retryToken, setRetryToken] = useState(0);
    const [windowStart, setWindowStart] = useState(0);
    const [pendingSeek, setPendingSeek] = useState<number | null>(null);
    const [queuedSeek, setQueuedSeek] = useState<number | null>(null);
    const [autoPlayAfterSeek, setAutoPlayAfterSeek] = useState(false);
    const [isScrubbing, setIsScrubbing] = useState(false);

    // 大文件阈值：500MB
    const LARGE_FILE_THRESHOLD = 500 * 1024 * 1024;
    const isLargeFile = fileSize && fileSize > LARGE_FILE_THRESHOLD;
    const HLS_MIN_SIZE = 200 * 1024 * 1024;
    const HLS_SEGMENT_SECONDS = 2;
    const HLS_WINDOW_SECONDS = 10 * 60;
    const HLS_WINDOW_PADDING = 0;

    const { source, isPreparing, prepareError } = usePreviewSource(filePath, {
        minSizeBytes: HLS_MIN_SIZE,
        segmentSeconds: HLS_SEGMENT_SECONDS,
        startSeconds: windowStart,
        windowSeconds: HLS_WINDOW_SECONDS,
        requestKey: retryToken,
    });

    useEffect(() => {
        setWindowStart(0);
        setPendingSeek(null);
        setQueuedSeek(null);
        setAutoPlayAfterSeek(false);
        setIsScrubbing(false);
        setCurrentTime(0);
    }, [filePath]);

    useEffect(() => {
        setError(null);
        setHlsError(null);
    }, [source?.kind, source?.path]);

    useEffect(() => {
        if (!source && prepareError) {
            setHlsError('HLS 分片生成失败');
            setIsLoading(false);
        }
    }, [prepareError, source]);

    const timelineDuration = totalDuration ?? duration;

    const clampTime = (time: number) => {
        if (timelineDuration > 0) {
            return Math.min(Math.max(time, 0), timelineDuration);
        }
        return Math.max(time, 0);
    };

    const computeWindowStart = (time: number) => {
        const padding = Math.min(HLS_WINDOW_PADDING, HLS_WINDOW_SECONDS / 2);
        const maxStart = timelineDuration > 0
            ? Math.max(0, timelineDuration - HLS_WINDOW_SECONDS)
            : Math.max(0, time - padding);
        const rawStart = Math.min(Math.max(time - padding, 0), maxStart);
        return Math.floor(rawStart / HLS_SEGMENT_SECONDS) * HLS_SEGMENT_SECONDS;
    };

    const applyPendingSeek = () => {
        if (pendingSeek === null || !videoRef.current) {
            return;
        }
        const target = clampTime(pendingSeek);
        const relative = source?.kind === 'hls' ? Math.max(0, target - windowStart) : target;
        videoRef.current.currentTime = relative;
        setCurrentTime(target);
        setPendingSeek(null);
    };

    const seekToAbsolute = (time: number) => {
        const target = clampTime(time);

        if (!source) {
            const nextStart = computeWindowStart(target);
            setWindowStart(nextStart);
            setPendingSeek(target);
            setCurrentTime(target);
            setIsLoading(true);
            return true;
        }

        if (source.kind === 'file') {
            if (videoRef.current) {
                videoRef.current.currentTime = target;
            }
            setCurrentTime(target);
            return false;
        }

        const windowEnd = windowStart + HLS_WINDOW_SECONDS;
        if (target >= windowStart && target <= windowEnd) {
            if (videoRef.current) {
                videoRef.current.currentTime = target - windowStart;
            }
            setCurrentTime(target);
            return false;
        }

        const nextStart = computeWindowStart(target);
        setWindowStart(nextStart);
        setPendingSeek(target);
        setCurrentTime(target);
        setIsLoading(true);
        return true;
    };

    useEffect(() => {
        if (seekTo !== null && seekTo !== undefined) {
            seekToAbsolute(seekTo);
        }
    }, [seekTo]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || isPreparing || !source) {
            return;
        }

        setHlsError(null);

        if (source.kind === 'file') {
            video.src = convertFileSrc(source.path);
            return;
        }

        const playlistUrl = source.path;
        const canPlayNative = video.canPlayType('application/vnd.apple.mpegurl') !== '';
        if (!Hls.isSupported()) {
            if (canPlayNative) {
                video.src = playlistUrl;
                video.load();
                return;
            }
            video.removeAttribute('src');
            video.load();
            setHlsError('当前平台不支持 HLS 播放');
            return;
        }

        video.removeAttribute('src');
        video.load();

        const hls = new Hls({
            maxBufferLength: 30,
            maxBufferSize: 60 * 1024 * 1024,
        });
        hls.loadSource(playlistUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) {
                const detail = data.details ? ` (${data.details})` : '';
                setHlsError(`HLS 播放失败: ${data.type}${detail}`);
                hls.destroy();
            }
        });

        return () => {
            hls.destroy();
        };
    }, [source?.kind, source?.path, isPreparing, retryToken, source]);

    useEffect(() => {
        if (videoRef.current && !isPreparing && source?.kind === 'file') {
            videoRef.current.load();
        }
    }, [source?.path, source?.kind, isPreparing]);

    const formatTime = (seconds: number) => {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        if (hrs > 0) {
            return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const formatFileSize = (bytes: number) => {
        if (bytes >= 1024 * 1024 * 1024) {
            return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        }
        if (bytes >= 1024 * 1024) {
            return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
        }
        return `${(bytes / 1024).toFixed(0)} KB`;
    };

    const togglePlay = () => {
        if (!videoRef.current) {
            return;
        }

        if (isPlaying) {
            videoRef.current.pause();
            return;
        }

        if (queuedSeek !== null) {
            const target = queuedSeek;
            setQueuedSeek(null);
            const deferred = seekToAbsolute(target);
            if (deferred) {
                setAutoPlayAfterSeek(true);
                return;
            }
        }

        if (isPreparing) {
            setAutoPlayAfterSeek(true);
            return;
        }

        videoRef.current.play().catch(err => {
            setError(`播放失败: ${err.message}`);
        });
    };

    const handleTimeUpdate = () => {
        if (isScrubbing) {
            return;
        }
        if (videoRef.current) {
            const time = videoRef.current.currentTime;
            const baseOffset = source?.kind === 'hls' ? windowStart : 0;
            const absoluteTime = baseOffset + time;
            setCurrentTime(absoluteTime);
            if (onTimeUpdate) {
                onTimeUpdate(absoluteTime);
            }
        }
    };

    const handleLoadedMetadata = () => {
        if (videoRef.current) {
            setDuration(videoRef.current.duration);
            setIsLoading(false);
            setError(null);
            applyPendingSeek();
            if (autoPlayAfterSeek) {
                setAutoPlayAfterSeek(false);
                videoRef.current.play().catch(() => {});
            }
        }
    };

    const handleCanPlay = () => {
        setIsLoading(false);
        applyPendingSeek();
        if (autoPlayAfterSeek && videoRef.current) {
            setAutoPlayAfterSeek(false);
            videoRef.current.play().catch(() => {});
        }
    };

    const handleLoadStart = () => {
        setIsLoading(true);
        setError(null);
        setLoadingProgress(0);
    };

    const handleProgress = () => {
        if (videoRef.current && videoRef.current.buffered.length > 0) {
            const bufferedEnd = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
            const duration = videoRef.current.duration;
            if (duration > 0) {
                setLoadingProgress((bufferedEnd / duration) * 100);
            }
        }
    };

    const handleError = () => {
        const video = videoRef.current;
        let errorMessage = '视频加载失败';

        if (video?.error) {
            switch (video.error.code) {
                case MediaError.MEDIA_ERR_ABORTED:
                    errorMessage = '视频加载被中断';
                    break;
                case MediaError.MEDIA_ERR_NETWORK:
                    errorMessage = '网络错误导致视频加载失败';
                    break;
                case MediaError.MEDIA_ERR_DECODE:
                    errorMessage = '视频解码失败，格式可能不支持';
                    break;
                case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                    errorMessage = '视频格式不支持或文件不存在';
                    break;
            }
        }

        setError(errorMessage);
        setIsLoading(false);
    };

    const handleWaiting = () => {
        setIsLoading(true);
    };

    const handlePlaying = () => {
        setIsLoading(false);
        setIsPlaying(true);
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = parseFloat(e.target.value);
        setCurrentTime(time);
        setQueuedSeek(time);
        if (!videoRef.current || !source) {
            return;
        }
        if (source.kind === 'file') {
            videoRef.current.currentTime = time;
            return;
        }
        const windowEnd = windowStart + HLS_WINDOW_SECONDS;
        if (time >= windowStart && time <= windowEnd) {
            videoRef.current.currentTime = time - windowStart;
        }
    };

    const handleScrubStart = () => {
        setIsScrubbing(true);
        if (videoRef.current && !videoRef.current.paused) {
            videoRef.current.pause();
            setIsPlaying(false);
        }
    };

    const handleScrubEnd = () => {
        setIsScrubbing(false);
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const vol = parseFloat(e.target.value);
        setVolume(vol);
        if (videoRef.current) {
            videoRef.current.volume = vol;
        }
    };

    const handleRetry = () => {
        setError(null);
        setHlsError(null);
        setIsLoading(true);
        setRetryToken((value) => value + 1);
        if (videoRef.current) {
            videoRef.current.load();
        }
    };

    const videoSrc = source?.kind === 'file' ? convertFileSrc(source.path) : undefined;
    const debugSrc = source?.kind === 'hls' ? source.path : (videoSrc || '');

    return (
        <div className="glass rounded-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700">
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate flex items-center gap-2">
                    <svg className="w-4 h-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {title || '视频预览'}
                </h3>
                <div className="flex items-center gap-2">
                    {fileSize && (
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                            {formatFileSize(fileSize)}
                        </span>
                    )}
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                        >
                            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            {/* Large file warning */}
            {isLargeFile && isLoading && (
                <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
                    <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span>大文件 ({formatFileSize(fileSize!)})，加载可能需要较长时间，请耐心等待...</span>
                    </p>
                </div>
            )}

            {/* Video */}
            <div className="relative bg-black min-h-[200px]">
                <video
                    ref={videoRef}
                    src={videoSrc}
                    className="w-full max-h-[400px]"
                    preload="metadata"
                    onLoadStart={handleLoadStart}
                    onLoadedMetadata={handleLoadedMetadata}
                    onCanPlay={handleCanPlay}
                    onProgress={handleProgress}
                    onTimeUpdate={handleTimeUpdate}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    onError={handleError}
                    onWaiting={handleWaiting}
                    onPlaying={handlePlaying}
                />

                {/* Loading overlay */}
                {(isLoading || isPreparing) && !error && !hlsError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
                        <div className="flex flex-col items-center gap-3">
                            <svg className="animate-spin h-10 w-10 text-primary-500" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            <span className="text-white text-sm">
                                {isPreparing ? '正在生成 HLS 分片...' : '加载视频中...'}
                            </span>
                            {loadingProgress > 0 && !isPreparing && (
                                <div className="w-32 h-1 bg-slate-600 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-primary-500 transition-all duration-300"
                                        style={{ width: `${loadingProgress}%` }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Error overlay */}
                {(error || hlsError) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
                        <div className="flex flex-col items-center gap-3 px-4 text-center">
                            <svg className="w-12 h-12 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="text-white text-sm">{error || hlsError}</span>
                            {prepareError && (
                                <div className="text-[10px] text-slate-300">
                                    HLS 分片生成失败：{prepareError}
                                </div>
                            )}
                            <div className="mt-2 p-2 bg-black/40 rounded text-[9px] font-mono text-slate-400 break-all max-w-[80%] border border-white/10 text-left">
                                <div className="text-slate-500 mb-1">Error Code: {videoRef.current?.error?.code}</div>
                                <div className="text-slate-500 mb-1">Path:</div>
                                {debugSrc}
                            </div>
                            <button
                                onClick={handleRetry}
                                className="px-5 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded-lg transition-all mt-4 font-medium shadow-lg"
                            >
                                重试
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Controls */}
            <div className="px-4 py-3 space-y-2 bg-slate-50 dark:bg-slate-800/50">
                {/* Progress bar */}
                <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono w-16">
                        {formatTime(currentTime)}
                    </span>
                    <input
                        type="range"
                        min={0}
                        max={timelineDuration || 100}
                        value={currentTime}
                        onChange={handleSeek}
                        onPointerDown={handleScrubStart}
                        onPointerUp={handleScrubEnd}
                        disabled={isLoading || isPreparing || !!error || !!hlsError}
                        className="flex-1 h-1 bg-slate-300 dark:bg-slate-600 rounded-full appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary-500
              [&::-webkit-slider-thumb]:cursor-pointer
            "
                    />
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono w-16 text-right">
                        {formatTime(timelineDuration)}
                    </span>
                </div>

                {/* Buttons */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {/* Play/Pause */}
                        <button
                            onClick={togglePlay}
                            disabled={isLoading || isPreparing || !!error || !!hlsError}
                            className="p-2 rounded-full bg-primary-500 hover:bg-primary-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isPlaying ? (
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                                </svg>
                            ) : (
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            )}
                        </button>
                    </div>

                    {/* Volume */}
                    <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        </svg>
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.1}
                            value={volume}
                            onChange={handleVolumeChange}
                            disabled={isLoading || isPreparing || !!error || !!hlsError}
                            className="w-20 h-1 bg-slate-300 dark:bg-slate-600 rounded-full appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:w-2
                [&::-webkit-slider-thumb]:h-2
                [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:bg-slate-500
                [&::-webkit-slider-thumb]:cursor-pointer
              "
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VideoPlayer;
