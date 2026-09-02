import type { CaptionWord, CaptionPreset, VideoResolution } from '../types';
import { generateSRT, generateWebVTT } from '../utils/captionConverters';

export interface RenderProgressCallback {
  (percentage: number, statusText: string): void;
}

// Generate SubRip (.srt) subtitles file with precision millisecond alignment
export function generateSrtContent(words: CaptionWord[]): string {
  return generateSRT(words);
}

// Helper to determine exact finite duration of any video blob or source
async function getAccurateVideoDuration(video: HTMLVideoElement): Promise<number> {
  if (video.duration && !isNaN(video.duration) && video.duration !== Infinity && video.duration > 0.1) {
    return video.duration;
  }

  return new Promise<number>((resolve) => {
    const handleSeeked = () => {
      video.removeEventListener('seeked', handleSeeked);
      const accurateDur = video.duration && !isNaN(video.duration) && video.duration !== Infinity
        ? video.duration
        : video.currentTime > 0
        ? video.currentTime
        : 10;
      video.currentTime = 0;
      resolve(accurateDur);
    };

    video.addEventListener('seeked', handleSeeked, { once: true });
    // Seek to a large number to force browser to calculate true duration for webm/mp4 blobs
    video.currentTime = 1e6;
  });
}

// Fast O(log N) Binary Search for active subtitle phrase matching audio currentTime bounds
// Automatically clears previous caption text immediately when currentTime > caption.endTime or during pauses
function findActivePhraseIndex(
  phrases: Array<{ words: CaptionWord[]; start: number; end: number }>,
  curMs: number
): number {
  if (!phrases || phrases.length === 0) return -1;
  if (curMs < phrases[0].start - 40 || curMs > phrases[phrases.length - 1].end + 80) {
    return -1;
  }

  let low = 0;
  let high = phrases.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const phrase = phrases[mid];

    if (curMs >= phrase.start - 40 && curMs <= phrase.end + 80) {
      return mid;
    }

    if (curMs < phrase.start - 40) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return -1;
}

// Export 100% Full-Length Burned-In Captioned Video
export async function renderCaptionedVideo(
  videoSourceUrl: string,
  words: CaptionWord[],
  preset: CaptionPreset = 'hormozi',
  resolution: VideoResolution = '1080p',
  onProgress?: RenderProgressCallback
): Promise<Blob> {
  return new Promise(async (resolve, reject) => {
    // Sandbox container to keep media pipeline active & unthrottled in browser
    let sandboxContainer: HTMLDivElement | null = null;
    let animId: number | null = null;
    let checkIntervalId: any = null;
    let audioCtx: AudioContext | null = null;

    const cleanup = () => {
      if (animId) cancelAnimationFrame(animId);
      if (checkIntervalId) clearInterval(checkIntervalId);
      if (audioCtx && audioCtx.state !== 'closed') {
        try {
          audioCtx.close();
        } catch (e) {}
      }
      if (sandboxContainer && sandboxContainer.parentNode) {
        sandboxContainer.parentNode.removeChild(sandboxContainer);
      }
    };

    try {
      onProgress?.(5, 'Initializing high-fidelity render engine...');

      sandboxContainer = document.createElement('div');
      sandboxContainer.style.position = 'fixed';
      sandboxContainer.style.top = '-9999px';
      sandboxContainer.style.left = '-9999px';
      sandboxContainer.style.opacity = '0';
      sandboxContainer.style.pointerEvents = 'none';
      sandboxContainer.style.zIndex = '-9999';
      document.body.appendChild(sandboxContainer);

      // 1. Create video element in sandbox
      const video = document.createElement('video');
      video.src = videoSourceUrl;
      video.crossOrigin = 'anonymous';
      video.playsInline = true;
      video.muted = false;
      video.preload = 'auto';
      sandboxContainer.appendChild(video);

      await new Promise<void>((res, rej) => {
        const onLoaded = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          res();
        };
        video.addEventListener('loadedmetadata', onLoaded);
        video.onerror = () => rej(new Error('Unable to read video stream for rendering'));
        if (video.readyState >= 1) res();
      });

      // Calculate 100% accurate video duration
      const totalVideoDuration = await getAccurateVideoDuration(video);

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
      sandboxContainer.appendChild(canvas);

      const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
      if (!ctx) {
        throw new Error('Canvas 2D context is not available');
      }

      onProgress?.(12, 'Synthesizing subtitle layers...');

      // 2. Setup audio routing
      const stream = canvas.captureStream(30);

      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          audioCtx = new AudioContextClass();
          const sourceNode = audioCtx.createMediaElementSource(video);
          const destNode = audioCtx.createMediaStreamDestination();
          sourceNode.connect(destNode);
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

      // 3. Group words into subtitle chunks with chronological order
      const sortedWords = [...words]
        .filter((w) => Boolean(w && w.text && w.text.trim()))
        .map((w, idx) => ({
          ...w,
          start: typeof w.start === 'number' && !isNaN(w.start) ? Math.max(0, w.start) : idx * 300,
          end: typeof w.end === 'number' && !isNaN(w.end) ? Math.max(w.start + 100, w.end) : (idx + 1) * 300,
        }))
        .sort((a, b) => a.start - b.start);
      const phrases: Array<{
        words: CaptionWord[];
        start: number;
        end: number;
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
        });
        currentGroup = [];
      };

      for (let i = 0; i < sortedWords.length; i++) {
        const w = sortedWords[i];
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

      // 4. Setup MediaRecorder with best supported mimeType
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

      let isCompleted = false;

      const finishExport = () => {
        if (isCompleted) return;
        isCompleted = true;
        cleanup();

        try {
          if (recorder.state === 'recording') {
            recorder.requestData();
            recorder.stop();
          }
        } catch (e) {}
      };

      recorder.onstop = () => {
        const finalBlob = new Blob(recordedChunks, {
          type: selectedMimeType || 'video/mp4',
        });
        onProgress?.(100, 'Captioned video ready!');
        resolve(finalBlob);
      };

      recorder.onerror = (recErr) => {
        cleanup();
        reject(recErr);
      };

      // 5. High-Precision Render Loop
      const drawFrame = () => {
        if (isCompleted) return;

        // Check if video has reached its real complete end
        if (video.ended || (video.currentTime >= totalVideoDuration - 0.05 && video.currentTime > 0.5)) {
          ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
          const curMs = Math.round(video.currentTime * 1000);
          const pIdx = findActivePhraseIndex(phrases, curMs);
          if (pIdx !== -1) {
            renderSubtitlesOnCanvas(ctx, phrases[pIdx], curMs, preset, targetWidth, targetHeight);
          }

          onProgress?.(99, 'Finalizing video stream...');
          setTimeout(finishExport, 250);
          return;
        }

        // Draw current video frame to canvas
        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

        // Find active subtitle with binary search and burn it onto canvas
        const curMs = Math.round(video.currentTime * 1000);
        const pIdx = findActivePhraseIndex(phrases, curMs);
        if (pIdx !== -1) {
          renderSubtitlesOnCanvas(ctx, phrases[pIdx], curMs, preset, targetWidth, targetHeight);
        }

        const pct = Math.min(98, Math.round((video.currentTime / Math.max(1, totalVideoDuration)) * 85) + 12);
        onProgress?.(pct, `Burning captions into video... (${Math.round(video.currentTime)}s / ${Math.round(totalVideoDuration)}s)`);

        animId = requestAnimationFrame(drawFrame);
      };

      // Start recording
      recorder.start(100);
      video.currentTime = 0;

      video.onended = () => {
        setTimeout(finishExport, 200);
      };

      await video.play();
      animId = requestAnimationFrame(drawFrame);

      // Safety check interval to ensure rendering never stalls if RAF throttles
      checkIntervalId = setInterval(() => {
        if (isCompleted) return;
        if (video.ended || (video.currentTime >= totalVideoDuration - 0.05 && video.currentTime > 0.5)) {
          finishExport();
        }
      }, 500);

    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

// Helper to draw styled subtitle presets directly onto the video canvas with multi-line wrap
function renderSubtitlesOnCanvas(
  ctx: CanvasRenderingContext2D,
  phrase: { words: CaptionWord[]; start: number; end: number },
  curMs: number,
  preset: CaptionPreset,
  width: number,
  height: number
) {
  if (!phrase || !phrase.words || phrase.words.length === 0) return;

  ctx.save();

  const isVertical = height > width;
  const totalChars = phrase.words.reduce((sum, item) => sum + (item.text || '').length, 0);
  const charScale = totalChars > 22 ? 0.85 : 1;
  const baseFontSize = isVertical
    ? Math.max(20, Math.round(width * 0.052 * charScale))
    : Math.max(22, Math.round(height * 0.062 * charScale));
  const posY = height * 0.85; // Lower-third (bottom: 15%)

  // Active word index matching audio bounds precisely
  let activeWordIdx = 0;
  for (let i = 0; i < phrase.words.length; i++) {
    const w = phrase.words[i];
    const nextW = phrase.words[i + 1];
    const wordEndBound = nextW ? nextW.start : w.end + 150;

    if (curMs >= w.start && curMs < wordEndBound) {
      activeWordIdx = i;
      break;
    } else if (curMs >= w.end) {
      activeWordIdx = i;
    }
  }
  activeWordIdx = Math.max(0, Math.min(phrase.words.length - 1, activeWordIdx));

  const fontFamily =
    preset === 'hormozi'
      ? 'Montserrat, Impact, Arial, sans-serif'
      : preset === 'beast'
      ? 'Poppins, Arial Black, sans-serif'
      : 'Plus Jakarta Sans, sans-serif';

  ctx.font = `900 ${baseFontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const spacing = isVertical ? Math.round(width * 0.02) : Math.round(width * 0.015);
  const maxLineWidth = width * 0.82;

  // Measure all words with styles
  const wordMetrics = phrase.words.map((w, idx) => {
    const text = w.text;
    const isCurrent = idx === activeWordIdx;
    const fontSize = isCurrent ? Math.round(baseFontSize * 1.15) : baseFontSize;
    ctx.font = `900 ${fontSize}px ${fontFamily}`;
    const textWidth = ctx.measureText(text).width;
    return { text, textWidth, fontSize, isCurrent, idx };
  });

  // Split words into lines if needed so they never push off screen
  const lines: Array<typeof wordMetrics> = [];
  let currentLine: typeof wordMetrics = [];
  let currentLineWidth = 0;

  for (const item of wordMetrics) {
    const itemTotal = item.textWidth + (currentLine.length > 0 ? spacing : 0);
    if (currentLine.length > 0 && currentLineWidth + itemTotal > maxLineWidth) {
      lines.push(currentLine);
      currentLine = [item];
      currentLineWidth = item.textWidth;
    } else {
      currentLine.push(item);
      currentLineWidth += itemTotal;
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  // Calculate pill dimensions covering all lines
  const lineHeight = Math.round(baseFontSize * 1.45);
  const totalContentHeight = lines.length * lineHeight;
  const maxLineW = Math.max(...lines.map((l) => l.reduce((s, w) => s + w.textWidth, 0) + (l.length - 1) * spacing));

  const paddingX = Math.round(baseFontSize * 0.85);
  const paddingY = Math.round(baseFontSize * 0.45);
  const pillWidth = maxLineW + paddingX * 2;
  const pillHeight = totalContentHeight + paddingY * 2;
  const pillX = (width - pillWidth) / 2;
  const pillY = posY - pillHeight / 2;
  const borderRadius = Math.round(baseFontSize * 0.35);

  // Background Box
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillWidth, pillHeight, borderRadius);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, Math.round(baseFontSize * 0.04));
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.stroke();

  // Draw lines
  let startLineY = pillY + paddingY + lineHeight / 2;

  lines.forEach((lineWords) => {
    const lineWidth = lineWords.reduce((s, w) => s + w.textWidth, 0) + (lineWords.length - 1) * spacing;
    let curX = (width - lineWidth) / 2;

    lineWords.forEach((w) => {
      const wordCenterX = curX + w.textWidth / 2;
      ctx.font = `900 ${w.fontSize}px ${fontFamily}`;

      if (preset === 'hormozi') {
        if (w.isCurrent) {
          // Glowing Active Box
          const hlPaddingX = Math.round(w.fontSize * 0.22);
          const hlPaddingY = Math.round(w.fontSize * 0.12);
          const hlW = w.textWidth + hlPaddingX * 2;
          const hlH = w.fontSize * 1.3;
          const hlX = curX - hlPaddingX;
          const hlY = startLineY - hlH / 2;

          ctx.beginPath();
          ctx.roundRect(hlX, hlY, hlW, hlH, Math.round(w.fontSize * 0.2));
          ctx.fillStyle = 'rgba(234, 179, 8, 0.35)';
          ctx.fill();

          // Active Word (Bright Yellow)
          ctx.fillStyle = '#fde047';
          ctx.shadowColor = 'rgba(234, 179, 8, 0.85)';
          ctx.shadowBlur = Math.round(w.fontSize * 0.3);
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
        }
        ctx.lineWidth = Math.max(2, Math.round(w.fontSize * 0.08));
        ctx.strokeStyle = '#000000';
        ctx.strokeText(w.text, wordCenterX, startLineY);
        ctx.fillText(w.text, wordCenterX, startLineY);

      } else if (preset === 'neon') {
        if (w.isCurrent) {
          ctx.fillStyle = '#67e8f9';
          ctx.shadowColor = 'rgba(34, 211, 238, 0.95)';
          ctx.shadowBlur = Math.round(w.fontSize * 0.4);
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
        }
        ctx.lineWidth = Math.max(2, Math.round(w.fontSize * 0.08));
        ctx.strokeStyle = '#000000';
        ctx.strokeText(w.text, wordCenterX, startLineY);
        ctx.fillText(w.text, wordCenterX, startLineY);

      } else if (preset === 'beast') {
        if (w.isCurrent) {
          ctx.fillStyle = '#4ade80';
          ctx.shadowColor = 'rgba(74, 222, 128, 0.9)';
          ctx.shadowBlur = Math.round(w.fontSize * 0.35);
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
        }
        ctx.lineWidth = Math.max(2, Math.round(w.fontSize * 0.08));
        ctx.strokeStyle = '#000000';
        ctx.strokeText(w.text, wordCenterX, startLineY);
        ctx.fillText(w.text, wordCenterX, startLineY);

      } else {
        // Clean Preset
        if (w.isCurrent) {
          ctx.fillStyle = '#38bdf8';
        } else {
          ctx.fillStyle = '#ffffff';
        }
        ctx.lineWidth = Math.max(1.5, Math.round(w.fontSize * 0.05));
        ctx.strokeStyle = '#000000';
        ctx.strokeText(w.text, wordCenterX, startLineY);
        ctx.fillText(w.text, wordCenterX, startLineY);
      }

      curX += w.textWidth + spacing;
    });

    startLineY += lineHeight;
  });

  ctx.restore();
}
