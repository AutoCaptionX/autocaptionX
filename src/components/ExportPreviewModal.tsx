import React, { useState, useEffect } from 'react';
import { Download, Share2, FileText, CheckCircle2, X, ShieldCheck, Smartphone, AlertCircle, ExternalLink, Sparkles } from 'lucide-react';
import { downloadOrSaveVideoFile, shareVideoFile } from '../utils/fileDownloader';

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

  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || navigator.vendor || '');
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || navigator.vendor || '');

  // Sync prop fallback state
  useEffect(() => {
    if (isFallbackMode || isAndroid) {
      setFallbackActive(true);
    }
  }, [isFallbackMode, isAndroid]);

  // Create persistent Object URL with matching container type
  useEffect(() => {
    if (!renderedVideoBlob) {
      setVideoUrl('');
      return;
    }

    const containerType = renderedVideoBlob.type || 'video/mp4';
    const blobToPlay = new Blob([renderedVideoBlob], { type: containerType });
    const url = URL.createObjectURL(blobToPlay);
    setVideoUrl(url);

    return () => {
      // Keep ObjectURL alive for 60 seconds to allow seamless playback, sharing, or new tab viewing
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {}
      }, 60000);
    };
  }, [renderedVideoBlob]);

  if (!isOpen || !renderedVideoBlob) return null;

  const canShare = typeof navigator !== 'undefined' && Boolean(navigator.share);
  const isWebm = renderedVideoBlob.type.includes('webm');
  const formatLabel = isWebm ? 'WEBM' : 'MP4';

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
    setShareStatus('Opening device share menu...');
    try {
      const res = await shareVideoFile(renderedVideoBlob, fileName);
      if (res.success) {
        setShareStatus('Shared successfully!');
        setTimeout(() => setShareStatus(null), 3000);
      } else if (res.error === 'cancelled') {
        setShareStatus(null);
      } else {
        setShareStatus(res.error || 'Share not available');
        setTimeout(() => setShareStatus(null), 3500);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('Share error:', err);
      }
      setShareStatus(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/95 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl border ${
              fallbackActive 
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' 
                : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
            }`}>
              {fallbackActive ? <Smartphone className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Captioned Video Ready</span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  {resolution} {formatLabel}
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                {isAndroid || fallbackActive
                  ? 'Chrome Android: Tap & hold video to Save to Gallery' 
                  : 'Subtitles burned permanently into video'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video Player Preview & Long-Press Save Target */}
        <div className="p-4 overflow-y-auto space-y-3.5">

          {/* Primary Mobile Long-Press Instruction Banner */}
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-gradient-to-r from-amber-500/20 to-orange-500/15 border border-amber-500/35 text-amber-200 shadow-sm">
            <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-300 shrink-0 mt-0.5">
              <Smartphone className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between gap-1 flex-wrap">
                <span className="font-bold text-xs text-amber-300">
                  Tap & Hold (Long Press) Video → Save Video to Gallery
                </span>
              </div>
              <p className="text-slate-300 text-[11px] mt-1 leading-relaxed">
                Android Chrome download protection prevents automatic file saving. To save directly to your phone's Photos or Gallery without errors: <strong className="text-white font-semibold">press and hold the video player below</strong>, then tap <strong className="text-amber-300 font-semibold">"Download video"</strong>.
              </p>
            </div>
          </div>

          {/* HTML5 Video Element for direct preview & long-press saving */}
          <div className="relative rounded-xl overflow-hidden bg-black border-2 border-slate-700/70 flex items-center justify-center max-h-[42vh] shadow-inner group">
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

          {/* Quick Direct Actions */}
          <div className="space-y-2.5 pt-1">
            
            {/* 1. Open Video in New Tab (Direct Save Link) */}
            {videoUrl && (
              <a
                href={videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-750 active:scale-[0.99] text-slate-200 hover:text-white font-medium text-xs border border-slate-700 flex items-center justify-between transition-all"
              >
                <div className="flex items-center gap-2">
                  <ExternalLink className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span className="font-semibold text-slate-100">Open Video in New Tab</span>
                </div>
                <span className="text-[10px] text-slate-400">Full screen player with 3-dot download menu →</span>
              </a>
            )}

            {/* 2. Web Share API (Android native share sheet to save directly to Gallery / Files) */}
            {canShare && (
              <button
                type="button"
                onClick={handleNativeShare}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99] text-white font-semibold text-xs sm:text-sm shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
                <span>{shareStatus || 'Share to Gallery, WhatsApp & Files (Android Share)'}</span>
              </button>
            )}

            {/* 3. Direct Browser Download (Desktop / Non-Android fallback) */}
            <button
              type="button"
              onClick={handleDownloadAgain}
              className="w-full py-2.5 px-4 rounded-xl bg-blue-600/90 hover:bg-blue-600 active:scale-[0.99] text-white font-medium text-xs border border-blue-500/40 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              {downloaded ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-green-300" />
                  <span>Download Triggered!</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 text-blue-200" />
                  <span>Direct Download Video File ({resolution.toUpperCase()} {formatLabel})</span>
                </>
              )}
            </button>

            {/* 4. Matching SRT subtitles */}
            <button
              type="button"
              onClick={onDownloadSrt}
              className="w-full py-2 px-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-300 hover:text-white font-medium text-xs border border-slate-700/60 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              <span>Download Matching .SRT Subtitles</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
          <span className="flex items-center gap-1.5 text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            Zero-storage client side rendering
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
};

