import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import {
  Sparkles,
  Play,
  Pause,
  Volume2,
  VolumeX,
  RotateCcw,
  Loader2,
  Maximize,
  Minimize,
  SlidersHorizontal,
  CheckCircle2,
} from 'lucide-react';
import type { CaptionWord, CaptionPreset } from '../types';
import { buildContinuousCaptionPhrases, findActivePhraseIndex } from '../utils/captionConverters';
import { sanitizeAndEnforceMonotonic } from '../utils/audioExtractor';
import { renderSubtitlesOnCanvas, disposeSubtitleRenderer } from '../utils/subtitleCanvasRenderer';

interface VideoPlayerPreviewProps {
  videoUrl: string | null;
  words: CaptionWord[];
  isGenerating?: boolean;
  preset?: CaptionPreset;
  seekTimeMs?: number | null;
  onTimeUpdate?: (ms: number) => void;
  onDurationChange?: (durationMs: number) => void;
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
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [useDownscaledPreview, setUseDownscaledPreview] = useState(true);

  const [videoDimensions, setVideoDimensions] = useState<{
    width: number;
    height: number;
    isVertical: boolean;
  }>({
    width: 0,
    height: 0,
    isVertical: false,
  });

  // Active phrase & word index for overlay sync
  const [activeSubtitle, setActiveSubtitle] = useState<{
    phraseIndex: number;
    activeWordIdx: number;
  } | null>(null);

  const onTimeUpdateRef = useRef(onTimeUpdate);
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  const lastParentUpdateTimeRef = useRef(0);
  const lastActiveWordRef = useRef<{ phraseIndex: number; wordIdx: number } | null>(null);
  const controlsTimeoutRef = useRef<any>(null);

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

  // Group into phrases
  const phrases = useMemo(() => {
    return buildContinuousCaptionPhrases(synchronizedWords, effectiveDurationMs);
  }, [synchronizedWords, effectiveDurationMs]);

  // Compute 720p Maximum Preview Scaling
  // 16:9 Landscape: max 1280x720
  // 9:16 Portrait: max 720x1280
  const previewScale = useMemo(() => {
    const vw = videoDimensions.width || 1280;
    const vh = videoDimensions.height || 720;
    const isVert = vh >= vw;

    const MAX_W = isVert ? 720 : 1280;
    const MAX_H = isVert ? 1280 : 720;

    let targetW = vw;
    let targetH = vh;

    if (isVert) {
      if (targetW > MAX_W) {
        const ratio = MAX_W / targetW;
        targetW = MAX_W;
        targetH = Math.round(vh * ratio);
      }
      if (targetH > MAX_H) {
        const ratio = MAX_H / targetH;
        targetH = MAX_H;
        targetW = Math.round(targetW * ratio);
      }
    } else {
      if (targetH > MAX_H) {
        const ratio = MAX_H / targetH;
        targetH = MAX_H;
        targetW = Math.round(vw * ratio);
      }
      if (targetW > MAX_W) {
        const ratio = MAX_W / targetW;
        targetW = MAX_W;
        targetH = Math.round(targetH * ratio);
      }
    }

    const isDownscaled = targetW < vw || targetH < vh;

    return {
      width: Math.max(320, targetW),
      height: Math.max(180, targetH),
      isDownscaled,
      origWidth: vw,
      origHeight: vh,
    };
  }, [videoDimensions]);

  // Strict word-level audio waveform synchronization
  const syncSubtitleForTime = useCallback((curMs: number) => {
    if (!synchronizedWords || synchronizedWords.length === 0 || !phrases || phrases.length === 0) {
      if (lastActiveWordRef.current !== null) {
        lastActiveWordRef.current = null;
        setActiveSubtitle(null);
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

    let wordIdxInPhrase = -1;
    for (let j = 0; j < currentPhrase.words.length; j++) {
      const pw = currentPhrase.words[j];
      const nextPw = currentPhrase.words[j + 1];

      if (curMs >= pw.start && curMs <= pw.end) {
        wordIdxInPhrase = j;
        break;
      }

      if (nextPw && curMs > pw.end && curMs < nextPw.start && (nextPw.start - pw.end) <= 250) {
        wordIdxInPhrase = j;
        break;
      }
    }

    const last = lastActiveWordRef.current;
    if (!last || last.phraseIndex !== phraseIdx || last.wordIdx !== wordIdxInPhrase) {
      lastActiveWordRef.current = { phraseIndex: phraseIdx, wordIdx: wordIdxInPhrase };
      setActiveSubtitle({ phraseIndex: phraseIdx, activeWordIdx: wordIdxInPhrase });
    }
  }, [synchronizedWords, phrases]);

  const syncSubtitleForTimeRef = useRef(syncSubtitleForTime);
  useEffect(() => {
    syncSubtitleForTimeRef.current = syncSubtitleForTime;
  }, [syncSubtitleForTime]);

  // Draw current video frame to downscaled preview canvas
  const drawPreviewFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const renderW = useDownscaledPreview ? previewScale.width : (videoDimensions.width || 1280);
    const renderH = useDownscaledPreview ? previewScale.height : (videoDimensions.height || 720);

    if (canvas.width !== renderW || canvas.height !== renderH) {
      canvas.width = renderW;
      canvas.height = renderH;
    }

    // Draw downscaled frame
    ctx.drawImage(video, 0, 0, renderW, renderH);

    // Draw burned-in subtitle preview using optimized offscreen cache
    if (words.length > 0 && phrases.length > 0) {
      const curMs = Math.round(video.currentTime * 1000);
      const pIdx = findActivePhraseIndex(phrases, curMs);
      if (pIdx !== -1) {
        renderSubtitlesOnCanvas({
          ctx,
          phrase: phrases[pIdx],
          curMs,
          preset,
          width: renderW,
          height: renderH,
        });
      }
    }
  }, [useDownscaledPreview, previewScale, videoDimensions, words, phrases, preset]);

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
    setIsBuffering(false);
    requestAnimationFrame(drawPreviewFrame);
  };

  // Synchronize external seek from parent (timeline editor)
  useEffect(() => {
    if (seekTimeMs !== null && videoRef.current) {
      const targetSec = Math.max(0, seekTimeMs / 1000);
      videoRef.current.currentTime = targetSec;
      setCurrentTimeSec(targetSec);
      syncSubtitleForTime(seekTimeMs);
      onTimeUpdateRef.current?.(seekTimeMs);
      requestAnimationFrame(drawPreviewFrame);
    }
  }, [seekTimeMs, syncSubtitleForTime, drawPreviewFrame]);

  // Frame-Rate Throttled Canvas Rendering Loop
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let animFrameId: number = 0;
    let vfcHandle: number | null = null;
    let lastDrawTimestamp = 0;
    const targetFps = 30;
    const frameIntervalMs = 1000 / targetFps; // ~33.33ms throttled loop

    // Throttled requestAnimationFrame loop
    const throttledLoop = (timestamp: number) => {
      if (!video) return;

      if (!video.paused && !video.ended) {
        const elapsed = timestamp - lastDrawTimestamp;
        if (elapsed >= frameIntervalMs) {
          lastDrawTimestamp = timestamp - (elapsed % frameIntervalMs);
          drawPreviewFrame();

          const curMs = Math.round(video.currentTime * 1000);
          setCurrentTimeSec(video.currentTime);
          syncSubtitleForTimeRef.current(curMs);

          const now = performance.now();
          if (now - lastParentUpdateTimeRef.current > 200) {
            lastParentUpdateTimeRef.current = now;
            onTimeUpdateRef.current?.(curMs);
          }
        }
      }

      animFrameId = requestAnimationFrame(throttledLoop);
    };

    // Modern requestVideoFrameCallback support
    const supportsVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

    const onVideoFramePresented = (now: DOMHighResTimeStamp, metadata: any) => {
      if (!video) return;

      drawPreviewFrame();
      const mediaSec = typeof metadata.mediaTime === 'number' ? metadata.mediaTime : video.currentTime;
      setCurrentTimeSec(mediaSec);
      const curMs = Math.round(mediaSec * 1000);
      syncSubtitleForTimeRef.current(curMs);

      const perfNow = performance.now();
      if (perfNow - lastParentUpdateTimeRef.current > 200) {
        lastParentUpdateTimeRef.current = perfNow;
        onTimeUpdateRef.current?.(curMs);
      }

      if (!video.paused && !video.ended) {
        // @ts-ignore
        vfcHandle = video.requestVideoFrameCallback(onVideoFramePresented);
      }
    };

    const handlePlay = () => {
      setIsPlaying(true);
      setIsBuffering(false);
      cancelAnimationFrame(animFrameId);
      if (supportsVFC) {
        // @ts-ignore
        vfcHandle = video.requestVideoFrameCallback(onVideoFramePresented);
      } else {
        animFrameId = requestAnimationFrame(throttledLoop);
      }
    };

    const handlePause = () => {
      setIsPlaying(false);
      setIsBuffering(false);
      cancelAnimationFrame(animFrameId);
      if (vfcHandle !== null && 'cancelVideoFrameCallback' in HTMLVideoElement.prototype) {
        // @ts-ignore
        video.cancelVideoFrameCallback(vfcHandle);
        vfcHandle = null;
      }
      drawPreviewFrame();
      const curMs = Math.round(video.currentTime * 1000);
      setCurrentTimeSec(video.currentTime);
      syncSubtitleForTimeRef.current(curMs);
      onTimeUpdateRef.current?.(curMs);
    };

    const handleWaiting = () => setIsBuffering(true);
    const handleCanPlay = () => setIsBuffering(false);

    const handleEnded = () => {
      setIsPlaying(false);
      setIsBuffering(false);
      cancelAnimationFrame(animFrameId);
      drawPreviewFrame();
    };

    const handleSeeked = () => {
      drawPreviewFrame();
      const curMs = Math.round(video.currentTime * 1000);
      setCurrentTimeSec(video.currentTime);
      syncSubtitleForTimeRef.current(curMs);
      onTimeUpdateRef.current?.(curMs);
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('durationchange', handleLoadedMetadata);
    video.addEventListener('play', handlePlay);
    video.addEventListener('playing', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('seeking', handleSeeked);

    // Initial frame render
    drawPreviewFrame();

    return () => {
      cancelAnimationFrame(animFrameId);
      disposeSubtitleRenderer();
      if (vfcHandle !== null && 'cancelVideoFrameCallback' in HTMLVideoElement.prototype) {
        // @ts-ignore
        video.cancelVideoFrameCallback(vfcHandle);
      }
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('durationchange', handleLoadedMetadata);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('playing', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('seeking', handleSeeked);
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

  // Play / Pause Toggle
  const handleTogglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      if (video.ended) {
        video.currentTime = 0;
      }
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => console.warn('Playback resume notice:', err));
      }
    } else {
      video.pause();
    }
  }, []);

  // Mute / Unmute Toggle
  const handleToggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  // Scrubber Seek
  const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const targetSec = parseFloat(e.target.value);
    video.currentTime = targetSec;
    setCurrentTimeSec(targetSec);
    const curMs = Math.round(targetSec * 1000);
    syncSubtitleForTime(curMs);
    onTimeUpdateRef.current?.(curMs);
    drawPreviewFrame();
  };

  // Fullscreen Toggle
  const handleToggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // Auto-hide controls during playback
  const handleUserActivity = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 2800);
    }
  };

  const totalSec = effectiveDurationMs > 0 ? effectiveDurationMs / 1000 : (videoRef.current?.duration || 0);

  return (
    <div
      ref={containerRef}
      onMouseMove={handleUserActivity}
      onTouchStart={handleUserActivity}
      className={`w-full bg-slate-950 border border-slate-800/90 rounded-2xl overflow-hidden shadow-2xl relative flex items-center justify-center select-none transition-all duration-300 ${
        videoDimensions.isVertical
          ? 'aspect-[9/16] max-h-[78vh] mx-auto w-auto max-w-[420px]'
          : 'aspect-video max-h-[78vh] w-full max-w-4xl mx-auto'
      }`}
    >
      {!videoUrl ? (
        <div className="text-center p-6 flex flex-col items-center justify-center">
          <div className="flex items-center gap-1.5 text-white font-bold text-2xl tracking-tight mb-1">
            <span>AutoCaption</span>
            <span className="text-blue-500">X</span>
          </div>
          <p className="text-xs text-slate-400 font-medium">
            16:9 Landscape & 9:16 Portrait • 720p Lag-Free AI Preview
          </p>
        </div>
      ) : (
        <div className="w-full h-full relative flex items-center justify-center bg-black overflow-hidden group">
          {/* Underlying HTML5 video element handles hardware audio playback & decoding */}
          <video
            ref={videoRef}
            src={videoUrl}
            preload="auto"
            playsInline
            muted={isMuted}
            className="hidden"
          />

          {/* 720p Max Downscaled Preview Canvas (Zero lag on 2-minute+ videos & mobile devices) */}
          <canvas
            ref={canvasRef}
            onClick={handleTogglePlay}
            className="w-full h-full object-contain cursor-pointer"
          />

          {/* Buffering Indicator */}
          {isBuffering && (
            <div className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-black/80 backdrop-blur-xs flex items-center justify-center z-25 pointer-events-none">
              <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
            </div>
          )}

          {/* Big Center Play Button Overlay when Paused */}
          {!isPlaying && !isBuffering && (
            <div
              onClick={handleTogglePlay}
              className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-blue-600/90 hover:bg-blue-500 text-white flex items-center justify-center cursor-pointer shadow-2xl transition-transform hover:scale-110 z-20"
              title="Play Video"
            >
              <Play className="w-8 h-8 fill-white translate-x-0.5" />
            </div>
          )}

          {/* Top Info Badges */}
          <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none z-20">
            {/* 720p Preview Downscaling Indicator */}
            <div className="flex items-center gap-1.5 pointer-events-auto">
              <button
                onClick={() => {
                  setUseDownscaledPreview((prev) => !prev);
                  setTimeout(drawPreviewFrame, 50);
                }}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${
                  useDownscaledPreview
                    ? 'bg-emerald-950/85 text-emerald-300 border-emerald-500/50'
                    : 'bg-slate-900/85 text-slate-300 border-slate-700'
                }`}
                title="Toggle 720p downscaling (recommended for smooth playback on long videos)"
              >
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span>{useDownscaledPreview ? '720p Preview (Lag-Free)' : 'Native Res'}</span>
                {previewScale.isDownscaled && (
                  <span className="text-[10px] opacity-75 font-mono">
                    ({previewScale.width}x{previewScale.height})
                  </span>
                )}
              </button>
            </div>

            {/* Word count badge */}
            {words.length > 0 && (
              <div className="pointer-events-none">
                <span className="text-[11px] font-bold text-blue-300 bg-black/80 backdrop-blur-xs px-2.5 py-1 rounded-full border border-blue-500/40 flex items-center gap-1 shadow-md">
                  <Sparkles className="w-3 h-3 text-blue-400" /> {words.length} words synced
                </span>
              </div>
            )}
          </div>

          {/* Sleek Custom Controls Bar */}
          <div
            className={`absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/95 via-black/70 to-transparent z-30 transition-opacity duration-200 ${
              showControls || !isPlaying ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
          >
            {/* Scrubber Progress Bar */}
            <div className="relative mb-2 flex items-center">
              <input
                type="range"
                min={0}
                max={totalSec > 0 ? totalSec : 100}
                step={0.05}
                value={currentTimeSec}
                onChange={handleScrubberChange}
                className="w-full h-1.5 bg-slate-700/80 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none"
              />
            </div>

            {/* Bottom Controls Row */}
            <div className="flex items-center justify-between text-xs text-white">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleTogglePlay}
                  className="p-1.5 text-white hover:text-blue-400 transition-colors cursor-pointer rounded-lg hover:bg-white/10"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white" />}
                </button>

                <button
                  onClick={handleToggleMute}
                  className="p-1.5 text-white hover:text-blue-400 transition-colors cursor-pointer rounded-lg hover:bg-white/10"
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
                </button>

                {/* Time Display */}
                <span className="font-mono text-[11px] text-slate-300">
                  {formatTime(currentTimeSec)} / {formatTime(totalSec)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleFullscreen}
                  className="p-1.5 text-white hover:text-blue-400 transition-colors cursor-pointer rounded-lg hover:bg-white/10"
                  title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                >
                  {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
