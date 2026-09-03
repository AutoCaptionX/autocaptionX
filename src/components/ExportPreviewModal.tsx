import React, { useState, useEffect } from 'react';
import { Download, Share2, FileText, CheckCircle2, X, ShieldCheck, Smartphone, AlertCircle, Sparkles } from 'lucide-react';
import { downloadOrSaveVideoFile } from '../utils/fileDownloader';

interface ExportPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  renderedVideoBlob: Blob | null;
  fileName: string;
  resolution: string;
  onDownloadSrt: () => void;
  isFallbackMode?: boolean;
}

export const ExportPreviewModal: React.FC<ExportPreviewModalProps> = ({
  isOpen,
  onClose,
  renderedVideoBlob,
  fileName,
  resolution,
  onDownloadSrt,
  isFallbackMode = false,
}) => {
  const [downloaded, setDownloaded] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [fallbackActive, setFallbackActive] = useState(isFallbackMode);
  const [videoUrl, setVideoUrl] = useState<string>('');

  // Sync prop fallback state
  useEffect(() => {
    if (isFallbackMode) {
      setFallbackActive(true);
    }
  }, [isFallbackMode]);

  // Prevent memory leaks on Android Chrome: manage single Object URL with 30s delayed revoke
  useEffect(() => {
    if (!renderedVideoBlob) {
      setVideoUrl('');
      return;
    }

    // Convert explicitly to video/mp4 format
    const mp4Blob = new Blob([renderedVideoBlob], { type: 'video/mp4' });
    const url = URL.createObjectURL(mp4Blob);
    setVideoUrl(url);

    return () => {
      // 30 seconds delayed revoke to allow mobile gallery writing to complete uninterrupted
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {}
      }, 30000);
    };
  }, [renderedVideoBlob]);

  if (!isOpen || !renderedVideoBlob) return null;

  const canShare = typeof navigator !== 'undefined' && Boolean(navigator.share && navigator.canShare);

  const handleDownloadAgain = async () => {
    try {
      const res = await downloadOrSaveVideoFile(renderedVideoBlob, fileName);
      if (res.needsLongPressModal) {
        setFallbackActive(true);
      } else {
        setDownloaded(true);
        setTimeout(() => setDownloaded(false), 4000);
      }
    } catch (e: any) {
      console.warn('Download error:', e);
      setFallbackActive(true);
    }
  };

  const handleNativeShare = async () => {
    if (!canShare) return;
    try {
      const mp4Blob = new Blob([renderedVideoBlob], { type: 'video/mp4' });
      const safeName = fileName.replace(/\.[^/.]+$/, '') + '.mp4';
      const file = new File([mp4Blob], safeName, {
        type: 'video/mp4',
        lastModified: Date.now(),
      });
      if (navigator.canShare({ files: [file] })) {
        setShareStatus('Opening device share sheet...');
        await navigator.share({
          files: [file],
          title: 'AutoCaptionX Captioned Video',
          text: 'Captioned video with burned-in subtitles',
        });
        setShareStatus('Shared successfully!');
        setTimeout(() => setShareStatus(null), 3000);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('Share error:', err);
      }
      setShareStatus(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/95">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl border ${
              fallbackActive 
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' 
                : 'bg-green-500/20 text-green-400 border-green-500/30'
            }`}>
              {fallbackActive ? <AlertCircle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                {fallbackActive ? 'Long press video to Save to Gallery' : 'Video Export Ready'}
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  {resolution} MP4
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                {fallbackActive 
                  ? 'Chrome Android download fallback: tap and hold video player' 
                  : 'Captions permanently burned into video/mp4'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video Player Preview (Direct Play & Long-Press Save Target) */}
        <div className="p-4 overflow-y-auto space-y-4">

          {/* Fallback Notice Banner if a.click() failed or mobile mode */}
          {fallbackActive && (
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200">
              <Smartphone className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-xs text-amber-300">Long press video to Save to Gallery</span>
                <p className="text-slate-300 text-[11px] mt-0.5 leading-relaxed">
                  Automatic download was blocked by Chrome Android. <strong className="text-white font-bold">Long press (tap and hold)</strong> the video player below and choose <strong className="text-amber-300 font-bold">"Download video"</strong> to save directly to your phone's Gallery.
                </p>
              </div>
            </div>
          )}

          {/* HTML5 Video Element for direct preview & long-press saving */}
          <div className="relative rounded-xl overflow-hidden bg-black border-2 border-slate-800 flex items-center justify-center max-h-[42vh] shadow-inner group">
            <video
              key={videoUrl}
              src={videoUrl}
              controls
              controlsList="download"
              playsInline
              preload="auto"
              className="w-full max-h-[42vh] object-contain mx-auto"
            />
          </div>

          {/* Mobile Helper Callout */}
          {!fallbackActive && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-blue-950/40 border border-blue-800/40 text-xs text-blue-200">
              <Smartphone className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-blue-300">Direct Mobile Gallery / Downloads:</span>
                <p className="text-slate-300 text-[11px] mt-0.5">
                  Tap <strong className="text-white">"Save Video to Phone"</strong> below. You can also tap and hold (long-press) the video above anytime to save directly to your camera roll.
                </p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2.5 pt-1">
            <button
              onClick={handleDownloadAgain}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.99] text-white font-semibold text-sm shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              {downloaded ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-green-300" />
                  <span>Download Started! Writing to Disk & Gallery...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Save Video to Phone / Gallery ({resolution.toUpperCase()} MP4)</span>
                </>
              )}
            </button>

            {canShare && (
              <button
                onClick={handleNativeShare}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700/80 active:scale-[0.99] text-slate-200 hover:text-white font-medium text-xs border border-slate-700 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Share2 className="w-4 h-4 text-blue-400" />
                <span>{shareStatus || 'Share to Instagram, WhatsApp & Photos'}</span>
              </button>
            )}

            <button
              onClick={onDownloadSrt}
              className="w-full py-2 px-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-300 hover:text-white font-medium text-xs border border-slate-700/60 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              <span>Download Matching .SRT Subtitles</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5 text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-green-400" />
            Zero-storage client side MP4
          </span>
          <button
            onClick={onClose}
            className="text-xs font-semibold text-slate-300 hover:text-white transition-colors"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
};

