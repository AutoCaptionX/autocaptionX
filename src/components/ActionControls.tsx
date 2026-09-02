import React from 'react';
import { Sparkles, Download, RotateCcw, Loader2, ShieldAlert, FileText, Film } from 'lucide-react';
import type { VideoResolution } from '../types';

interface ActionControlsProps {
  hasVideo: boolean;
  isGenerating: boolean;
  progress: number;
  generationStatusText?: string;
  hasGeneratedCaptions: boolean;
  selectedResolution: VideoResolution;
  isExporting?: boolean;
  exportProgress?: number;
  exportStatusText?: string;
  onGenerate: () => void;
  onDownload: () => void;
  onDownloadSrt?: () => void;
  onDownloadVtt?: () => void;
  onReset: () => void;
}

export const ActionControls: React.FC<ActionControlsProps> = ({
  hasVideo,
  isGenerating,
  progress,
  generationStatusText = '',
  hasGeneratedCaptions,
  selectedResolution,
  isExporting = false,
  exportProgress = 0,
  exportStatusText = '',
  onGenerate,
  onDownload,
  onDownloadSrt,
  onDownloadVtt,
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
      {/* Progress Bar when Generating Captions */}
      {isGenerating && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2 shadow-sm animate-in fade-in duration-200">
          <div className="flex items-center justify-between text-xs font-medium text-slate-300">
            <span className="flex items-center gap-2 text-blue-400 font-semibold">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {generationStatusText || `Transcribing... ${progress}%`}
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

      {/* Progress Bar when Exporting/Burning Video */}
      {isExporting && (
        <div className="bg-slate-900 border border-blue-800/80 rounded-xl p-3.5 space-y-2 shadow-sm animate-in fade-in duration-200">
          <div className="flex items-center justify-between text-xs font-medium text-slate-200">
            <span className="flex items-center gap-2 text-blue-400 font-semibold">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {exportStatusText || 'Burning animated captions into video...'}
            </span>
            <span className="font-mono font-bold text-blue-400">{exportProgress}%</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full rounded-full transition-all duration-200 shadow-xs"
              style={{ width: `${exportProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Main Action Buttons */}
      <div className="space-y-2.5">
        <button
          type="button"
          disabled={!hasVideo || isGenerating || isExporting}
          onClick={onGenerate}
          className={`w-full py-3 px-4 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 select-none shadow-md ${
            !hasVideo || isGenerating || isExporting
              ? 'bg-slate-850/80 text-slate-500 cursor-not-allowed border border-slate-800'
              : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20 cursor-pointer active:scale-[0.99]'
          }`}
        >
          <Sparkles className="w-4 h-4 text-white fill-white" />
          Create Captions (Generate)
        </button>

        <button
          type="button"
          disabled={!hasGeneratedCaptions || isGenerating || isExporting}
          onClick={onDownload}
          className={`w-full py-3 px-4 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 select-none shadow-md ${
            !hasGeneratedCaptions || isGenerating || isExporting
              ? 'bg-slate-850/80 text-slate-500 cursor-not-allowed border border-slate-800'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500/30 shadow-emerald-950/40 cursor-pointer active:scale-[0.99]'
          }`}
        >
          {isExporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Rendering Video ({exportProgress}%)...</span>
            </>
          ) : (
            <>
              <Film className="w-4 h-4" />
              <span>Download Captioned Video ({getResolutionLabel()})</span>
            </>
          )}
        </button>

        {/* Subtitle SRT & VTT Download Options */}
        {hasGeneratedCaptions && !isGenerating && !isExporting && (
          <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
            {onDownloadSrt && (
              <button
                type="button"
                onClick={onDownloadSrt}
                className="text-xs text-slate-400 hover:text-blue-400 transition-colors flex items-center gap-1.5 py-1 px-2.5 rounded-lg hover:bg-slate-800/80 cursor-pointer font-medium border border-slate-800"
              >
                <FileText className="w-3.5 h-3.5 text-blue-400" />
                <span>Download .SRT</span>
              </button>
            )}
            {onDownloadVtt && (
              <button
                type="button"
                onClick={onDownloadVtt}
                className="text-xs text-slate-400 hover:text-cyan-400 transition-colors flex items-center gap-1.5 py-1 px-2.5 rounded-lg hover:bg-slate-800/80 cursor-pointer font-medium border border-slate-800"
              >
                <FileText className="w-3.5 h-3.5 text-cyan-400" />
                <span>Download .VTT</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Start new video button */}
      {hasGeneratedCaptions && !isGenerating && !isExporting && (
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
        <span>Subtitles are burned directly into your video in high definition.</span>
      </div>
    </div>
  );
};
