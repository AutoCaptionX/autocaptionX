import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Sparkles, Play, Pause, Volume2, VolumeX, RotateCcw, Loader2 } from 'lucide-react';
import type { CaptionWord, CaptionPreset } from '../types';
import { buildContinuousCaptionPhrases, findActivePhraseIndex } from '../utils/captionConverters';
import { sanitizeAndEnforceMonotonic } from '../utils/audioExtractor';

interface VideoPlayerPreviewProps {
  videoUrl: string | null;
  words: CaptionWord[];
  isGenerating?: boolean;
  preset?: CaptionPreset;
  seekTimeMs?: number | null;
  onTimeUpdate?: (ms: number) => void;
  onDurationChange?: (durationMs: number) => void;
}

export const VideoPlayerPreview: React.FC<VideoPlayerPreviewProps> = ({
  videoUrl,
  words,
  isGenerating = false,
  preset = 'hormozi',
  seekTimeMs = null,
  onTimeUpdate,
  onDurationChange,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoWrapperRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number; isVertical: boolean }>({
    width: 0,
    height: 0,
    isVertical: false,
  });
  const [displayedVideoBounds, setDisplayedVideoBounds] = useState<{ width: number; height: number } | null>(null);

  // Active phrase & word index (Only updated when the word changes to eliminate 60 FPS React re-renders)
  const [activeSubtitle, setActiveSubtitle] = useState<{
    phraseIndex: number;
    activeWordIdx: number;
  } | null>(null);

  // Keep stable refs to avoid recreating animation frames
  const onTimeUpdateRef = useRef(onTimeUpdate);
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  const lastParentUpdateTimeRef = useRef(0);
  const lastActiveWordRef = useRef<{ phraseIndex: number; wordIdx: number } | null>(null);
  const lastTouchTimeRef = useRef<number>(0);

  // Effective video duration in ms (handles metadata, durationchange, and video element duration)
  const effectiveDurationMs = useMemo(() => {
    if (durationMs > 0) return durationMs;
    const v = videoRef.current;
    if (v && v.duration && !isNaN(v.duration) && v.duration !== Infinity && v.duration > 0.1) {
      return Math.round(v.duration * 1000);
    }
    return 0;
  }, [durationMs]);

  // Notify parent of accurate duration
  useEffect(() => {
    if (effectiveDurationMs > 0 && onDurationChange) {
      onDurationChange(effectiveDurationMs);
    }
  }, [effectiveDurationMs, onDurationChange]);

  // Calculate displayed bounding box of the video for caption bounds
  const updateDisplayedBounds = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const rect = video.getBoundingClientRect();
    const videoRatio = (video.videoWidth && video.videoHeight) ? video.videoWidth / video.videoHeight : 16 / 9;
    const containerRatio = rect.width / (rect.height || 1);

    let displayedW = rect.width;
    let displayedH = rect.height;

    if (containerRatio > videoRatio) {
      displayedW = rect.height * videoRatio;
    } else {
      displayedH = rect.width / videoRatio;
    }

    setDisplayedVideoBounds({
      width: Math.max(160, displayedW),
      height: Math.max(120, displayedH),
    });
  }, []);

  // Dedicated direct handler for video element onLoadedMetadata
  const handleVideoLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    if (video.duration && !isNaN(video.duration) && video.duration !== Infinity && video.duration > 0.1) {
      const durMs = Math.round(video.duration * 1000);
      setDurationMs(durMs);
      onDurationChange?.(durMs);
    }
    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if (vw > 0 && vh > 0) {
      // 16:9 landscape when width > height, 9:16 portrait when height >= width
      setVideoDimensions({
        width: vw,
        height: vh,
        isVertical: vh >= vw,
      });
    }
    updateDisplayedBounds();
    setIsBuffering(false);
  };

  // 2. AUTO-FILL SILENCE GAPS (HOLD CAPTION):
  // - Modify word end times: Set effective endTime of each word to startTime of next word.
  // - For the absolute last word of the video, set its endTime equal to video.duration
  const synchronizedWords = useMemo(() => {
    return sanitizeAndEnforceMonotonic(words, effectiveDurationMs);
  }, [words, effectiveDurationMs]);

  // Group words into continuous subtitle chunks spanning 100% video timeline with zero blank gaps
  const phrases = useMemo(() => {
    return buildContinuousCaptionPhrases(synchronizedWords, effectiveDurationMs);
  }, [synchronizedWords, effectiveDurationMs]);

  // Synchronize subtitle state for a given millisecond timestamp
  // Real-time zero-latency word synchronization matching exact audio waveform:
  // Transitions immediately as the sound is uttered with zero latency.
  const syncSubtitleForTime = useCallback((curMs: number) => {
    if (!synchronizedWords || synchronizedWords.length === 0 || !phrases || phrases.length === 0) {
      if (lastActiveWordRef.current !== null) {
        lastActiveWordRef.current = null;
        setActiveSubtitle(null);
      }
      return;
    }

    // 1. Locate active phrase spanning curMs
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

    // 2. Strict word-level audio waveform synchronization:
    // Word is active when sound is uttered: curMs >= word.start && curMs <= word.end
    // Matches the natural pace of Hindi/Hinglish speech with instant word transitions
    let wordIdxInPhrase = -1;

    for (let j = 0; j < currentPhrase.words.length; j++) {
      const pw = currentPhrase.words[j];
      const nextPw = currentPhrase.words[j + 1];

      // Exact waveform match: sound is actively being uttered
      if (curMs >= pw.start && curMs <= pw.end) {
        wordIdxInPhrase = j;
        break;
      }

      // Micro-pause cadence between words within phrase (< 250ms)
      if (nextPw && curMs > pw.end && curMs < nextPw.start && (nextPw.start - pw.end) <= 250) {
        wordIdxInPhrase = j;
        break;
      }
    }

    // If curMs is before the first word begins or in a long silence, wordIdxInPhrase is -1
    // (phrase displayed in neutral state without premature word highlight)
    const last = lastActiveWordRef.current;
    if (!last || last.phraseIndex !== phraseIdx || last.wordIdx !== wordIdxInPhrase) {
      lastActiveWordRef.current = { phraseIndex: phraseIdx, wordIdx: wordIdxInPhrase };
      setActiveSubtitle({ phraseIndex: phraseIdx, activeWordIdx: wordIdxInPhrase });
    }
  }, [synchronizedWords, phrases]);

  // Keep a stable ref to syncSubtitleForTime so RAF loop doesn't restart on phrase updates
  const syncSubtitleForTimeRef = useRef(syncSubtitleForTime);
  useEffect(() => {
    syncSubtitleForTimeRef.current = syncSubtitleForTime;
  }, [syncSubtitleForTime]);

  // Immediately sync subtitle state on mount, when phrases change, or when video loads
  useEffect(() => {
    if (phrases.length > 0 || words.length > 0) {
      const curMs = videoRef.current ? Math.round(videoRef.current.currentTime * 1000) : 0;
      syncSubtitleForTime(curMs);
    }
  }, [phrases, words, syncSubtitleForTime]);

  // Synchronize external seek (e.g. from timeline editor)
  useEffect(() => {
    if (seekTimeMs !== null && videoRef.current) {
      const targetSec = Math.max(0, seekTimeMs / 1000);
      videoRef.current.currentTime = targetSec;
      syncSubtitleForTime(seekTimeMs);
      onTimeUpdateRef.current?.(seekTimeMs);
    }
  }, [seekTimeMs, syncSubtitleForTime]);

  // High-performance 60fps RAF playback loop + seeking / ratechange / timeupdate listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let animFrameId: number = 0;

    const checkSubtitleSync = () => {
      if (video && !video.paused) {
        const curMs = Math.round(video.currentTime * 1000);
        syncSubtitleForTimeRef.current(curMs);

        // Throttle parent onTimeUpdate to 150ms for smooth timeline list indicator without overloading React
        const now = performance.now();
        if (now - lastParentUpdateTimeRef.current > 150) {
          lastParentUpdateTimeRef.current = now;
          onTimeUpdateRef.current?.(curMs);
        }

        animFrameId = requestAnimationFrame(checkSubtitleSync);
      }
    };

    const handleSyncImmediate = () => {
      if (!video) return;
      const curMs = Math.round(video.currentTime * 1000);
      syncSubtitleForTimeRef.current(curMs);
      onTimeUpdateRef.current?.(curMs);
    };

    const handleLoadedMetadata = () => {
      if (video.duration && !isNaN(video.duration) && video.duration !== Infinity && video.duration > 0.1) {
        const durMs = Math.round(video.duration * 1000);
        setDurationMs(durMs);
        onDurationChange?.(durMs);
      }
      const vw = video.videoWidth || 0;
      const vh = video.videoHeight || 0;
      if (vw > 0 && vh > 0) {
        // 16:9 landscape when width > height, 9:16 portrait when height >= width
        setVideoDimensions({
          width: vw,
          height: vh,
          isVertical: vh >= vw,
        });
      }
      updateDisplayedBounds();
      setIsBuffering(false);
    };

    const updateDisplayedBounds = () => {
      if (!video) return;
      const rect = video.getBoundingClientRect();
      const videoRatio = (video.videoWidth && video.videoHeight) ? video.videoWidth / video.videoHeight : 16 / 9;
      const containerRatio = rect.width / (rect.height || 1);

      let displayedW = rect.width;
      let displayedH = rect.height;

      if (containerRatio > videoRatio) {
        displayedW = rect.height * videoRatio;
      } else {
        displayedH = rect.width / videoRatio;
      }

      setDisplayedVideoBounds({
        width: Math.max(160, displayedW),
        height: Math.max(120, displayedH),
      });
    };

    // Track container resizing
    const resizeObserver = new ResizeObserver(() => {
      updateDisplayedBounds();
    });

    if (videoWrapperRef.current) {
      resizeObserver.observe(videoWrapperRef.current);
    }
    if (video) {
      resizeObserver.observe(video);
    }

    const handlePlay = () => {
      setIsPlaying(true);
      setIsBuffering(false);
      cancelAnimationFrame(animFrameId);
      animFrameId = requestAnimationFrame(checkSubtitleSync);
    };

    const handlePause = () => {
      setIsPlaying(false);
      setIsBuffering(false);
      cancelAnimationFrame(animFrameId);
      handleSyncImmediate();
    };

    const handleWaiting = () => setIsBuffering(true);
    const handleCanPlay = () => setIsBuffering(false);

    const handleEnded = () => {
      setIsPlaying(false);
      setIsBuffering(false);
      cancelAnimationFrame(animFrameId);
      handleSyncImmediate();
    };

    // Strict registration of all player synchronization events
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('durationchange', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleSyncImmediate);
    video.addEventListener('seeking', handleSyncImmediate);
    video.addEventListener('seeked', handleSyncImmediate);
    video.addEventListener('ratechange', handleSyncImmediate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('playing', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('ended', handleEnded);

    if (video.duration && !isNaN(video.duration) && video.duration !== Infinity) {
      setDurationMs(Math.round(video.duration * 1000));
    }

    // Initial bounding check
    updateDisplayedBounds();

    return () => {
      cancelAnimationFrame(animFrameId);
      resizeObserver.disconnect();
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('durationchange', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleSyncImmediate);
      video.removeEventListener('seeking', handleSyncImmediate);
      video.removeEventListener('seeked', handleSyncImmediate);
      video.removeEventListener('ratechange', handleSyncImmediate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('playing', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('ended', handleEnded);
    };
  }, [videoUrl, onDurationChange]);

  // Safe play/pause toggle
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

  // Preset styles
  const getWordStyle = (isCurrent: boolean, isPast: boolean) => {
    switch (preset) {
      case 'neon':
        return isCurrent
          ? 'text-cyan-300 scale-110 font-black px-2 py-0.5 bg-cyan-950/90 rounded-lg border border-cyan-400/90 shadow-[0_0_18px_rgba(34,211,238,0.9)]'
          : isPast
          ? 'text-white/95 font-bold'
          : 'text-slate-300/70 font-semibold';
      case 'beast':
        return isCurrent
          ? 'text-emerald-400 scale-110 font-black px-2 py-0.5 bg-black/90 rounded-lg border border-emerald-500 shadow-[0_0_14px_rgba(34,197,94,0.85)]'
          : isPast
          ? 'text-white font-bold'
          : 'text-slate-300 font-semibold';
      case 'clean':
        return isCurrent
          ? 'text-white scale-105 font-bold px-2 py-0.5 bg-blue-600 rounded-md shadow-md'
          : isPast
          ? 'text-white font-semibold'
          : 'text-slate-300 font-medium';
      case 'hormozi':
      default:
        return isCurrent
          ? 'text-yellow-300 scale-115 font-black px-2.5 py-0.5 bg-yellow-500/25 rounded-md shadow-[0_2px_12px_rgba(234,179,8,0.5)]'
          : isPast
          ? 'text-white font-extrabold'
          : 'text-slate-200/80 font-bold';
    }
  };

  // Handle click on video surface to toggle play/pause (ignoring bottom 60px where native controls sit)
  const handleVideoClick = (e: React.MouseEvent<HTMLVideoElement>) => {
    // If touched recently, suppress synthetic click event from mobile devices
    if (Date.now() - lastTouchTimeRef.current < 400) {
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const distanceFromBottom = rect.bottom - e.clientY;
    if (distanceFromBottom <= 60) {
      return;
    }
    handleTogglePlay();
  };

  // Handle touch interactions on mobile touchscreens
  const handleTouchEnd = (e: React.TouchEvent<HTMLVideoElement>) => {
    lastTouchTimeRef.current = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const touch = e.changedTouches[0];
    if (!touch) return;
    const distanceFromBottom = rect.bottom - touch.clientY;
    if (distanceFromBottom <= 60) {
      return;
    }
    handleTogglePlay();
  };

  const currentActivePhrase = activeSubtitle !== null && phrases[activeSubtitle.phraseIndex]
    ? phrases[activeSubtitle.phraseIndex]
    : phrases.length > 0
    ? phrases[0]
    : null;

  return (
    <div
      ref={videoWrapperRef}
      className={`w-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm relative flex items-center justify-center select-none transition-all duration-300 ${
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
          <p className="text-xs text-slate-400 font-medium">16:9 Landscape & 9:16 Portrait • Real-time AI Precision Sync</p>
        </div>
      ) : (
        <div className="w-full h-full relative flex items-center justify-center bg-black overflow-hidden">
          <video
            ref={videoRef}
            src={videoUrl}
            preload="auto"
            playsInline
            controls
            loop={false}
            muted={isMuted}
            onClick={handleVideoClick}
            onTouchEnd={handleTouchEnd}
            onLoadedMetadata={handleVideoLoadedMetadata}
            className="w-full h-full object-contain cursor-pointer"
          />

          {isBuffering && (
            <div className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-black/70 backdrop-blur-xs flex items-center justify-center z-15 pointer-events-none">
              <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
            </div>
          )}

          {/* Precision Active Subtitles Overlay (16:9 Landscape & 9:16 Portrait Dynamic Scaling, Zero Touch Blocking) */}
          {currentActivePhrase && currentActivePhrase.words.length > 0 && !isGenerating && (
            <div
              className="absolute pointer-events-none z-20 flex justify-center items-center select-none"
              style={{
                pointerEvents: 'none',
                bottom: videoDimensions.isVertical ? '14%' : '18%',
                left: '50%',
                transform: 'translateX(-50%)',
                width: displayedVideoBounds
                  ? `${Math.round(displayedVideoBounds.width * (videoDimensions.isVertical ? 0.88 : 0.82))}px`
                  : (videoDimensions.isVertical ? '88%' : '82%'),
                maxWidth: videoDimensions.isVertical ? '88%' : '82%',
              }}
            >
              <div
                className="bg-black/90 backdrop-blur-md px-3.5 sm:px-5 py-2 sm:py-3 rounded-2xl border border-white/20 shadow-[0_10px_35px_rgba(0,0,0,0.85)] flex items-center justify-center flex-wrap gap-1.5 sm:gap-2.5 text-center w-full transition-all duration-75 animate-in fade-in zoom-in-95 pointer-events-none select-none"
                style={{
                  pointerEvents: 'none',
                  userSelect: 'none',
                  textAlign: 'center',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                }}
              >
                {currentActivePhrase.words.map((w, idx) => {
                  const hasActiveWord = activeSubtitle !== null && activeSubtitle.activeWordIdx !== -1;
                  const isCurrent = hasActiveWord && idx === activeSubtitle.activeWordIdx;
                  const isPast = hasActiveWord && idx < activeSubtitle.activeWordIdx;
                  const isLatin = /^[A-Za-z0-9\s.,!?'"%-]+$/.test(w.text || '');

                  // Dynamic font scaler based on displayed bounds, character count, and vertical orientation
                  const totalChars = currentActivePhrase.words.reduce((sum, item) => sum + (item.text || '').length, 0);
                  const baseBoundW = displayedVideoBounds?.width || (videoDimensions.isVertical ? 380 : 640);
                  const isVert = videoDimensions.isVertical;

                  // Calculate dynamic font size: scaled to width, clamped safely
                  let calculatedFontSize = isVert
                    ? Math.max(13, Math.min(22, Math.round((baseBoundW / 24) * (totalChars > 20 ? 0.82 : 1))))
                    : Math.max(16, Math.min(28, Math.round((baseBoundW / 36) * (totalChars > 24 ? 0.85 : 1))));

                  if (isCurrent) calculatedFontSize = Math.round(calculatedFontSize * 1.08);

                  return (
                    <span
                      key={`${w.text}-${w.start}-${idx}`}
                      className={`font-black tracking-wide leading-tight transition-all duration-75 drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)] pointer-events-none select-none whitespace-normal ${
                        isLatin ? 'uppercase' : ''
                      } ${getWordStyle(isCurrent, isPast)}`}
                      style={{
                        pointerEvents: 'none',
                        userSelect: 'none',
                        fontSize: `${calculatedFontSize}px`,
                        WebkitTextStroke: isCurrent ? '1.2px #000' : '0.6px #000',
                        fontFamily: '"Montserrat", "Noto Sans Devanagari", "Plus Jakarta Sans", sans-serif',
                        textAlign: 'center',
                        wordBreak: 'break-word',
                        overflowWrap: 'break-word',
                      }}
                    >
                      {w.text}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Synced Words Status Badge in Top-Right Corner (Non-blocking) */}
          {words.length > 0 && (
            <div className="absolute top-3 right-3 z-20 pointer-events-none select-none">
              <span className="text-[11px] font-bold text-blue-300 bg-black/75 backdrop-blur-xs px-2.5 py-1 rounded-full border border-blue-500/40 flex items-center gap-1 shadow-md">
                <Sparkles className="w-3 h-3 text-blue-400" /> {words.length} words synced
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
