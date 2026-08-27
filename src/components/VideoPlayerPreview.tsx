import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Sparkles, Play, Pause, Volume2, VolumeX, RotateCcw, Loader2 } from 'lucide-react';
import type { CaptionWord, CaptionPreset } from '../types';

interface VideoPlayerPreviewProps {
  videoUrl: string | null;
  words: CaptionWord[];
  isGenerating?: boolean;
  preset?: CaptionPreset;
  seekTimeMs?: number | null;
  onTimeUpdate?: (ms: number) => void;
}

export const VideoPlayerPreview: React.FC<VideoPlayerPreviewProps> = ({
  videoUrl,
  words,
  isGenerating = false,
  preset = 'hormozi',
  seekTimeMs = null,
  onTimeUpdate,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  // Keep a stable ref for onTimeUpdate to avoid recreating effects
  const onTimeUpdateRef = useRef(onTimeUpdate);
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  const lastParentUpdateTimeRef = useRef(0);

  // Synchronize external seek (e.g. from timeline editor)
  useEffect(() => {
    if (seekTimeMs !== null && videoRef.current) {
      const targetSec = Math.max(0, seekTimeMs / 1000);
      videoRef.current.currentTime = targetSec;
      setCurrentTimeMs(seekTimeMs);
      onTimeUpdateRef.current?.(seekTimeMs);
    }
  }, [seekTimeMs]);

  // Main high-precision video playback & animation synchronization loop
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let animFrameId: number;

    const syncPlaybackTime = () => {
      if (video && !video.paused) {
        const ms = Math.round(video.currentTime * 1000);
        setCurrentTimeMs(ms);

        // Throttle parent onTimeUpdate to 150ms to prevent React render freezing
        const now = performance.now();
        if (now - lastParentUpdateTimeRef.current > 150) {
          lastParentUpdateTimeRef.current = now;
          onTimeUpdateRef.current?.(ms);
        }
      }
      animFrameId = requestAnimationFrame(syncPlaybackTime);
    };

    const handleLoadedMetadata = () => {
      if (video.duration && !isNaN(video.duration)) {
        setDurationMs(Math.round(video.duration * 1000));
      }
      setIsBuffering(false);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      setIsBuffering(false);
      cancelAnimationFrame(animFrameId);
      animFrameId = requestAnimationFrame(syncPlaybackTime);
    };

    const handlePlaying = () => {
      setIsPlaying(true);
      setIsBuffering(false);
    };

    const handlePause = () => {
      setIsPlaying(false);
      setIsBuffering(false);
      cancelAnimationFrame(animFrameId);
      if (video) {
        const ms = Math.round(video.currentTime * 1000);
        setCurrentTimeMs(ms);
        onTimeUpdateRef.current?.(ms);
      }
    };

    const handleWaiting = () => {
      setIsBuffering(true);
    };

    const handleCanPlay = () => {
      setIsBuffering(false);
    };

    const handleSeeking = () => {
      if (video) {
        const ms = Math.round(video.currentTime * 1000);
        setCurrentTimeMs(ms);
      }
    };

    const handleSeeked = () => {
      if (video) {
        const ms = Math.round(video.currentTime * 1000);
        setCurrentTimeMs(ms);
        onTimeUpdateRef.current?.(ms);
      }
      setIsBuffering(false);
    };

    const handleTimeUpdate = () => {
      if (video) {
        const ms = Math.round(video.currentTime * 1000);
        setCurrentTimeMs(ms);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setIsBuffering(false);
      cancelAnimationFrame(animFrameId);
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('play', handlePlay);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('seeking', handleSeeking);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);

    // Initial check
    if (video.duration && !isNaN(video.duration)) {
      setDurationMs(Math.round(video.duration * 1000));
    }

    return () => {
      cancelAnimationFrame(animFrameId);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('seeking', handleSeeking);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
    };
  }, [videoUrl]);

  // Safe play/pause handler
  const handleTogglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      if (video.ended) {
        video.currentTime = 0;
        setCurrentTimeMs(0);
      }
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('Playback resume handled smoothly:', err);
        });
      }
    } else {
      video.pause();
    }
  }, []);

  // Sorted words to ensure 100% chronological consistency
  const sortedWords = useMemo(() => {
    if (!words || words.length === 0) return [];
    return [...words].sort((a, b) => a.start - b.start);
  }, [words]);

  // Group words into natural subtitle chunks (3-4 words) with exact timing boundaries
  const phrases = useMemo(() => {
    if (!sortedWords || sortedWords.length === 0) return [];

    const result: Array<{
      id: number;
      words: CaptionWord[];
      start: number;
      end: number;
      displayUntil: number;
    }> = [];

    let currentGroup: CaptionWord[] = [];

    const flushGroup = () => {
      if (currentGroup.length === 0) return;
      const start = currentGroup[0].start;
      const end = currentGroup[currentGroup.length - 1].end;
      result.push({
        id: result.length,
        words: [...currentGroup],
        start,
        end,
        displayUntil: end + 280,
      });
      currentGroup = [];
    };

    for (let i = 0; i < sortedWords.length; i++) {
      const w = sortedWords[i];
      const prevW = currentGroup[currentGroup.length - 1];

      const hasPunctuation = prevW && /[.!?,\u0964|\n]/.test(prevW.text);
      const isTimeGap = prevW && w.start - prevW.end > 450;
      const isMaxWords = currentGroup.length >= 4;

      if (currentGroup.length > 0 && (hasPunctuation || isTimeGap || isMaxWords)) {
        flushGroup();
      }

      currentGroup.push(w);
    }
    flushGroup();

    // Fine-tune display intervals to prevent overlaps and hide captions during speech pauses
    for (let i = 0; i < result.length; i++) {
      const nextPhrase = result[i + 1];
      if (nextPhrase) {
        const gap = nextPhrase.start - result[i].end;
        if (gap <= 350 && gap > 0) {
          result[i].displayUntil = nextPhrase.start;
        } else if (gap <= 0) {
          result[i].displayUntil = Math.max(result[i].end, nextPhrase.start - 10);
        } else {
          // Normal pause in speech: hide caption cleanly after spoken phrase
          result[i].displayUntil = result[i].end + 250;
        }
      } else {
        result[i].displayUntil = result[i].end + 500;
      }
    }

    return result;
  }, [sortedWords]);

  // Find the currently active phrase chunk and accurately synchronized spoken word
  const activePhrase = useMemo(() => {
    if (!phrases || phrases.length === 0) return null;

    // Active phrase match within audio window (with generous 60ms lead-in)
    const current = phrases.find(
      (p) => currentTimeMs >= p.start - 60 && currentTimeMs <= p.displayUntil
    );

    if (current) {
      let activeIdx = -1;

      // 1. Direct word boundary check
      for (let i = 0; i < current.words.length; i++) {
        const w = current.words[i];
        if (currentTimeMs >= w.start && currentTimeMs <= w.end) {
          activeIdx = i;
          break;
        }
      }

      // 2. Smooth micro-gap handover between words
      if (activeIdx === -1) {
        if (currentTimeMs < current.words[0].start) {
          activeIdx = 0;
        } else {
          for (let i = current.words.length - 1; i >= 0; i--) {
            if (currentTimeMs >= current.words[i].start) {
              activeIdx = i;
              break;
            }
          }
          if (activeIdx === -1) activeIdx = 0;
        }
      }

      return {
        phrase: current,
        activeWordIdx: activeIdx,
      };
    }

    // Fallback: If video is paused right before the first phrase
    if (currentTimeMs < phrases[0].start && !isPlaying && durationMs > 0) {
      return {
        phrase: phrases[0],
        activeWordIdx: 0,
      };
    }

    return null;
  }, [phrases, currentTimeMs, isPlaying, durationMs]);

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

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || durationMs <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    const newTimeMs = Math.round(percentage * durationMs);
    videoRef.current.currentTime = newTimeMs / 1000;
    setCurrentTimeMs(newTimeMs);
    onTimeUpdateRef.current?.(newTimeMs);
  };

  return (
    <div className="w-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm relative aspect-video flex items-center justify-center group select-none">
      {!videoUrl ? (
        /* Empty / Placeholder State */
        <div className="text-center p-6 flex flex-col items-center justify-center">
          <div className="flex items-center gap-1.5 text-white font-bold text-2xl tracking-tight mb-1">
            <span>AutoCaption</span>
            <span className="text-blue-500">X</span>
          </div>
          <p className="text-xs text-slate-400 font-medium">5GB Support • Real-time AI Precision Sync</p>
        </div>
      ) : (
        /* Video Player + Subtitle Overlay */
        <div className="w-full h-full relative flex items-center justify-center bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            preload="auto"
            playsInline
            controls={false}
            loop={false}
            muted={isMuted}
            onClick={handleTogglePlay}
            className="w-full h-full object-contain cursor-pointer"
          />

          {/* Buffering Indicator */}
          {isBuffering && (
            <div className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-black/70 backdrop-blur-xs flex items-center justify-center z-15 pointer-events-none">
              <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
            </div>
          )}

          {/* Center Play Button Overlay when Paused */}
          {!isPlaying && !isBuffering && (
            <button
              type="button"
              onClick={handleTogglePlay}
              className="absolute inset-0 m-auto w-14 h-14 rounded-full bg-black/65 hover:bg-blue-600/90 border border-white/20 text-white flex items-center justify-center backdrop-blur-xs transition-all shadow-2xl hover:scale-110 active:scale-95 cursor-pointer z-10 pointer-events-auto"
              title="Play Video"
            >
              <Play className="w-6 h-6 fill-white translate-x-0.5" />
            </button>
          )}

          {/* Synchronized Subtitles Overlay */}
          {activePhrase && activePhrase.phrase.words.length > 0 && !isGenerating && (
            <div className="absolute bottom-12 inset-x-0 flex justify-center px-4 pointer-events-none z-20">
              <div className="bg-black/85 backdrop-blur-md px-5 py-3 rounded-2xl border border-white/20 shadow-[0_10px_35px_rgba(0,0,0,0.8)] flex items-center justify-center flex-wrap gap-2.5 text-center max-w-lg transition-all duration-75 animate-in fade-in zoom-in-95">
                {activePhrase.phrase.words.map((w, idx) => {
                  const isCurrent = idx === activePhrase.activeWordIdx;
                  const isPast = idx < activePhrase.activeWordIdx;
                  const isLatin = /^[A-Za-z0-9\s.,!?'"%-]+$/.test(w.text || '');
                  return (
                    <span
                      key={`${w.text}-${w.start}-${idx}`}
                      className={`text-base sm:text-lg md:text-2xl font-black tracking-wide transition-all duration-75 drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)] ${
                        isLatin ? 'uppercase' : ''
                      } ${getWordStyle(isCurrent, isPast)}`}
                      style={{
                        WebkitTextStroke: isCurrent ? '1.2px #000' : '0.6px #000',
                        fontFamily: '"Montserrat", "Noto Sans Devanagari", "Plus Jakarta Sans", sans-serif',
                      }}
                    >
                      {w.text}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Hover Custom Controls with Seekbar */}
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-30">
            {/* Seekbar */}
            <div
              onClick={handleProgressBarClick}
              className="w-full h-1.5 bg-white/20 hover:h-2.5 rounded-full cursor-pointer transition-all relative overflow-hidden"
            >
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-75"
                style={{
                  width: `${durationMs > 0 ? (currentTimeMs / durationMs) * 100 : 0}%`,
                }}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  className="p-1.5 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors cursor-pointer"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (videoRef.current) {
                      videoRef.current.currentTime = 0;
                      setCurrentTimeMs(0);
                      onTimeUpdateRef.current?.(0);
                    }
                  }}
                  className="p-1.5 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors cursor-pointer"
                  title="Replay from start"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (videoRef.current) {
                      videoRef.current.muted = !isMuted;
                      setIsMuted(!isMuted);
                    }
                  }}
                  className="p-1.5 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors cursor-pointer"
                >
                  {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
              </div>

              {words.length > 0 && (
                <span className="text-[11px] font-bold text-blue-300 bg-blue-950/80 px-2.5 py-0.5 rounded-full border border-blue-800/80 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-blue-400" /> {words.length} words synced
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
