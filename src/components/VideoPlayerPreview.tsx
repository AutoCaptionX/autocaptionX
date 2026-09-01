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
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [durationMs, setDurationMs] = useState(0);

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

    // Fine-tune display intervals to prevent overlaps and ensure continuous smooth caption display
    for (let i = 0; i < result.length; i++) {
      const nextPhrase = result[i + 1];
      if (nextPhrase) {
        const gap = nextPhrase.start - result[i].end;
        if (gap <= 400 && gap > 0) {
          result[i].displayUntil = nextPhrase.start;
        } else if (gap <= 0) {
          result[i].displayUntil = Math.max(result[i].end, nextPhrase.start - 5);
        } else {
          result[i].displayUntil = result[i].end + 300;
        }
      } else {
        result[i].displayUntil = result[i].end + 600;
      }
    }

    return result;
  }, [sortedWords]);

  // Fast Binary Search to locate active phrase index in O(log N) instead of O(N) for long videos
  const findPhraseIndex = useCallback((curMs: number): number => {
    if (!phrases || phrases.length === 0) return -1;

    let low = 0;
    let high = phrases.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const p = phrases[mid];

      // Instant millisecond matching window
      if (curMs >= p.start - 25 && curMs <= p.displayUntil) {
        return mid;
      }

      if (curMs < p.start - 25) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    return -1;
  }, [phrases]);

  // Synchronize external seek (e.g. from timeline editor)
  useEffect(() => {
    if (seekTimeMs !== null && videoRef.current) {
      const targetSec = Math.max(0, seekTimeMs / 1000);
      videoRef.current.currentTime = targetSec;
      
      const pIdx = findPhraseIndex(seekTimeMs);
      if (pIdx !== -1) {
        const p = phrases[pIdx];
        let wIdx = 0;
        for (let i = 0; i < p.words.length; i++) {
          if (seekTimeMs >= p.words[i].start) wIdx = i;
        }
        setActiveSubtitle({ phraseIndex: pIdx, activeWordIdx: wIdx });
        lastActiveWordRef.current = { phraseIndex: pIdx, wordIdx: wIdx };
      } else {
        setActiveSubtitle(null);
        lastActiveWordRef.current = null;
      }

      onTimeUpdateRef.current?.(seekTimeMs);
    }
  }, [seekTimeMs, findPhraseIndex, phrases]);

  // High-performance RAF playback loop that NEVER causes React re-render lag
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let animFrameId: number;

    const checkSubtitleSync = () => {
      if (video && !video.paused) {
        const curMs = Math.round(video.currentTime * 1000);

        // Update seekbar DOM directly with zero React overhead
        if (progressBarRef.current && video.duration > 0) {
          const pct = Math.min(100, Math.max(0, (video.currentTime / video.duration) * 100));
          progressBarRef.current.style.width = `${pct}%`;
        }

        // Fast O(log N) Phrase Match
        const phraseIdx = findPhraseIndex(curMs);
        if (phraseIdx !== -1) {
          const currentPhrase = phrases[phraseIdx];
          let wordIdx = 0;

          for (let i = 0; i < currentPhrase.words.length; i++) {
            const w = currentPhrase.words[i];
            if (curMs >= w.start && curMs <= w.end) {
              wordIdx = i;
              break;
            }
            if (curMs >= w.start) {
              wordIdx = i;
            }
          }

          // Only trigger React state change if the word or phrase actually changed!
          const last = lastActiveWordRef.current;
          if (!last || last.phraseIndex !== phraseIdx || last.wordIdx !== wordIdx) {
            lastActiveWordRef.current = { phraseIndex: phraseIdx, wordIdx };
            setActiveSubtitle({ phraseIndex: phraseIdx, activeWordIdx: wordIdx });
          }
        } else {
          if (lastActiveWordRef.current !== null) {
            lastActiveWordRef.current = null;
            setActiveSubtitle(null);
          }
        }

        // Throttle parent onTimeUpdate to 160ms for smooth timeline list indicator
        const now = performance.now();
        if (now - lastParentUpdateTimeRef.current > 160) {
          lastParentUpdateTimeRef.current = now;
          onTimeUpdateRef.current?.(curMs);
        }
      }

      animFrameId = requestAnimationFrame(checkSubtitleSync);
    };

    const handleLoadedMetadata = () => {
      if (video.duration && !isNaN(video.duration) && video.duration !== Infinity) {
        setDurationMs(Math.round(video.duration * 1000));
      }
      setIsBuffering(false);
    };

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
      if (video) {
        const curMs = Math.round(video.currentTime * 1000);
        onTimeUpdateRef.current?.(curMs);
      }
    };

    const handleWaiting = () => setIsBuffering(true);
    const handleCanPlay = () => setIsBuffering(false);

    const handleSeeked = () => {
      if (video) {
        const curMs = Math.round(video.currentTime * 1000);
        if (progressBarRef.current && video.duration > 0) {
          const pct = Math.min(100, Math.max(0, (video.currentTime / video.duration) * 100));
          progressBarRef.current.style.width = `${pct}%`;
        }
        const pIdx = findPhraseIndex(curMs);
        if (pIdx !== -1) {
          const p = phrases[pIdx];
          let wIdx = 0;
          for (let i = 0; i < p.words.length; i++) {
            if (curMs >= p.words[i].start) wIdx = i;
          }
          setActiveSubtitle({ phraseIndex: pIdx, activeWordIdx: wIdx });
          lastActiveWordRef.current = { phraseIndex: pIdx, wordIdx: wIdx };
        } else {
          setActiveSubtitle(null);
          lastActiveWordRef.current = null;
        }
        onTimeUpdateRef.current?.(curMs);
      }
      setIsBuffering(false);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setIsBuffering(false);
      cancelAnimationFrame(animFrameId);
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('play', handlePlay);
    video.addEventListener('playing', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('ended', handleEnded);

    if (video.duration && !isNaN(video.duration) && video.duration !== Infinity) {
      setDurationMs(Math.round(video.duration * 1000));
    }

    return () => {
      cancelAnimationFrame(animFrameId);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('playing', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('ended', handleEnded);
    };
  }, [videoUrl, phrases, findPhraseIndex]);

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

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || durationMs <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    const newTimeSec = percentage * (durationMs / 1000);
    videoRef.current.currentTime = newTimeSec;
    const newTimeMs = Math.round(newTimeSec * 1000);
    if (progressBarRef.current) {
      progressBarRef.current.style.width = `${percentage * 100}%`;
    }
    onTimeUpdateRef.current?.(newTimeMs);
  };

  const currentActivePhrase = activeSubtitle !== null && phrases[activeSubtitle.phraseIndex]
    ? phrases[activeSubtitle.phraseIndex]
    : null;

  return (
    <div className="w-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm relative aspect-video flex items-center justify-center group select-none">
      {!videoUrl ? (
        <div className="text-center p-6 flex flex-col items-center justify-center">
          <div className="flex items-center gap-1.5 text-white font-bold text-2xl tracking-tight mb-1">
            <span>AutoCaption</span>
            <span className="text-blue-500">X</span>
          </div>
          <p className="text-xs text-slate-400 font-medium">5GB Support • Real-time AI Precision Sync</p>
        </div>
      ) : (
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

          {isBuffering && (
            <div className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-black/70 backdrop-blur-xs flex items-center justify-center z-15 pointer-events-none">
              <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
            </div>
          )}

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

          {/* Precision Active Subtitles Overlay */}
          {currentActivePhrase && currentActivePhrase.words.length > 0 && !isGenerating && (
            <div className="absolute bottom-12 inset-x-0 flex justify-center px-4 pointer-events-none z-20">
              <div className="bg-black/85 backdrop-blur-md px-5 py-3 rounded-2xl border border-white/20 shadow-[0_10px_35px_rgba(0,0,0,0.8)] flex items-center justify-center flex-wrap gap-2.5 text-center max-w-lg transition-all duration-75 animate-in fade-in zoom-in-95">
                {currentActivePhrase.words.map((w, idx) => {
                  const isCurrent = activeSubtitle !== null && idx === activeSubtitle.activeWordIdx;
                  const isPast = activeSubtitle !== null && idx < activeSubtitle.activeWordIdx;
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
                ref={progressBarRef}
                className="h-full bg-blue-500 rounded-full w-0"
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
                      if (progressBarRef.current) progressBarRef.current.style.width = '0%';
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
