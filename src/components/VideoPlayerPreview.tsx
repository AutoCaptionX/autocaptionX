import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import {
  Sparkles,
  Download,
  FileText,
  FileCode,
  MoreVertical,
  Copy,
  Check,
  CheckCircle2,
  Film,
  Loader2,
  X,
  Smartphone,
  AlertCircle,
  ExternalLink,
  Share2,
} from 'lucide-react';
import type { CaptionWord, CaptionPreset } from '../types';
import {
  buildContinuousCaptionPhrases,
  findActivePhraseIndex,
  getActiveWordIndexForPhrase,
} from '../utils/captionConverters';
import { sanitizeAndEnforceMonotonic } from '../utils/audioExtractor';
import { renderSubtitlesOnCanvas, disposeSubtitleRenderer } from '../utils/subtitleCanvasRenderer';
import { downloadOrSaveVideoFile } from '../utils/fileDownloader';

interface VideoPlayerPreviewProps {
  videoUrl: string | null;
  words: CaptionWord[];
  isGenerating?: boolean;
  preset?: CaptionPreset;
  seekTimeMs?: number | null;
  onTimeUpdate?: (ms: number) => void;
  onDurationChange?: (durationMs: number) => void;
  onDownload?: () => void;
  onDownloadSrt?: () => void;
  onDownloadVtt?: () => void;
  onDownloadJson?: () => void;
}

const formatTime = (seconds: number): string => {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const VideoPlayerPreview: React.FC<VideoPlayerPreviewProps> = ({
  videoUrl,
  words,
  isGenerating = false,
  preset = 'hormozi' as CaptionPreset,
  seekTimeMs = null,
  onTimeUpdate,
  onDurationChange,
  onDownload,
  onDownloadSrt,
  onDownloadVtt,
  onDownloadJson,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const overlayMenuRef = useRef<HTMLDivElement>(null);

  const [durationMs, setDurationMs] = useState(0);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isOverlayMenuOpen, setIsOverlayMenuOpen] = useState(false);
  const [copiedInfo, setCopiedInfo] = useState(false);
  const [isDirectDownloading, setIsDirectDownloading] = useState(false);

  // Fallback modal for Android Chrome when automatic download is blocked
  const [showAndroidFallbackModal, setShowAndroidFallbackModal] = useState(false);
  const [fallbackVideoUrl, setFallbackVideoUrl] = useState<string>('');

  const [videoDimensions, setVideoDimensions] = useState<{
    width: number;
    height: number;
    isVertical: boolean;
  }>({
    width: 0,
    height: 0,
    isVertical: false,
  });

  const onTimeUpdateRef = useRef(onTimeUpdate);
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  const lastParentUpdateTimeRef = useRef(0);
  const lastActiveWordRef = useRef<{ phraseIndex: number; wordIdx: number } | null>(null);

  // Close dropdown menus on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setIsMenuOpen(false);
      }
      if (overlayMenuRef.current && !overlayMenuRef.current.contains(target)) {
        setIsOverlayMenuOpen(false);
      }
    };
    if (isMenuOpen || isOverlayMenuOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isMenuOpen, isOverlayMenuOpen]);

  // Effective video duration in ms
  const effectiveDurationMs = useMemo(() => {
    if (durationMs > 0) return durationMs;
    const v = videoRef.current;
    if (v && v.duration && !isNaN(v.duration) && v.duration !== Infinity && v.duration > 0.1) {
      return Math.round(v.duration * 1000);
    }
    return 0;
  }, [durationMs]);

  // Synchronized words spanning full duration
  const synchronizedWords = useMemo(() => {
    return sanitizeAndEnforceMonotonic(words, effectiveDurationMs);
  }, [words, effectiveDurationMs]);

  // Group into continuous phrases
  const phrases = useMemo(() => {
    return buildContinuousCaptionPhrases(synchronizedWords, effectiveDurationMs);
  }, [synchronizedWords, effectiveDurationMs]);

  // Word-level audio waveform synchronization with Audio-Visual Timestamp Interpolation
  const syncSubtitleForTime = useCallback((curMs: number) => {
    if (!synchronizedWords || synchronizedWords.length === 0 || !phrases || phrases.length === 0) {
      if (lastActiveWordRef.current !== null) {
        lastActiveWordRef.current = null;
      }
      return;
    }

    let phraseIdx = findActivePhraseIndex(phrases, curMs);
    if (phraseIdx === -1) {
      if (curMs < phrases[0].start) {
        phraseIdx = 0;
      } else if (curMs > phrases[phrases.length - 1].end) {
        phraseIdx = phrases.length - 1;
      }
    }
    phraseIdx = Math.max(0, Math.min(phrases.length - 1, phraseIdx !== -1 ? phraseIdx : 0));
    const currentPhrase = phrases[phraseIdx];

    // Zero-lag active word selection matching video.currentTime precisely
    const wordIdxInPhrase = getActiveWordIndexForPhrase(
      currentPhrase.words,
      curMs,
      currentPhrase.start,
      currentPhrase.end
    );

    lastActiveWordRef.current = { phraseIndex: phraseIdx, wordIdx: wordIdxInPhrase };
  }, [synchronizedWords, phrases]);

  const syncSubtitleForTimeRef = useRef(syncSubtitleForTime);
  useEffect(() => {
    syncSubtitleForTimeRef.current = syncSubtitleForTime;
  }, [syncSubtitleForTime]);

  // Canvas subtitle frame rendering: clears transparent canvas and renders active caption
  // DOWNSCALED PREVIEW RENDER BUFFER: Capped to max 720p to eliminate CPU/RAM exhaustion and freezing on mobile
  const drawPreviewFrame = useCallback((targetMs?: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const rawW = video.videoWidth || 1280;
    const rawH = video.videoHeight || 720;

    // Downscale preview render buffer to max 720p
    let bufW = rawW;
    let bufH = rawH;
    if (bufW > 0 && bufH > 0) {
      if (bufW >= bufH) {
        // Landscape: max height 720
        if (bufH > 720) {
          bufW = Math.round((bufW * 720) / bufH);
          bufH = 720;
        }
      } else {
        // Portrait: max width 720
        if (bufW > 720) {
          bufH = Math.round((bufH * 720) / bufW);
          bufW = 720;
        }
      }
    }

    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW;
      canvas.height = bufH;
    }

    // Clear transparent subtitle canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw active animated subtitle over video
    if (words.length > 0 && phrases.length > 0) {
      const curMs = typeof targetMs === 'number' ? targetMs : Math.round(video.currentTime * 1000);
      const pIdx = findActivePhraseIndex(phrases, curMs);
      if (pIdx !== -1) {
        renderSubtitlesOnCanvas({
          ctx,
          phrase: phrases[pIdx],
          curMs,
          preset,
          width: canvas.width,
          height: canvas.height,
        });
      }
    }
  }, [words, phrases, preset]);

  // Load video metadata
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.duration && !isNaN(video.duration) && video.duration !== Infinity && video.duration > 0.1) {
      const durMs = Math.round(video.duration * 1000);
      setDurationMs(durMs);
      onDurationChange?.(durMs);
    }
    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if (vw > 0 && vh > 0) {
      setVideoDimensions({
        width: vw,
        height: vh,
        isVertical: vh >= vw,
      });
    }
    requestAnimationFrame(() => drawPreviewFrame());
  };

  // Synchronize external seek from parent (timeline editor)
  useEffect(() => {
    if (seekTimeMs !== null && videoRef.current) {
      const targetSec = Math.max(0, seekTimeMs / 1000);
      videoRef.current.currentTime = targetSec;
      setCurrentTimeSec(targetSec);
      syncSubtitleForTime(seekTimeMs);
      onTimeUpdateRef.current?.(seekTimeMs);
      requestAnimationFrame(() => drawPreviewFrame(seekTimeMs));
    }
  }, [seekTimeMs, syncSubtitleForTime, drawPreviewFrame]);

  // CONSTANT FPS PLAYBACK SYNCHRONIZED DIRECTLY TO VIDEO CLOCK:
  // - Uses video.currentTime directly as the master clock source (no setInterval, no wall-clock drift).
  // - Hardware-synchronized with requestVideoFrameCallback when supported, with continuous requestAnimationFrame fallback.
  // - Locks caption rendering strictly to media playback progression, eliminating mid-video speed mismatch or slow-down.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let animFrameId: number | null = null;
    let rvfcId: number | null = null;
    let lastRenderedTimeSec = -1;

    const stopLoop = () => {
      if (rvfcId !== null && 'cancelVideoFrameCallback' in video) {
        try {
          (video as any).cancelVideoFrameCallback(rvfcId);
        } catch (e) {}
        rvfcId = null;
      }
      if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
    };

    const renderFrameAtTime = (mediaTimeSec: number) => {
      const curMs = Math.round(mediaTimeSec * 1000);
      drawPreviewFrame(curMs);
      setCurrentTimeSec(mediaTimeSec);
      syncSubtitleForTimeRef.current(curMs);

      const now = performance.now();
      if (now - lastParentUpdateTimeRef.current > 150) {
        lastParentUpdateTimeRef.current = now;
        onTimeUpdateRef.current?.(curMs);
      }
    };

    // Hardware-synchronized video frame presentation callback
    const onVideoFrame = (_now: DOMHighResTimeStamp, metadata?: any) => {
      if (!video || video.paused || video.ended) {
        stopLoop();
        return;
      }

      const mediaTimeSec =
        metadata && typeof metadata.mediaTime === 'number' ? metadata.mediaTime : video.currentTime;
      lastRenderedTimeSec = mediaTimeSec;
      renderFrameAtTime(mediaTimeSec);

      if (!video.paused && !video.ended && 'requestVideoFrameCallback' in video) {
        rvfcId = (video as any).requestVideoFrameCallback(onVideoFrame);
      } else {
        stopLoop();
      }
    };

    // Constant FPS animation loop driven directly by video.currentTime
    const renderLoop = () => {
      if (!video || video.paused || video.ended) {
        stopLoop();
        return;
      }

      const currentSec = video.currentTime;
      // Redraw whenever video time advances or actively playing
      if (currentSec !== lastRenderedTimeSec || !video.paused) {
        lastRenderedTimeSec = currentSec;
        renderFrameAtTime(currentSec);
      }

      if (!video.paused && !video.ended) {
        animFrameId = requestAnimationFrame(renderLoop);
      } else {
        stopLoop();
      }
    };

    const handlePlay = () => {
      stopLoop();
      lastRenderedTimeSec = -1;
      if ('requestVideoFrameCallback' in video) {
        rvfcId = (video as any).requestVideoFrameCallback(onVideoFrame);
      } else {
        animFrameId = requestAnimationFrame(renderLoop);
      }
    };

    const handlePauseOrEnded = () => {
      stopLoop();
      renderFrameAtTime(video.currentTime);
      onTimeUpdateRef.current?.(Math.round(video.currentTime * 1000));
    };

    const handleTimeUpdate = () => {
      if (video.paused) {
        renderFrameAtTime(video.currentTime);
      }
    };

    const handleSeeked = () => {
      renderFrameAtTime(video.currentTime);
      onTimeUpdateRef.current?.(Math.round(video.currentTime * 1000));
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('durationchange', handleLoadedMetadata);
    video.addEventListener('play', handlePlay);
    video.addEventListener('playing', handlePlay);
    video.addEventListener('pause', handlePauseOrEnded);
    video.addEventListener('ended', handlePauseOrEnded);
    video.addEventListener('waiting', stopLoop);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('seeking', handleSeeked);
    video.addEventListener('timeupdate', handleTimeUpdate);

    // Initial paint of single frame
    drawPreviewFrame(Math.round(video.currentTime * 1000));

    return () => {
      stopLoop();
      disposeSubtitleRenderer();
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('durationchange', handleLoadedMetadata);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('playing', handlePlay);
      video.removeEventListener('pause', handlePauseOrEnded);
      video.removeEventListener('ended', handlePauseOrEnded);
      video.removeEventListener('waiting', stopLoop);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('seeking', handleSeeked);
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [drawPreviewFrame]);

  // Clean memory when video changes or unmounts
  useEffect(() => {
    return () => {
      disposeSubtitleRenderer();
      if (canvasRef.current) {
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
      }
    };
  }, [videoUrl]);

  // Direct video file download handler from three dots menu
  const handleDirectDownloadVideo = async () => {
    setIsMenuOpen(false);
    setIsOverlayMenuOpen(false);

    // If user has generated captions, prioritize running the full export with burned-in captions
    if (words.length > 0 && onDownload) {
      onDownload();
      return;
    }

    if (!videoUrl) return;

    setIsDirectDownloading(true);
    try {
      const res = await fetch(videoUrl);
      const sourceBlob = await res.blob();
      const mp4Blob = new Blob([sourceBlob], { type: 'video/mp4' });
      const downloadRes = await downloadOrSaveVideoFile(mp4Blob, 'AutoCaptionX_Video.mp4');

      // If automatic download is blocked by Chrome Android, display fallback popup modal
      if (downloadRes.needsLongPressModal) {
        setFallbackVideoUrl(downloadRes.blobUrl || videoUrl);
        setShowAndroidFallbackModal(true);
      }
    } catch (err) {
      console.error('Direct video download error:', err);
      // Show fallback modal on any download block error
      setFallbackVideoUrl(videoUrl);
      setShowAndroidFallbackModal(true);
    } finally {
      setIsDirectDownloading(false);
    }
  };

  const handleCopyVideoInfo = () => {
    const totalSec = effectiveDurationMs > 0 ? effectiveDurationMs / 1000 : (videoRef.current?.duration || 0);
    const info = `AutoCaptionX Video Details:\nResolution: ${videoDimensions.width}x${videoDimensions.height} (${videoDimensions.isVertical ? 'Portrait 9:16' : 'Landscape 16:9'})\nDuration: ${formatTime(totalSec)}\nWords: ${words.length}`;
    navigator.clipboard.writeText(info).then(() => {
      setCopiedInfo(true);
      setTimeout(() => setCopiedInfo(false), 2000);
    });
  };

  return (
    <div
      ref={containerRef}
      className="w-full bg-slate-950 border border-slate-800/90 rounded-2xl overflow-hidden shadow-2xl relative flex flex-col select-none transition-all duration-300"
    >
      {/* Top Header Bar Right Next to Video Preview with Custom Three Dots (⋮) Menu */}
      <div className="w-full flex items-center justify-between px-3.5 py-2.5 bg-slate-900/95 border-b border-slate-800/80 text-xs backdrop-blur-md z-30">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 font-bold text-white tracking-tight">
            <span>AutoCaption</span>
            <span className="text-blue-500">X</span>
          </div>

          {videoDimensions.width > 0 && (
            <span className="text-[11px] font-mono bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded-full border border-slate-700/80 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>
                {videoDimensions.width}x{videoDimensions.height} • {videoDimensions.isVertical ? '9:16 Portrait' : '16:9 Landscape'}
              </span>
            </span>
          )}

          {words.length > 0 && (
            <span className="text-[11px] text-blue-400 bg-blue-950/60 border border-blue-800/60 px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1 shadow-xs">
              <Sparkles className="w-3 h-3" /> {words.length} words synced
            </span>
          )}
        </div>

        {/* Header Bar Options Menu Button */}
        {videoUrl && (
          <div className="flex items-center gap-2 relative shrink-0" ref={menuRef}>
            <button
              type="button"
              id="video-options-menu-btn"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 transition cursor-pointer flex items-center justify-center shadow-xs"
              title="Video Options (⋮)"
              aria-label="Video options"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {/* Dropdown Menu from Header */}
            {isMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-60 bg-slate-900 border border-slate-700/90 rounded-xl shadow-2xl z-50 py-1.5 backdrop-blur-xl animate-in fade-in zoom-in-95 text-xs">
                <button
                  type="button"
                  id="direct-download-video-opt"
                  onClick={handleDirectDownloadVideo}
                  disabled={isDirectDownloading}
                  className="w-full px-3.5 py-2.5 text-left font-semibold text-white hover:bg-blue-600/25 hover:text-blue-300 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  {isDirectDownloading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                  ) : (
                    <Download className="w-4 h-4 text-blue-400" />
                  )}
                  <span>Save / Download Video</span>
                </button>

                {onDownloadSrt && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onDownloadSrt();
                    }}
                    className="w-full px-3.5 py-2 text-left text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-amber-400" />
                    <span>Download .SRT Subtitles</span>
                  </button>
                )}

                {onDownloadVtt && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onDownloadVtt();
                    }}
                    className="w-full px-3.5 py-2 text-left text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-cyan-400" />
                    <span>Download .VTT Subtitles</span>
                  </button>
                )}

                {onDownloadJson && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onDownloadJson();
                    }}
                    className="w-full px-3.5 py-2 text-left text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <FileCode className="w-4 h-4 text-emerald-400" />
                    <span>Download .JSON Words</span>
                  </button>
                )}

                <div className="h-px bg-slate-800 my-1" />

                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    handleCopyVideoInfo();
                  }}
                  className="w-full px-3.5 py-2 text-left text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  {copiedInfo ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
                  <span>{copiedInfo ? 'Info Copied!' : 'Copy Video Details'}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Video & Canvas Player Stage */}
      <div
        className={`w-full relative flex items-center justify-center bg-black overflow-hidden ${
          videoDimensions.isVertical
            ? 'aspect-[9/16] max-h-[72vh] mx-auto'
            : 'aspect-video max-h-[72vh] mx-auto'
        }`}
      >
        {!videoUrl ? (
          <div className="text-center p-8 flex flex-col items-center justify-center">
            <Film className="w-12 h-12 text-slate-700 mb-3" />
            <p className="text-sm text-slate-400 font-semibold mb-1">Auto Captions Generated Video Preview</p>
            <p className="text-xs text-slate-600">Upload a video to preview auto-generated captions live with subtitles.</p>
          </div>
        ) : (
          <div className="w-full h-full relative flex items-center justify-center bg-black overflow-hidden group">
            {/* HTML5 Video Element with Native Controls & Browser Native Overflow Menu */}
            <video
              ref={videoRef}
              id="autocaptionx-video-player"
              src={videoUrl}
              controls
              controlsList="download"
              playsInline
              preload="auto"
              className="w-full h-full object-contain bg-black z-0"
            />

            {/* Overlay Canvas for Burned-In Animated Subtitles (Pointer-events-none passes clicks directly to native controls) */}
            <canvas
              ref={canvasRef}
              id="autocaptionx-subtitle-canvas"
              className="absolute inset-0 w-full h-full object-contain pointer-events-none z-10"
            />

            {/* HTML5 Video Native Overlay 3-Dots (⋮) Menu Button sitting directly on video player */}
            <div
              ref={overlayMenuRef}
              className="absolute top-3 right-3 z-20 pointer-events-auto flex flex-col items-end"
            >
              <button
                type="button"
                id="video-overlay-3dots-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOverlayMenuOpen((prev) => !prev);
                }}
                className="w-8 h-8 rounded-full bg-black/70 hover:bg-black/90 text-white/90 hover:text-white border border-white/20 backdrop-blur-md flex items-center justify-center shadow-lg transition cursor-pointer active:scale-95"
                title="Options (⋮)"
                aria-label="Video overlay options"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {/* Overlay Dropdown Menu */}
              {isOverlayMenuOpen && (
                <div className="mt-1.5 w-56 bg-slate-900/95 border border-slate-700 rounded-xl shadow-2xl py-1.5 backdrop-blur-xl animate-in fade-in zoom-in-95 text-xs z-30">
                  <button
                    type="button"
                    onClick={handleDirectDownloadVideo}
                    disabled={isDirectDownloading}
                    className="w-full px-3.5 py-2.5 text-left font-semibold text-white hover:bg-blue-600/30 hover:text-blue-300 flex items-center gap-2.5 transition cursor-pointer"
                  >
                    {isDirectDownloading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                    ) : (
                      <Download className="w-4 h-4 text-blue-400" />
                    )}
                    <span>Save / Download Video</span>
                  </button>

                  {onDownloadSrt && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsOverlayMenuOpen(false);
                        onDownloadSrt();
                      }}
                      className="w-full px-3.5 py-2 text-left text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition cursor-pointer"
                    >
                      <FileText className="w-4 h-4 text-amber-400" />
                      <span>Download .SRT Subtitles</span>
                    </button>
                  )}

                  {onDownloadVtt && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsOverlayMenuOpen(false);
                        onDownloadVtt();
                      }}
                      className="w-full px-3.5 py-2 text-left text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition cursor-pointer"
                    >
                      <FileText className="w-4 h-4 text-cyan-400" />
                      <span>Download .VTT Subtitles</span>
                    </button>
                  )}

                  <div className="h-px bg-slate-800 my-1" />

                  <button
                    type="button"
                    onClick={() => {
                      setIsOverlayMenuOpen(false);
                      handleCopyVideoInfo();
                    }}
                    className="w-full px-3.5 py-2 text-left text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition cursor-pointer"
                  >
                    {copiedInfo ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
                    <span>{copiedInfo ? 'Info Copied!' : 'Copy Video Details'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Fallback Popup Modal when Automatic Download is Blocked by Chrome Android */}
      {showAndroidFallbackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800 bg-slate-900/95">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  <Smartphone className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Long press video to Save to Gallery</h3>
                  <p className="text-[11px] text-slate-400">Mobile Chrome download fallback</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAndroidFallbackModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3.5 overflow-y-auto">
              {/* Instruction banner */}
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  Automatic download was blocked by Chrome Android. <strong className="text-white font-bold">Long press (tap and hold)</strong> the video below and choose <strong className="text-amber-300 font-bold">"Download video"</strong> to save to your phone's Gallery.
                </p>
              </div>

              {/* Video Player */}
              <div className="rounded-xl overflow-hidden bg-black border border-slate-800 flex items-center justify-center max-h-[45vh]">
                <video
                  src={fallbackVideoUrl}
                  controls
                  controlsList="download"
                  playsInline
                  preload="auto"
                  className="w-full max-h-[45vh] object-contain mx-auto"
                />
              </div>

              {/* Action buttons */}
              <div className="space-y-2 pt-1">
                {/* 1. Open Video in New Tab */}
                {fallbackVideoUrl && (
                  <a
                    href={fallbackVideoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-2.5 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white font-medium text-xs border border-slate-700 flex items-center justify-between transition cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <ExternalLink className="w-4 h-4 text-cyan-400 shrink-0" />
                      <span className="font-semibold text-white">Open Video in New Tab</span>
                    </div>
                    <span className="text-[10px] text-slate-400">Direct full view & save →</span>
                  </a>
                )}

                {/* 2. Web Share API for native gallery saving */}
                {typeof navigator !== 'undefined' && Boolean(navigator.share) && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!fallbackVideoUrl) return;
                      try {
                        const response = await fetch(fallbackVideoUrl);
                        const blob = await response.blob();
                        const file = new File([blob], 'AutoCaptionX_Video.mp4', { type: 'video/mp4' });
                        if (navigator.canShare && navigator.canShare({ files: [file] })) {
                          await navigator.share({
                            files: [file],
                            title: 'AutoCaptionX Video',
                            text: 'Captioned video preview',
                          });
                        }
                      } catch (err: any) {
                        if (err.name !== 'AbortError') console.warn('Share error:', err);
                      }
                    }}
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-md shadow-emerald-600/20"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>Save / Share to Gallery & Files</span>
                  </button>
                )}
              </div>
            </div>

            <div className="px-4 py-2.5 border-t border-slate-800 bg-slate-900/60 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowAndroidFallbackModal(false)}
                className="text-xs font-medium text-slate-300 hover:text-white transition cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
