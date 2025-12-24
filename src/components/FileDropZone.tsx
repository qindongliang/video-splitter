import React, { useCallback, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

interface FileDropZoneProps {
    onFileSelect: (path: string) => void;
    selectedFile: string | null;
    videoInfo: {
        filename: string;
        duration_formatted: string;
        duration: number;
    } | null;
    disabled?: boolean;
}

const FileDropZone: React.FC<FileDropZoneProps> = ({
    onFileSelect,
    selectedFile,
    videoInfo,
    disabled = false,
}) => {
    const [isDragging, setIsDragging] = useState(false);

    const handleClick = async () => {
        if (disabled) return;

        const selected = await open({
            multiple: false,
            filters: [
                {
                    name: 'Video',
                    extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v'],
                },
            ],
        });

        if (selected && typeof selected === 'string') {
            onFileSelect(selected);
        }
    };

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        if (!disabled) {
            setIsDragging(true);
        }
    }, [disabled]);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        if (disabled) return;

        // Note: Tauri handles file drops differently
        // This is mainly for visual feedback
    }, [disabled]);

    return (
        <div className="w-full">
            <div
                onClick={handleClick}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`
          relative w-full p-8 rounded-2xl border-2 border-dashed
          transition-all duration-300 cursor-pointer
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary-400 hover:bg-slate-800/30'}
          ${isDragging ? 'drop-zone-active border-primary-400 bg-slate-800/50' : 'border-slate-600'}
          ${selectedFile ? 'border-green-500/50 bg-green-900/10' : ''}
        `}
            >
                <div className="flex flex-col items-center justify-center space-y-4">
                    {!selectedFile ? (
                        <>
                            <div className="w-16 h-16 rounded-full bg-slate-700/50 flex items-center justify-center">
                                <svg
                                    className="w-8 h-8 text-primary-400"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                                    />
                                </svg>
                            </div>
                            <div className="text-center">
                                <p className="text-lg font-medium text-slate-200">
                                    拖拽视频文件到这里
                                </p>
                                <p className="text-sm text-slate-400 mt-1">
                                    或点击选择文件
                                </p>
                            </div>
                            <p className="text-xs text-slate-500">
                                支持 MP4, MKV, AVI, MOV, WebM 等格式
                            </p>
                        </>
                    ) : (
                        <>
                            <div className="w-16 h-16 rounded-full bg-green-900/30 flex items-center justify-center">
                                <svg
                                    className="w-8 h-8 text-green-400"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                                    />
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                    />
                                </svg>
                            </div>
                            <div className="text-center">
                                <p className="text-lg font-medium text-green-400">
                                    📹 {videoInfo?.filename || '已选择文件'}
                                </p>
                                {videoInfo && (
                                    <p className="text-sm text-slate-400 mt-1">
                                        时长: {videoInfo.duration_formatted}
                                    </p>
                                )}
                            </div>
                            <p className="text-xs text-slate-500">
                                点击可重新选择文件
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FileDropZone;
