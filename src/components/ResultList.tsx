import React from 'react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';

interface ResultListProps {
    files: string[];
    outputDir: string;
}

const ResultList: React.FC<ResultListProps> = ({ files, outputDir }) => {
    if (files.length === 0) return null;

    const handleOpenFolder = async () => {
        try {
            // Use revealItemInDir to open the folder in Finder
            // We reveal the first output file to show the folder
            if (files.length > 0) {
                await revealItemInDir(files[0]);
            }
        } catch (error) {
            console.error('Failed to open folder:', error);
        }
    };

    const getFileName = (path: string) => {
        return path.split('/').pop() || path;
    };

    return (
        <div className="w-full space-y-3 glass rounded-xl p-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-green-600 dark:text-green-400 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    输出文件 ({files.length} 个)
                </h3>
                <button
                    onClick={handleOpenFolder}
                    className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-500 dark:hover:text-primary-300 transition-colors flex items-center gap-1"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    打开文件夹
                </button>
            </div>

            <div className="max-h-40 overflow-y-auto space-y-1">
                {files.map((file, index) => (
                    <div
                        key={index}
                        className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 py-1.5 px-2 rounded hover:bg-slate-100 dark:hover:bg-slate-700/30 transition-colors"
                    >
                        <svg className="w-4 h-4 text-slate-400 dark:text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        <span className="truncate" title={file}>
                            {getFileName(file)}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ResultList;
