import type { CaptionWord, CaptionPreset, VideoResolution } from '../types';

export interface RenderProgressCallback {
  (percentage: number, statusText: string): void;
}

// Generate SubRip (.srt) subtitles file
export function generateSrtContent(words: CaptionWord[]): string {
  if (!words || words.length === 0) return '';

  const phrases: Array<{ words: CaptionWord[]; start: number; end: number }> = [];
  let current: CaptionWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    phrases.push({
      words: [...current],
      start: current[0].start,
      end: current[current.length - 1].end,
    });
    current = [];
  };

  for (const w of words) {
    const prev = current[current.length - 1];
    if (current.length >= 4 || (prev && w.start - prev.end > 500)) {
      flush();
    }
    current.push(w);
  }
  flush();

  const formatSrtTime = (ms: number): string => {
    const hours = Math.floor(ms / 3600000).toString().padStart(2, '0');
    const minutes = Math.floor((ms % 3600000) / 60000).toString().padStart(2, '0');
    const seconds = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
    const millis = (ms % 1000).toString().padStart(3, '0');
    return `${hours}:${minutes}:${seconds},${millis}`;
  };

  return phrases
    .map((p, idx) => {
      const lineText = p.words.map((w) => w.text).join(' ');
      return `${idx + 1}\n${formatSrtTime(p.start)} --> ${formatSrtTime(p.end + 250)}\n${lineText}\n`;
    })
    .join('\n');
}

// Export Burned-In Captioned Video using Offscreen Video + Canvas Drawing + MediaRecorder
export async function renderCaptionedVideo(
  videoSourceUrl: string,
  words: CaptionWord[],
  preset: CaptionPreset = 'hormozi',
  resolution: VideoResolution = '1080p',
  onProgress?: RenderProgressCallback
): Promise<Blob> {
  return new Promise(async (resolve, reject) => {
    try {
      onProgress?.(5, 'Preparing video and subtitle render engine...');

      // 1. Create offscreen video element
      const video = document.createElement('video');
      video.src = videoSourceUrl;
      video.crossOrigin = 'anonymous';
      video.playsInline = true;
      video.muted = false;

      await new Promise<void>((res, rej) => {
        const onLoaded = () => {
          video.removeEventListener('loadeddata', onLoaded);
          res();
        };
        video.addEventListener('loadeddata', onLoaded);
        video.onerror = () => rej(new Error('Failed to load video file for processing'));
        if (video.readyState >= 2) res();
      });

      // Target Dimensions based on aspect ratio
      const origWidth = video.videoWidth || 1080;
      const origHeight = video.videoHeight || 1920;
      const isPortrait = origHeight > origWidth;

      let targetWidth = 1080;
      let targetHeight = 1920;

      if (resolution === '720p') {
        targetWidth = isPortrait ? 720 : 1280;
        targetHeight = isPortrait ? 1280 : 720;
      } else if (resolution === '1080p') {
        targetWidth = isPortrait ? 1080 : 1920;
        targetHeight = isPortrait ? 1920 : 1080;
      } else if (resolution === '4k') {
        targetWidth = isPortrait ? 2160 : 3840;
        targetHeight = isPortrait ? 3840 : 2160;
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d', { alpha: false });

      if (!ctx) {
        throw new Error('Canvas 2D context is not supported in this browser');
      }

      onProgress?.(12, 'Synthesizing subtitle layers...');

      // 2. Setup Audio stream & Canvas Video stream
      const stream = canvas.captureStream(30);

      // Attempt to attach original video audio track
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const audioCtx = new AudioContextClass();
          const sourceNode = audioCtx.createMediaElementSource(video);
          const destNode = audioCtx.createMediaStreamDestination();
          sourceNode.connect(destNode);
          sourceNode.connect(audioCtx.destination);
          const audioTracks = destNode.stream.getAudioTracks();
          if (audioTracks.length > 0) {
            stream.addTrack(audioTracks[0]);
          }
        }
      } catch (audioErr) {
        console.warn('Audio node capture notice:', audioErr);
        try {
          const directCapture = (video as any).captureStream ? (video as any).captureStream() : null;
          if (directCapture && directCapture.getAudioTracks().length > 0) {
            stream.addTrack(directCapture.getAudioTracks()[0]);
          }
        } catch (e) {}
      }

      // Group words into subtitle phrases for burn-in
      const phrases: Array<{
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
        phrases.push({
          words: [...currentGroup],
          start,
          end,
          displayUntil: end + 300,
        });
        currentGroup = [];
      };

      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const prevW = currentGroup[currentGroup.length - 1];
        const hasPunct = prevW && /[.!?,\u0964|\n]/.test(prevW.text);
        const isTimeGap = prevW && w.start - prevW.end > 500;
        const isMax = currentGroup.length >= 4;

        if (currentGroup.length > 0 && (hasPunct || isTimeGap || isMax)) {
          flushGroup();
        }
        currentGroup.push(w);
      }
      flushGroup();

      for (let i = 0; i < phrases.length; i++) {
        const next = phrases[i + 1];
        if (next) {
          const gap = next.start - phrases[i].end;
          if (gap <= 400 && gap > 0) {
            phrases[i].displayUntil = next.start;
          } else if (gap <= 0) {
            phrases[i].displayUntil = Math.max(phrases[i].end, next.start - 10);
          } else {
            phrases[i].displayUntil = phrases[i].end + 350;
          }
        } else {
          phrases[i].displayUntil = phrases[i].end + 600;
        }
      }

      // 3. Setup MediaRecorder with best supported mimeType
      const mimeTypes = [
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ];
      let selectedMimeType = '';
      for (const t of mimeTypes) {
        if (MediaRecorder.isTypeSupported(t)) {
          selectedMimeType = t;
          break;
        }
      }

      const recorder = new MediaRecorder(stream, {
        mimeType: selectedMimeType || undefined,
        videoBitsPerSecond: resolution === '4k' ? 12000000 : resolution === '1080p' ? 6000000 : 3000000,
      });

      const recordedChunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        const finalBlob = new Blob(recordedChunks, {
          type: selectedMimeType || 'video/mp4',
        });
        onProgress?.(100, 'Captioned video ready!');
        resolve(finalBlob);
      };

      recorder.onerror = (recErr) => {
        reject(recErr);
      };

      // 4. Render & Record Loop
      const videoDuration = video.duration && !isNaN(video.duration) ? video.duration : 1;
      let animId: number;

      const drawFrame = () => {
        if (video.ended || video.currentTime >= videoDuration) {
          cancelAnimationFrame(animId);
          if (recorder.state === 'recording') {
            recorder.stop();
          }
          return;
        }

        // Draw Current Video Frame
        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

        // Find active subtitle and burn it into the canvas
        const curMs = video.currentTime * 1000;
        const currentPhrase = phrases.find((p) => curMs >= p.start && curMs <= p.displayUntil);

        if (currentPhrase) {
          renderSubtitlesOnCanvas(ctx, currentPhrase, curMs, preset, targetWidth, targetHeight);
        }

        const pct = Math.min(99, Math.round((video.currentTime / videoDuration) * 85) + 15);
        onProgress?.(pct, `Burning captions into video... (${Math.round(video.currentTime)}s / ${Math.round(videoDuration)}s)`);

        animId = requestAnimationFrame(drawFrame);
      };

      recorder.start(100);
      video.currentTime = 0;
      await video.play();
      animId = requestAnimationFrame(drawFrame);

      video.onended = () => {
        cancelAnimationFrame(animId);
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      };
    } catch (err) {
      reject(err);
    }
  });
}

// Helper to draw styled subtitle presets directly onto the video canvas
function renderSubtitlesOnCanvas(
  ctx: CanvasRenderingContext2D,
  phrase: { words: CaptionWord[]; start: number; end: number },
  curMs: number,
  preset: CaptionPreset,
  width: number,
  height: number
) {
  ctx.save();

  const isVertical = height > width;
  const baseFontSize = isVertical ? Math.round(width * 0.062) : Math.round(height * 0.072);
  const posY = isVertical ? height * 0.78 : height * 0.82;

  // Active word index
  let activeWordIdx = -1;
  for (let i = 0; i < phrase.words.length; i++) {
    const w = phrase.words[i];
    if (curMs >= w.start && curMs <= w.end) {
      activeWordIdx = i;
      break;
    }
  }
  if (activeWordIdx === -1) {
    if (curMs < phrase.words[0].start) {
      activeWordIdx = 0;
    } else {
      for (let i = phrase.words.length - 1; i >= 0; i--) {
        if (curMs >= phrase.words[i].start) {
          activeWordIdx = i;
          break;
        }
      }
      if (activeWordIdx === -1) activeWordIdx = 0;
    }
  }

  const fontFamily =
    preset === 'hormozi'
      ? 'Montserrat, Impact, Arial, sans-serif'
      : preset === 'beast'
      ? 'Poppins, Arial Black, sans-serif'
      : 'Plus Jakarta Sans, sans-serif';

  ctx.font = `900 ${baseFontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Measure word widths for accurate layout
  const wordMetrics = phrase.words.map((w) => {
    const isLatin = /^[A-Za-z0-9\s.,!?'"%-]+$/.test(w.text || '');
    const displayText = (preset === 'hormozi' || preset === 'beast') && isLatin ? w.text.toUpperCase() : w.text;
    return {
      text: displayText,
      width: ctx.measureText(displayText).width,
    };
  });

  const spacing = baseFontSize * 0.32;
  const totalWidth = wordMetrics.reduce((sum, m) => sum + m.width, 0) + (wordMetrics.length - 1) * spacing;
  let startX = (width - totalWidth) / 2;

  // Draw semi-transparent pill backdrop for enhanced contrast
  const padX = Math.round(baseFontSize * 0.7);
  const padY = Math.round(baseFontSize * 0.45);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.beginPath();
  if (typeof (ctx as any).roundRect === 'function') {
    (ctx as any).roundRect(startX - padX, posY - baseFontSize / 2 - padY, totalWidth + padX * 2, baseFontSize + padY * 2, 18);
  } else {
    ctx.rect(startX - padX, posY - baseFontSize / 2 - padY, totalWidth + padX * 2, baseFontSize + padY * 2);
  }
  ctx.fill();
  ctx.strokeStyle = preset === 'beast' ? '#10b981' : preset === 'neon' ? '#06b6d4' : 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Draw each word inside the phrase
  wordMetrics.forEach((m, idx) => {
    const isCurrent = idx === activeWordIdx;
    const isPast = idx < activeWordIdx;
    const wordCenterX = startX + m.width / 2;

    ctx.save();

    if (preset === 'hormozi') {
      // Alex Hormozi: High contrast yellow active highlight
      ctx.lineWidth = Math.max(5, Math.round(baseFontSize * 0.14));
      ctx.strokeStyle = '#000000';
      ctx.strokeText(m.text, wordCenterX, posY);

      if (isCurrent) {
        ctx.fillStyle = '#facc15'; // Vibrant Yellow
      } else if (isPast) {
        ctx.fillStyle = '#ffffff';
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      }
      ctx.fillText(m.text, wordCenterX, posY);
    } else if (preset === 'neon') {
      // Neon Glow Cyan
      if (isCurrent) {
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 20;
        ctx.fillStyle = '#67e8f9';
      } else {
        ctx.fillStyle = '#ffffff';
      }
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000000';
      ctx.strokeText(m.text, wordCenterX, posY);
      ctx.fillText(m.text, wordCenterX, posY);
    } else if (preset === 'beast') {
      // MrBeast Vibrant Green
      ctx.lineWidth = Math.max(5, Math.round(baseFontSize * 0.14));
      ctx.strokeStyle = '#000000';
      ctx.strokeText(m.text, wordCenterX, posY);

      if (isCurrent) {
        ctx.fillStyle = '#34d399'; // Vibrant Green
      } else {
        ctx.fillStyle = '#ffffff';
      }
      ctx.fillText(m.text, wordCenterX, posY);
    } else {
      // Clean Subtitle
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
      ctx.strokeText(m.text, wordCenterX, posY);
      ctx.fillStyle = isCurrent ? '#38bdf8' : '#ffffff';
      ctx.fillText(m.text, wordCenterX, posY);
    }

    ctx.restore();
    startX += m.width + spacing;
  });

  ctx.restore();
}
