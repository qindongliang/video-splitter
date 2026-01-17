import { useState, useRef, useEffect, useImperativeHandle, forwardRef, type ForwardedRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import Hls from 'hls.js';
import { usePreviewSource } from '../hooks/usePreviewSource';

export interface TimeRange {
    id: string;
    startTime: number;
    endTime: number;
}

interface TimeRangeEditorProps {
    filePath: string;
    duration: number;
    ranges: TimeRange[];
    onAddRange: (range: TimeRange) => void;
    onUpdateRange: (id: string, range: Partial<TimeRange>) => void;
    onDeleteRange: (id: string) => void;
    disabled?: boolean;
}

export interface TimeRangeEditorRef {
    seekTo: (time: number) => void;
}

const formatTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins > 0) {
        return `${mins}分${secs}秒`;
    }
    return `${secs}秒`;
};

const TimeRangeEditor = forwardRef(function TimeRangeEditor({
    filePath,
    duration,
    ranges,
    onAddRange,
    onUpdateRange,
    onDeleteRange,
    disabled = false,
}: TimeRangeEditorProps, ref: ForwardedRef<TimeRangeEditorRef>) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(1);
    const [pendingStart, setPendingStart] = useState<number | null>(null);
    const [editingRangeId, setEditingRangeId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hlsError, setHlsError] = useState<string | null>(null);
    const [retryToken, setRetryToken] = useState(0);
    const [windowStart, setWindowStart] = useState(0);
    const [pendingSeek, setPendingSeek] = useState<number | null>(null);
    const [queuedSeek, setQueuedSeek] = useState<number | null>(null);
    const [autoPlayAfterSeek, setAutoPlayAfterSeek] = useState(false);
    const [isScrubbing, setIsScrubbing] = useState(false);

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
    const isUiDisabled = disabled || isPreparing || !!hlsError;

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

    const timelineDuration = duration;

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
    }, [source?.kind, source?.path, isPreparing]);

    const videoSrc = source?.kind === 'file' ? convertFileSrc(source.path) : undefined;
    const debugSrc = source?.kind === 'hls' ? source.path : (videoSrc || '');

    useImperativeHandle(ref, () => ({
        seekTo: (time: number) => {
            seekToAbsolute(time);
        },
    }));

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = volume;
        }
    }, [volume]);

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
            setCurrentTime(baseOffset + time);
        }
    };

    const handleLoadedMetadata = () => {
        setIsLoading(false);
        setError(null);
        applyPendingSeek();
        if (autoPlayAfterSeek && videoRef.current) {
            setAutoPlayAfterSeek(false);
            videoRef.current.play().catch(() => {});
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

    const handleRetry = () => {
        setError(null);
        setHlsError(null);
        setIsLoading(true);
        setRetryToken((value) => value + 1);
        if (videoRef.current) {
            videoRef.current.load();
        }
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

    const handleSetStart = () => {
        if (editingRangeId) {
            onUpdateRange(editingRangeId, { startTime: currentTime });
        } else {
            setPendingStart(currentTime);
        }
    };

    const handleSetEnd = () => {
        if (editingRangeId) {
            onUpdateRange(editingRangeId, { endTime: currentTime });
            setEditingRangeId(null);
        } else if (pendingStart !== null) {
            const start = Math.min(pendingStart, currentTime);
            const end = Math.max(pendingStart, currentTime);
            if (end > start) {
                onAddRange({
                    id: crypto.randomUUID(),
                    startTime: start,
                    endTime: end,
                });
            }
            setPendingStart(null);
        }
    };

    const handleCancelPending = () => {
        setPendingStart(null);
        setEditingRangeId(null);
    };

    const handleEditRange = (range: TimeRange) => {
        setEditingRangeId(range.id);
        setPendingStart(null);
        if (videoRef.current) {
            videoRef.current.currentTime = range.startTime;
            setCurrentTime(range.startTime);
        }
    };

    const handlePreviewRange = (range: TimeRange) => {
        const deferred = seekToAbsolute(range.startTime);
        if (deferred) {
            setAutoPlayAfterSeek(true);
            return;
        }
        if (videoRef.current) {
            videoRef.current.play().catch(() => {});
        }
    };

    const getTimelineMarkers = () => {
        if (timelineDuration <= 0) {
            return [];
        }
        return ranges.map((range) => ({
            left: (range.startTime / timelineDuration) * 100,
            width: ((range.endTime - range.startTime) / timelineDuration) * 100,
            id: range.id,
        }));
    };

    return (
        <div className="glass rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        <svg className="w-4 h-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        选择时间范围
                    </h3>
                </div>
                {(pendingStart !== null || editingRangeId) && (
                    <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                        {editingRangeId ? '编辑中...' : `开始点: ${formatTime(pendingStart!)}`}
                    </span>
                )}
            </div>

            <div className="relative bg-black min-h-[200px]">
                <video
                    ref={videoRef}
                    src={videoSrc}
                    className="w-full max-h-[300px]"
                    preload="metadata"
                    onLoadStart={handleLoadStart}
                    onLoadedMetadata={handleLoadedMetadata}
                    onCanPlay={handleCanPlay}
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
                            <svg className="animate-spin h-8 w-8 text-primary-500" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            <span className="text-white text-sm">
                                {isPreparing ? '正在生成 HLS 分片...' : '加载视频中...'}
                            </span>
                        </div>
                    </div>
                )}

                {/* Error overlay */}
                {(error || hlsError) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
                        <div className="flex flex-col items-center gap-3 px-4 text-center">
                            <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                                className="px-3 py-1.5 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded-lg transition-colors"
                            >
                                重试
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="px-4 py-3 space-y-3 bg-slate-50 dark:bg-slate-800/50">
                <div className="relative">
                    <div className="absolute inset-0 flex items-center pointer-events-none" style={{ height: '4px', top: '50%', transform: 'translateY(-50%)' }}>
                        {getTimelineMarkers().map((marker) => (
                            <div
                                key={marker.id}
                                className="absolute h-full bg-primary-500/40 rounded"
                                style={{ left: `${marker.left}%`, width: `${marker.width}%` }}
                            />
                        ))}
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 dark:text-slate-400 font-mono w-16">
                            {formatTime(currentTime)}
                        </span>
                        <input
                            type="range"
                            min={0}
                            max={timelineDuration || 100}
                            step={0.1}
                            value={currentTime}
                            onChange={handleSeek}
                            onPointerDown={handleScrubStart}
                            onPointerUp={handleScrubEnd}
                            disabled={isUiDisabled}
                            className="flex-1 h-1 bg-slate-300 dark:bg-slate-600 rounded-full appearance-none cursor-pointer relative z-10
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
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={togglePlay}
                            disabled={isUiDisabled}
                            className="p-2 rounded-full bg-primary-500 hover:bg-primary-600 text-white transition-colors disabled:opacity-50"
                        >
                            {isPlaying ? (
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                                </svg>
                            ) : (
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            )}
                        </button>
                        <div className="flex items-center gap-1">
                            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            </svg>
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.1}
                                value={volume}
                                onChange={(e) => setVolume(parseFloat(e.target.value))}
                                disabled={isUiDisabled}
                                className="w-16 h-1 bg-slate-300 dark:bg-slate-600 rounded-full appearance-none cursor-pointer
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

                    <div className="flex items-center gap-2">
                        {(pendingStart !== null || editingRangeId) && (
                            <button
                                onClick={handleCancelPending}
                                disabled={isUiDisabled}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
                            >
                                取消
                            </button>
                        )}
                        <button
                            onClick={handleSetStart}
                            disabled={isUiDisabled}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors disabled:opacity-50 flex items-center gap-1"
                        >
                            <span>📍</span> 设为开始
                        </button>
                        <button
                            onClick={handleSetEnd}
                            disabled={isUiDisabled || (pendingStart === null && !editingRangeId)}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50 flex items-center gap-1"
                        >
                            <span>📍</span> 设为结束
                        </button>
                    </div>
                </div>
            </div>

            {ranges.length > 0 && (
                <div className="border-t border-slate-200 dark:border-slate-700">
                    <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800">
                        <h4 className="text-xs font-medium text-slate-600 dark:text-slate-400">
                            已选片段 ({ranges.length})
                        </h4>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                        {ranges.map((range, index) => (
                            <div
                                key={range.id}
                                className={`flex items-center justify-between px-4 py-2 border-b border-slate-100 dark:border-slate-700/50 last:border-b-0 ${editingRangeId === range.id ? 'bg-amber-50 dark:bg-amber-900/20' : ''
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <span className="w-6 h-6 flex items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 text-xs font-medium">
                                        {index + 1}
                                    </span>
                                    <div className="text-sm">
                                        <span className="font-mono text-slate-700 dark:text-slate-300">
                                            {formatTime(range.startTime)}
                                        </span>
                                        <span className="text-slate-400 mx-2">→</span>
                                        <span className="font-mono text-slate-700 dark:text-slate-300">
                                            {formatTime(range.endTime)}
                                        </span>
                                        <span className="text-xs text-slate-500 dark:text-slate-500 ml-2">
                                            ({formatDuration(range.endTime - range.startTime)})
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => handlePreviewRange(range)}
                                        disabled={isUiDisabled}
                                        className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors disabled:opacity-50"
                                        title="预览"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </button>
                                    <button
                                        onClick={() => handleEditRange(range)}
                                        disabled={isUiDisabled}
                                        className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors disabled:opacity-50"
                                        title="编辑"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                    </button>
                                    <button
                                        onClick={() => onDeleteRange(range.id)}
                                        disabled={isUiDisabled}
                                        className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                                        title="删除"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
});

TimeRangeEditor.displayName = 'TimeRangeEditor';

export default TimeRangeEditor;
