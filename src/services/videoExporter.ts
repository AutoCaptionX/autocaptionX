import type { CaptionWord, CaptionPreset, VideoResolution } from '../types';

export interface RenderProgressCallback {
  (percentage: number, statusText: string): void;
}

// Generate SubRip (.srt) subtitles file
export function generateSrtContent(words: CaptionWord[]): string {
  if (!words || words.length === 0) return '';

  // Group into subtitle lines (4-5 words or pauses)
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
    if (current.length >= 5 || (prev && w.start - prev.end > 600)) {
      flush();
    }
    current.push(w);
  }
  flush();

  const formatSrtTime = (ms: number): string => {
    const date = new Date(ms);
    const hours = Math.floor(ms / 3600000).toString().padStart(2, '0');
    const minutes = Math.floor((ms % 3600000) / 60000).toString().padStart(2, '0');
    const seconds = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
    const millis = (ms % 1000).toString().padStart(3, '0');
    return `${hours}:${minutes}:${seconds},${millis}`;
  };

  return phrases
    .map((p, idx) => {
      const lineText = p.words.map((w) => w.text).join(' ');
      return `${idx + 1}\n${formatSrtTime(p.start)} --> ${formatSrtTime(p.end + 500)}\n${lineText}\n`;
    })
    .join('\n');
}

// Export Burned-In Captioned Video using Canvas & MediaRecorder
export async function renderCaptionedVideo(
  videoSourceUrl: string,
  words: CaptionWord[],
  preset: CaptionPreset = 'hormozi',
  resolution: VideoResolution = '1080p',
  onProgress?: RenderProgressCallback
): Promise<Blob> {
  return new Promise(async (resolve, reject) => {
    try {
      onProgress?.(5, 'Preparing video and subtitle layers...');

      // 1. Create offscreen video element
      const video = document.createElement('video');
      video.src = videoSourceUrl;
      video.crossOrigin = 'anonymous';
      video.playsInline = true;
      video.muted = false;

      await new Promise<void>((res, rej) => {
        video.onloadedmetadata = () => res();
        video.onerror = () => rej(new Error('Failed to load video file for processing'));
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

      onProgress?.(15, 'Binding video audio track...');

      // 2. Setup Audio stream & Canvas Video stream
      const stream = canvas.captureStream(30);

      // Attempt to attach audio track
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const sourceNode = audioCtx.createMediaElementSource(video);
        const destNode = audioCtx.createMediaStreamDestination();
        sourceNode.connect(destNode);
        sourceNode.connect(audioCtx.destination);
        const audioTracks = destNode.stream.getAudioTracks();
        if (audioTracks.length > 0) {
          stream.addTrack(audioTracks[0]);
        }
      } catch (audioErr) {
        console.warn('Audio capture note (silent or direct stream):', audioErr);
        try {
          const directCapture = (video as any).captureStream ? (video as any).captureStream() : null;
          if (directCapture && directCapture.getAudioTracks().length > 0) {
            stream.addTrack(directCapture.getAudioTracks()[0]);
          }
        } catch (e) {}
      }

      // Group words into phrases for rendering
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
          displayUntil: end + 2500,
        });
        currentGroup = [];
      };

      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const prevW = currentGroup[currentGroup.length - 1];
        const hasPunct = prevW && /[.!?,\u0964|\n]/.test(prevW.text);
        const isTimeGap = prevW && w.start - prevW.end > 650;
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
          phrases[i].displayUntil = Math.min(next.start, phrases[i].end + 2500);
        } else {
          phrases[i].displayUntil = phrases[i].end + 3500;
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

      // Draw Loop
      const videoDuration = video.duration || 1;
      let animId: number;

      const drawFrame = () => {
        if (video.ended || video.currentTime >= videoDuration) {
          cancelAnimationFrame(animId);
          recorder.stop();
          return;
        }

        // Draw Video Frame
        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

        // Find active subtitle
        const curMs = video.currentTime * 1000;
        const currentPhrase = phrases.find((p) => curMs >= p.start && curMs <= p.displayUntil);

        if (currentPhrase) {
          renderSubtitlesOnCanvas(ctx, currentPhrase, curMs, preset, targetWidth, targetHeight);
        }

        const pct = Math.min(99, Math.round((video.currentTime / videoDuration) * 90) + 10);
        onProgress?.(pct, `Burning captions into video... (${Math.round(video.currentTime)}s / ${Math.round(videoDuration)}s)`);

        animId = requestAnimationFrame(drawFrame);
      };

      recorder.start(250);
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

// Helper to draw styled subtitle presets onto canvas
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
  const baseFontSize = isVertical ? Math.round(width * 0.065) : Math.round(height * 0.075);
  const posY = isVertical ? height * 0.76 : height * 0.82;

  // Active word index
  let activeWordIdx = phrase.words.findIndex((w) => curMs >= w.start && curMs <= w.end);
  if (activeWordIdx === -1) {
    for (let i = phrase.words.length - 1; i >= 0; i--) {
      if (curMs >= phrase.words[i].start) {
        activeWordIdx = i;
        break;
      }
    }
  }

  const fontFamily =
    preset === 'hormozi'
      ? 'Montserrat, Impact, sans-serif'
      : preset === 'beast'
      ? 'Poppins, Arial Black, sans-serif'
      : 'Plus Jakarta Sans, sans-serif';

  ctx.font = `900 ${baseFontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Measure word widths for precise horizontal placement
  const wordMetrics = phrase.words.map((w) => ({
    text: preset === 'hormozi' || preset === 'beast' ? w.text.toUpperCase() : w.text,
    width: ctx.measureText(preset === 'hormozi' || preset === 'beast' ? w.text.toUpperCase() : w.text).width,
  }));

  const spacing = baseFontSize * 0.35;
  const totalWidth = wordMetrics.reduce((sum, m) => sum + m.width, 0) + (wordMetrics.length - 1) * spacing;
  let startX = (width - totalWidth) / 2;

  // Render Backdrop Badge if Beast or Cyberpunk
  if (preset === 'beast') {
    const padX = 24;
    const padY = 16;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.beginPath();
    ctx.roundRect(startX - padX, posY - baseFontSize / 2 - padY, totalWidth + padX * 2, baseFontSize + padY * 2, 16);
    ctx.fill();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Draw each word
  wordMetrics.forEach((m, idx) => {
    const isCurrent = idx === activeWordIdx;
    const isPast = idx < activeWordIdx;
    const wordCenterX = startX + m.width / 2;

    ctx.save();

    if (preset === 'hormozi') {
      // Alex Hormozi Style: High contrast, thick outline, bright yellow for active
      ctx.lineWidth = Math.max(6, Math.round(baseFontSize * 0.18));
      ctx.strokeStyle = '#000000';
      ctx.strokeText(m.text, wordCenterX, posY);

      if (isCurrent) {
        ctx.fillStyle = '#facc15'; // Vibrant Yellow
      } else if (isPast) {
        ctx.fillStyle = '#ffffff';
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      }
      ctx.fillText(m.text, wordCenterX, posY);
    } else if (preset === 'neon') {
      // Neon Glow
      if (isCurrent) {
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur = 24;
        ctx.fillStyle = '#22d3ee';
      } else {
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#ffffff';
      }
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000000';
      ctx.strokeText(m.text, wordCenterX, posY);
      ctx.fillText(m.text, wordCenterX, posY);
    } else if (preset === 'beast') {
      // MrBeast Style
      ctx.lineWidth = Math.max(5, Math.round(baseFontSize * 0.15));
      ctx.strokeStyle = '#000000';
      ctx.strokeText(m.text, wordCenterX, posY);

      if (isCurrent) {
        ctx.fillStyle = '#22c55e'; // Bright Green
      } else {
        ctx.fillStyle = '#ffffff';
      }
      ctx.fillText(m.text, wordCenterX, posY);
    } else {
      // Minimal / Clean Subtitles
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
