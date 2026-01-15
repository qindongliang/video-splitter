import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';

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

const TimeRangeEditor = forwardRef<TimeRangeEditorRef, TimeRangeEditorProps>(({
    filePath,
    duration,
    ranges,
    onAddRange,
    onUpdateRange,
    onDeleteRange,
    disabled = false,
}, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(1);
    const [pendingStart, setPendingStart] = useState<number | null>(null);
    const [editingRangeId, setEditingRangeId] = useState<string | null>(null);

    const videoSrc = convertFileSrc(filePath);

    useImperativeHandle(ref, () => ({
        seekTo: (time: number) => {
            if (videoRef.current) {
                videoRef.current.currentTime = time;
                setCurrentTime(time);
            }
        },
    }));

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = volume;
        }
    }, [volume]);

    const togglePlay = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
        }
    };

    const handleTimeUpdate = () => {
        if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime);
        }
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = parseFloat(e.target.value);
        if (videoRef.current) {
            videoRef.current.currentTime = time;
            setCurrentTime(time);
        }
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
        if (videoRef.current) {
            videoRef.current.currentTime = range.startTime;
            setCurrentTime(range.startTime);
            videoRef.current.play();
        }
    };

    const getTimelineMarkers = () => {
        return ranges.map((range) => ({
            left: (range.startTime / duration) * 100,
            width: ((range.endTime - range.startTime) / duration) * 100,
            id: range.id,
        }));
    };

    return (
        <div className="glass rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700">
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                    <svg className="w-4 h-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    选择时间范围
                </h3>
                {(pendingStart !== null || editingRangeId) && (
                    <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                        {editingRangeId ? '编辑中...' : `开始点: ${formatTime(pendingStart!)}`}
                    </span>
                )}
            </div>

            <div className="relative bg-black">
                <video
                    ref={videoRef}
                    src={videoSrc}
                    className="w-full max-h-[300px]"
                    onTimeUpdate={handleTimeUpdate}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                />
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
                            max={duration || 100}
                            step={0.1}
                            value={currentTime}
                            onChange={handleSeek}
                            disabled={disabled}
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
                            {formatTime(duration)}
                        </span>
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={togglePlay}
                            disabled={disabled}
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
                                disabled={disabled}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
                            >
                                取消
                            </button>
                        )}
                        <button
                            onClick={handleSetStart}
                            disabled={disabled}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors disabled:opacity-50 flex items-center gap-1"
                        >
                            <span>📍</span> 设为开始
                        </button>
                        <button
                            onClick={handleSetEnd}
                            disabled={disabled || (pendingStart === null && !editingRangeId)}
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
                                className={`flex items-center justify-between px-4 py-2 border-b border-slate-100 dark:border-slate-700/50 last:border-b-0 ${
                                    editingRangeId === range.id ? 'bg-amber-50 dark:bg-amber-900/20' : ''
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
                                        disabled={disabled}
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
                                        disabled={disabled}
                                        className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors disabled:opacity-50"
                                        title="编辑"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                    </button>
                                    <button
                                        onClick={() => onDeleteRange(range.id)}
                                        disabled={disabled}
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
