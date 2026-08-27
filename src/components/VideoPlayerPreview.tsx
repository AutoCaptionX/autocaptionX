import React, { useRef, useState, useEffect } from 'react';
import { Sparkles, Play, Pause, Volume2, VolumeX, RotateCcw } from 'lucide-react';
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
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  // Synchronize seek from parent (e.g. clicking word in Timeline)
  useEffect(() => {
    if (seekTimeMs !== null && videoRef.current) {
      videoRef.current.currentTime = seekTimeMs / 1000;
      setCurrentTimeMs(seekTimeMs);
      onTimeUpdate?.(seekTimeMs);
    }
  }, [seekTimeMs]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let animFrameId: number;

    const tick = () => {
      if (video && !video.paused) {
        const ms = video.currentTime * 1000;
        setCurrentTimeMs(ms);
        onTimeUpdate?.(ms);
      }
      animFrameId = requestAnimationFrame(tick);
    };

    const handleTimeUpdate = () => {
      const ms = video.currentTime * 1000;
      setCurrentTimeMs(ms);
      onTimeUpdate?.(ms);
    };

    const handleLoadedMetadata = () => {
      if (video.duration && !isNaN(video.duration)) {
        setDurationMs(video.duration * 1000);
      }
    };

    const handlePlay = () => {
      setIsPlaying(true);
      animFrameId = requestAnimationFrame(tick);
    };

    const handlePause = () => {
      setIsPlaying(false);
      cancelAnimationFrame(animFrameId);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      cancelAnimationFrame(animFrameId);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);

    return () => {
      cancelAnimationFrame(animFrameId);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
    };
  }, [videoUrl, onTimeUpdate]);

  // Group words into natural subtitle chunks (3-5 words) covering full timeline
  const phrases = React.useMemo(() => {
    if (!words || words.length === 0) return [];

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
        displayUntil: end + 1500,
      });
      currentGroup = [];
    };

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const prevW = currentGroup[currentGroup.length - 1];

      const hasPunctuation = prevW && /[.!?,\u0964|\n]/.test(prevW.text);
      const isTimeGap = prevW && w.start - prevW.end > 700;
      const isMaxWords = currentGroup.length >= 4;

      if (currentGroup.length > 0 && (hasPunctuation || isTimeGap || isMaxWords)) {
        flushGroup();
      }

      currentGroup.push(w);
    }
    flushGroup();

    // Ensure seamless handovers between phrases across full video duration
    for (let i = 0; i < result.length; i++) {
      const nextPhrase = result[i + 1];
      if (nextPhrase) {
        // If next phrase starts within 2 seconds, keep current phrase visible right until next phrase begins
        if (nextPhrase.start - result[i].end <= 2000) {
          result[i].displayUntil = nextPhrase.start;
        } else {
          result[i].displayUntil = result[i].end + 1800;
        }
      } else {
        // Last phrase stays visible for 3 seconds or until video ends
        result[i].displayUntil = result[i].end + 3000;
      }
    }

    return result;
  }, [words]);

  // Find the currently active phrase chunk and currently spoken word
  const activePhrase = React.useMemo(() => {
    if (!phrases || phrases.length === 0) return null;

    // Direct active phrase match
    const current = phrases.find(
      (p) => currentTimeMs >= p.start && currentTimeMs <= p.displayUntil
    );

    if (current) {
      let activeIdx = current.words.findIndex(
        (w) => currentTimeMs >= w.start && currentTimeMs <= w.end
      );

      // Micro gap handling: highlight the most recently spoken word
      if (activeIdx === -1) {
        for (let i = current.words.length - 1; i >= 0; i--) {
          if (currentTimeMs >= current.words[i].start) {
            activeIdx = i;
            break;
          }
        }
        // If before first word in phrase, highlight word 0
        if (activeIdx === -1) activeIdx = 0;
      }

      return {
        phrase: current,
        activeWordIdx: activeIdx,
      };
    }

    // Fallback: If currentTime is before the very first phrase and video is paused
    if (currentTimeMs < phrases[0].start && !isPlaying) {
      return {
        phrase: phrases[0],
        activeWordIdx: 0,
      };
    }

    // Fallback: If video is past the last phrase but within 3 seconds
    const lastPhrase = phrases[phrases.length - 1];
    if (lastPhrase && currentTimeMs >= lastPhrase.start && currentTimeMs <= lastPhrase.displayUntil) {
      return {
        phrase: lastPhrase,
        activeWordIdx: lastPhrase.words.length - 1,
      };
    }

    return null;
  }, [phrases, currentTimeMs, isPlaying]);

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
    const newTimeMs = percentage * durationMs;
    videoRef.current.currentTime = newTimeMs / 1000;
    setCurrentTimeMs(newTimeMs);
    onTimeUpdate?.(newTimeMs);
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
          <p className="text-xs text-slate-400 font-medium">5GB Support • AI Precision Sync</p>
        </div>
      ) : (
        /* Video Player + Subtitle Overlay */
        <div className="w-full h-full relative flex items-center justify-center bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            playsInline
            controls={false}
            loop={false}
            muted={isMuted}
            onClick={() => {
              if (videoRef.current) {
                if (isPlaying) videoRef.current.pause();
                else videoRef.current.play();
              }
            }}
            className="w-full h-full object-contain cursor-pointer"
          />

          {/* Center Play Button Overlay when Paused */}
          {!isPlaying && (
            <button
              type="button"
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.play();
                }
              }}
              className="absolute inset-0 m-auto w-14 h-14 rounded-full bg-black/60 hover:bg-blue-600/80 border border-white/20 text-white flex items-center justify-center backdrop-blur-xs transition-all shadow-xl hover:scale-105 active:scale-95 cursor-pointer z-10 pointer-events-auto"
              title="Play Video"
            >
              <Play className="w-6 h-6 fill-white translate-x-0.5" />
            </button>
          )}

          {/* Synchronized Subtitles Overlay */}
          {activePhrase && activePhrase.phrase.words.length > 0 && !isGenerating && (
            <div className="absolute bottom-12 inset-x-0 flex justify-center px-4 pointer-events-none z-20">
              <div className="bg-black/85 backdrop-blur-md px-5 py-3 rounded-2xl border border-white/20 shadow-[0_10px_35px_rgba(0,0,0,0.8)] flex items-center justify-center flex-wrap gap-2.5 text-center max-w-lg transition-all duration-150 animate-in fade-in zoom-in-95">
                {activePhrase.phrase.words.map((w, idx) => {
                  const isCurrent = idx === activePhrase.activeWordIdx;
                  const isPast = idx < activePhrase.activeWordIdx;
                  const isLatin = /^[A-Za-z0-9\s.,!?'"%-]+$/.test(w.text || '');
                  return (
                    <span
                      key={`${w.text}-${w.start}-${idx}`}
                      className={`text-base sm:text-lg md:text-2xl font-black tracking-wide transition-all duration-100 drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)] ${
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
                  onClick={() => {
                    if (videoRef.current) {
                      if (isPlaying) videoRef.current.pause();
                      else videoRef.current.play();
                    }
                  }}
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
