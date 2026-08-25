import React from 'react';
import { Sparkles, Download, RotateCcw, Loader2, ShieldAlert } from 'lucide-react';
import type { VideoResolution } from '../types';

interface ActionControlsProps {
  hasVideo: boolean;
  isGenerating: boolean;
  progress: number;
  hasGeneratedCaptions: boolean;
  selectedResolution: VideoResolution;
  onGenerate: () => void;
  onDownload: () => void;
  onReset: () => void;
}

export const ActionControls: React.FC<ActionControlsProps> = ({
  hasVideo,
  isGenerating,
  progress,
  hasGeneratedCaptions,
  selectedResolution,
  onGenerate,
  onDownload,
  onReset,
}) => {
  const getResolutionLabel = () => {
    switch (selectedResolution) {
      case '4k':
        return '4K Ultra HD';
      case '1080p':
        return '1080p Full HD';
      case '720p':
        return '720p HD';
      default:
        return '1080p Full HD';
    }
  };

  return (
    <div className="w-full space-y-3.5">
      {/* Progress Bar when Generating */}
      {isGenerating && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2 shadow-sm animate-in fade-in duration-200">
          <div className="flex items-center justify-between text-xs font-medium text-slate-300">
            <span className="flex items-center gap-2 text-blue-400 font-semibold">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Generating captions and syncing subtitles...
            </span>
            <span className="font-mono font-bold text-blue-400">{progress}%</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-blue-600 h-full rounded-full transition-all duration-300 shadow-xs"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Main Action Buttons */}
      <div className="space-y-2.5">
        <button
          type="button"
          disabled={!hasVideo || isGenerating}
          onClick={onGenerate}
          className={`w-full py-3 px-4 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 select-none shadow-md ${
            !hasVideo || isGenerating
              ? 'bg-slate-850/80 text-slate-500 cursor-not-allowed border border-slate-800'
              : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20 cursor-pointer active:scale-[0.99]'
          }`}
        >
          <Sparkles className="w-4 h-4 text-white fill-white" />
          Create Captions (Generate)
        </button>

        <button
          type="button"
          disabled={!hasGeneratedCaptions || isGenerating}
          onClick={onDownload}
          className={`w-full py-3 px-4 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 select-none shadow-md ${
            !hasGeneratedCaptions || isGenerating
              ? 'bg-slate-850/80 text-slate-500 cursor-not-allowed border border-slate-800'
              : 'bg-slate-800 hover:bg-slate-750 text-white border border-slate-700 shadow-slate-900/40 cursor-pointer active:scale-[0.99]'
          }`}
        >
          <Download className="w-4 h-4" />
          Download ({getResolutionLabel()})
        </button>
      </div>

      {/* Start new video button */}
      {hasGeneratedCaptions && !isGenerating && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1.5 py-1 px-3 rounded-lg hover:bg-slate-800 cursor-pointer font-medium"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Start another video
          </button>
        </div>
      )}

      {/* Privacy Notice */}
      <div className="pt-2 flex items-center justify-center gap-1.5 text-[11px] text-slate-500 text-center">
        <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-slate-500" />
        <span>Your uploaded and generated files are permanently deleted after download.</span>
      </div>
    </div>
  );
};
