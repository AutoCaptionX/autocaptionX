import React, { useState } from 'react';
import { Download, Share2, FileText, CheckCircle2, X, Play, ShieldCheck, Smartphone } from 'lucide-react';
import { downloadOrSaveVideoFile } from '../utils/fileDownloader';

interface ExportPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  renderedVideoBlob: Blob | null;
  fileName: string;
  resolution: string;
  onDownloadSrt: () => void;
}

export const ExportPreviewModal: React.FC<ExportPreviewModalProps> = ({
  isOpen,
  onClose,
  renderedVideoBlob,
  fileName,
  resolution,
  onDownloadSrt,
}) => {
  const [downloaded, setDownloaded] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  if (!isOpen || !renderedVideoBlob) return null;

  const videoUrl = URL.createObjectURL(renderedVideoBlob);
  const canShare = typeof navigator !== 'undefined' && Boolean(navigator.share && navigator.canShare);

  const handleDownloadAgain = async () => {
    try {
      await downloadOrSaveVideoFile(renderedVideoBlob, fileName);
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 4000);
    } catch (e: any) {
      console.warn('Download error:', e);
    }
  };

  const handleNativeShare = async () => {
    if (!canShare) return;
    try {
      const file = new File([renderedVideoBlob], fileName, {
        type: renderedVideoBlob.type || 'video/mp4',
        lastModified: Date.now(),
      });
      if (navigator.canShare({ files: [file] })) {
        setShareStatus('Opening share sheet...');
        await navigator.share({
          files: [file],
          title: 'AutoCaptionX Video',
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-green-500/20 text-green-400 border border-green-500/30">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Video Export Ready
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  {resolution}
                </span>
              </h3>
              <p className="text-xs text-slate-400">Captions permanently burned into video</p>
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
          <div className="relative rounded-xl overflow-hidden bg-black border border-slate-800 flex items-center justify-center max-h-[42vh]">
            <video
              src={videoUrl}
              controls
              playsInline
              className="w-full max-h-[42vh] object-contain mx-auto"
              poster=""
            />
          </div>

          {/* Android / Mobile Helper Callout */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-blue-950/40 border border-blue-800/40 text-xs text-blue-200">
            <Smartphone className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-blue-300">Mobile Gallery & Downloads:</span>
              <p className="text-slate-300 text-[11px] mt-0.5">
                Tap the button below to save to your device. You can also tap Play or long-press (tap & hold) the video above to choose <strong className="text-white">"Download Video"</strong>.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2.5 pt-1">
            <button
              onClick={handleDownloadAgain}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.99] text-white font-semibold text-sm shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              {downloaded ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-green-300" />
                  <span>Download Triggered! Check Gallery / Downloads</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Save Video to Phone / Gallery ({resolution.toUpperCase()})</span>
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
            Zero-storage client side export
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
