interface ProgressBarProps {
    progress: number;
    currentSegment: number;
    totalSegments: number;
    currentFile: string;
    isProcessing: boolean;
}

const ProgressBar = ({
    progress,
    currentSegment,
    totalSegments,
    currentFile,
    isProcessing,
}: ProgressBarProps) => {
    if (!isProcessing && progress === 0) return null;

    return (
        <div className="w-full space-y-3 glass rounded-xl p-4">
            <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                    {isProcessing ? '正在处理...' : '处理完成!'}
                </span>
                <span className="text-primary-600 dark:text-primary-400 font-mono">
                    {progress.toFixed(0)}%
                </span>
            </div>

            {/* Progress bar */}
            <div className="w-full h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                    className={`h-full transition-all duration-300 ease-out rounded-full ${isProcessing ? 'progress-shimmer' : 'bg-green-500'
                        }`}
                    style={{ width: `${progress}%` }}
                />
            </div>

            {/* Details */}
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>
                    第 <span className="text-primary-600 dark:text-primary-400 font-medium">{currentSegment}</span> / {totalSegments} 段
                </span>
                <span className="truncate max-w-[200px]" title={currentFile}>
                    {currentFile}
                </span>
            </div>
        </div>
    );
};

export default ProgressBar;
