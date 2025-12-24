import { useState, useEffect } from 'react';
import FileDropZone from './components/FileDropZone';
import DurationInput from './components/DurationInput';
import OutputSelector from './components/OutputSelector';
import ProgressBar from './components/ProgressBar';
import ResultList from './components/ResultList';
import ThemeToggle from './components/ThemeToggle';
import VideoPlayer from './components/VideoPlayer';
import { useVideoSplit } from './hooks/useVideoSplit';
import './index.css';

function App() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [segmentDuration, setSegmentDuration] = useState(300); // 5 minutes default
  const [durationUnit, setDurationUnit] = useState<'seconds' | 'minutes'>('seconds');
  const [outputDir, setOutputDir] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const {
    videoInfo,
    isLoading,
    isProcessing,
    progress,
    result,
    error,
    loadVideoInfo,
    splitVideo,
  } = useVideoSplit();

  // Set default output directory to same as input file
  useEffect(() => {
    if (selectedFile && !outputDir) {
      const dir = selectedFile.substring(0, selectedFile.lastIndexOf('/'));
      setOutputDir(dir);
    }
  }, [selectedFile, outputDir]);

  const handleFileSelect = async (path: string) => {
    setSelectedFile(path);
    setShowPreview(false);
    await loadVideoInfo(path);
  };

  const handleSplit = async () => {
    if (!selectedFile || !outputDir) return;
    await splitVideo(selectedFile, outputDir, segmentDuration);
  };

  const canSplit = selectedFile && outputDir && videoInfo && !isProcessing && !isLoading;

  return (
    <div className="min-h-screen p-6 flex flex-col transition-colors duration-300">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <div className="flex-1" />
        <div className="text-center">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-400 to-cyan-400 bg-clip-text text-transparent">
            🎬 Video Splitter
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            按指定时长自动切分视频
          </p>
        </div>
        <div className="flex-1 flex justify-end">
          <ThemeToggle />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-2xl mx-auto w-full space-y-6">
        {/* File Drop Zone */}
        <FileDropZone
          onFileSelect={handleFileSelect}
          selectedFile={selectedFile}
          videoInfo={videoInfo}
          disabled={isProcessing}
        />

        {/* Video Preview Button & Player */}
        {selectedFile && videoInfo && (
          <div className="space-y-4">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="w-full py-2 rounded-lg glass text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {showPreview ? '隐藏预览' : '预览视频'}
            </button>

            {showPreview && (
              <VideoPlayer
                filePath={selectedFile}
                title={videoInfo.filename}
                onClose={() => setShowPreview(false)}
              />
            )}
          </div>
        )}

        {/* Settings */}
        {videoInfo && (
          <div className="glass rounded-xl p-5 space-y-5">
            <DurationInput
              value={segmentDuration}
              onChange={setSegmentDuration}
              unit={durationUnit}
              onUnitChange={setDurationUnit}
              disabled={isProcessing}
            />
            <OutputSelector
              value={outputDir}
              onChange={setOutputDir}
              disabled={isProcessing}
            />
          </div>
        )}

        {/* Progress */}
        {(isProcessing || (progress && progress.percentage > 0)) && (
          <ProgressBar
            progress={progress?.percentage || 0}
            currentSegment={progress?.current_segment || 0}
            totalSegments={progress?.total_segments || 0}
            currentFile={progress?.current_file || ''}
            isProcessing={isProcessing}
          />
        )}

        {/* Error */}
        {error && (
          <div className="glass rounded-xl p-4 border border-red-500/30 bg-red-900/10 dark:bg-red-900/10">
            <p className="text-red-500 dark:text-red-400 text-sm">
              ❌ 错误: {error}
            </p>
          </div>
        )}

        {/* Result */}
        {result?.success && (
          <ResultList
            files={result.output_files}
          />
        )}

        {/* Split Button */}
        <button
          onClick={handleSplit}
          disabled={!canSplit}
          className={`
            w-full py-4 rounded-xl font-semibold text-lg
            transition-all duration-300 transform
            ${canSplit
              ? 'bg-gradient-to-r from-primary-600 to-cyan-600 text-white hover:from-primary-500 hover:to-cyan-500 hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-primary-500/25'
              : 'bg-slate-300 dark:bg-slate-700 text-slate-500 dark:text-slate-400 cursor-not-allowed'
            }
          `}
        >
          {isProcessing ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              处理中...
            </span>
          ) : (
            '🚀 开始切分'
          )}
        </button>

        {/* Info */}
        {videoInfo && !isProcessing && !result && (
          <p className="text-center text-sm text-slate-500 dark:text-slate-500">
            预计将切分为 {Math.ceil(videoInfo.duration / segmentDuration)} 个片段
          </p>
        )}
      </main>

      {/* Footer */}
      <footer className="text-center mt-8 text-xs text-slate-500 dark:text-slate-600">
        Powered by FFmpeg & Tauri
      </footer>
    </div>
  );
}

export default App;
