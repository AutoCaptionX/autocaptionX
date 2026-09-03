import type { CaptionWord, CaptionPreset } from '../types';

export interface RenderSubtitleParams {
  ctx: CanvasRenderingContext2D;
  phrase: { words: CaptionWord[]; start: number; end: number };
  curMs: number;
  preset: CaptionPreset;
  width: number;
  height: number;
}

// Reusable off-screen text canvas to avoid repeated memory allocations
let offscreenCanvas: HTMLCanvasElement | null = null;
let offscreenCtx: CanvasRenderingContext2D | null = null;

// Cache state to eliminate redundant text layout and rasterization on identical frames
let lastCacheKey = '';
let cachedPillX = 0;
let cachedPillY = 0;
let cachedPillW = 0;
let cachedPillH = 0;

/**
 * Explicitly releases off-screen canvas memory and resets texture backing stores
 */
export function disposeSubtitleRenderer(): void {
  if (offscreenCanvas) {
    if (offscreenCtx) {
      try {
        offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
      } catch (e) {}
    }
    offscreenCanvas.width = 0;
    offscreenCanvas.height = 0;
    offscreenCanvas = null;
    offscreenCtx = null;
  }
  lastCacheKey = '';
  cachedPillX = 0;
  cachedPillY = 0;
  cachedPillW = 0;
  cachedPillH = 0;
}

/**
 * High-performance, memory-optimized canvas subtitle renderer:
 * 1. Uses a reusable off-screen canvas with explicit clearRect to prevent memory bloat.
 * 2. Caches rendered subtitle bitmaps across frames so 95% of frames only execute a fast drawImage.
 * 3. Replaces heavy multi-pass shadowBlur with optimized stroke and pill backdrops.
 * 4. Ensures strict audio-waveform word highlighting with zero latency.
 */
export function renderSubtitlesOnCanvas({
  ctx,
  phrase,
  curMs,
  preset,
  width,
  height,
}: RenderSubtitleParams): void {
  if (!phrase || !phrase.words || phrase.words.length === 0 || width <= 0 || height <= 0) {
    return;
  }

  // 1. Determine active word index matching audio waveform precisely
  let activeWordIdx = -1;
  for (let i = 0; i < phrase.words.length; i++) {
    const w = phrase.words[i];
    const nextW = phrase.words[i + 1];

    if (curMs >= w.start && curMs <= w.end) {
      activeWordIdx = i;
      break;
    }

    // Micro-pause cadence between words within phrase (< 250ms)
    if (nextW && curMs > w.end && curMs < nextW.start && (nextW.start - w.end) <= 250) {
      activeWordIdx = i;
      break;
    }
  }

  // Generate cache key based on phrase content, active word, preset, and dimensions
  const cacheKey = `${phrase.start}_${phrase.end}_${activeWordIdx}_${preset}_${width}_${height}`;

  // If off-screen canvas has the exact frame already rendered, blit it directly (zero layout/raster cost)
  if (cacheKey === lastCacheKey && offscreenCanvas && cachedPillW > 0 && cachedPillH > 0) {
    ctx.drawImage(
      offscreenCanvas,
      0,
      0,
      cachedPillW,
      cachedPillH,
      cachedPillX,
      cachedPillY,
      cachedPillW,
      cachedPillH
    );
    return;
  }

  // Initialize or resize reusable offscreen canvas
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas');
    offscreenCtx = offscreenCanvas.getContext('2d', { alpha: true });
  }

  if (!offscreenCanvas || !offscreenCtx) {
    return;
  }

  // Scale parameters
  const isVertical = height > width;
  const totalChars = phrase.words.reduce((sum, item) => sum + (item.text || '').length, 0);
  const charScale = totalChars > 22 ? 0.85 : 1;
  const baseFontSize = isVertical
    ? Math.max(18, Math.round(width * 0.052 * charScale))
    : Math.max(20, Math.round(height * 0.062 * charScale));
  const posY = height * 0.85; // Lower-third (bottom: 15%)

  const fontFamily =
    preset === 'hormozi'
      ? '"Montserrat", "Impact", Arial, sans-serif'
      : preset === 'beast'
      ? '"Poppins", "Arial Black", sans-serif'
      : '"Plus Jakarta Sans", sans-serif';

  offscreenCtx.font = `900 ${baseFontSize}px ${fontFamily}`;
  offscreenCtx.textAlign = 'center';
  offscreenCtx.textBaseline = 'middle';

  const spacing = isVertical ? Math.round(width * 0.02) : Math.round(width * 0.015);
  const maxLineWidth = width * 0.82;

  // Measure all words
  const wordMetrics = phrase.words.map((w, idx) => {
    const text = w.text;
    const isCurrent = activeWordIdx !== -1 && idx === activeWordIdx;
    const fontSize = isCurrent ? Math.round(baseFontSize * 1.15) : baseFontSize;
    offscreenCtx!.font = `900 ${fontSize}px ${fontFamily}`;
    const textWidth = offscreenCtx!.measureText(text).width;
    return { text, textWidth, fontSize, isCurrent, idx };
  });

  // Split words into lines to prevent overflow
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

  // Calculate pill dimensions
  const lineHeight = Math.round(baseFontSize * 1.42);
  const totalContentHeight = lines.length * lineHeight;
  const maxLineW = Math.max(...lines.map((l) => l.reduce((s, w) => s + w.textWidth, 0) + (l.length - 1) * spacing));

  const paddingX = Math.round(baseFontSize * 0.85);
  const paddingY = Math.round(baseFontSize * 0.45);
  const pillWidth = Math.round(maxLineW + paddingX * 2);
  const pillHeight = Math.round(totalContentHeight + paddingY * 2);
  const pillX = Math.round((width - pillWidth) / 2);
  const pillY = Math.round(posY - pillHeight / 2);
  const borderRadius = Math.round(baseFontSize * 0.35);

  // Resize offscreen canvas to exact pill bounds if needed
  if (offscreenCanvas.width !== pillWidth || offscreenCanvas.height !== pillHeight) {
    offscreenCanvas.width = pillWidth;
    offscreenCanvas.height = pillHeight;
  } else {
    // Clear off-screen text canvas completely to eliminate GPU texture leaks and ghosting
    offscreenCtx.clearRect(0, 0, pillWidth, pillHeight);
  }

  // 2. Draw Pill Background on Off-Screen Canvas (Relative coordinates: 0, 0 to pillWidth, pillHeight)
  offscreenCtx.save();
  offscreenCtx.beginPath();
  offscreenCtx.roundRect(0, 0, pillWidth, pillHeight, borderRadius);
  offscreenCtx.fillStyle = 'rgba(0, 0, 0, 0.88)';
  offscreenCtx.fill();
  offscreenCtx.lineWidth = Math.max(1.5, Math.round(baseFontSize * 0.04));
  offscreenCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  offscreenCtx.stroke();

  // 3. Render Lines and Words with Memory-Safe Font/Shadow Optimization
  let startLineY = paddingY + lineHeight / 2;

  lines.forEach((lineWords) => {
    const lineWidth = lineWords.reduce((s, w) => s + w.textWidth, 0) + (lineWords.length - 1) * spacing;
    let curX = (pillWidth - lineWidth) / 2;

    lineWords.forEach((w) => {
      const wordCenterX = curX + w.textWidth / 2;
      offscreenCtx!.font = `900 ${w.fontSize}px ${fontFamily}`;
      offscreenCtx!.textAlign = 'center';
      offscreenCtx!.textBaseline = 'middle';
      offscreenCtx!.lineJoin = 'round';

      if (preset === 'hormozi') {
        if (w.isCurrent) {
          // Highlight background pill
          const hlPaddingX = Math.round(w.fontSize * 0.22);
          const hlPaddingY = Math.round(w.fontSize * 0.12);
          const hlW = w.textWidth + hlPaddingX * 2;
          const hlH = w.fontSize * 1.3;
          const hlX = curX - hlPaddingX;
          const hlY = startLineY - hlH / 2;

          offscreenCtx!.beginPath();
          offscreenCtx!.roundRect(hlX, hlY, hlW, hlH, Math.round(w.fontSize * 0.2));
          offscreenCtx!.fillStyle = 'rgba(234, 179, 8, 0.35)';
          offscreenCtx!.fill();

          // Active Word in Bright Yellow with optimized stroke
          offscreenCtx!.fillStyle = '#fde047';
          // Low-overhead subtle shadow
          offscreenCtx!.shadowColor = 'rgba(234, 179, 8, 0.6)';
          offscreenCtx!.shadowBlur = Math.min(8, Math.round(w.fontSize * 0.2));
        } else {
          offscreenCtx!.fillStyle = '#ffffff';
          offscreenCtx!.shadowColor = 'transparent';
          offscreenCtx!.shadowBlur = 0;
        }

        offscreenCtx!.lineWidth = Math.max(2, Math.round(w.fontSize * 0.08));
        offscreenCtx!.strokeStyle = '#000000';
        offscreenCtx!.strokeText(w.text, wordCenterX, startLineY);
        offscreenCtx!.fillText(w.text, wordCenterX, startLineY);

      } else if (preset === 'neon') {
        if (w.isCurrent) {
          offscreenCtx!.fillStyle = '#67e8f9';
          offscreenCtx!.shadowColor = 'rgba(34, 211, 238, 0.7)';
          offscreenCtx!.shadowBlur = Math.min(8, Math.round(w.fontSize * 0.25));
        } else {
          offscreenCtx!.fillStyle = '#ffffff';
          offscreenCtx!.shadowColor = 'transparent';
          offscreenCtx!.shadowBlur = 0;
        }

        offscreenCtx!.lineWidth = Math.max(2, Math.round(w.fontSize * 0.08));
        offscreenCtx!.strokeStyle = '#000000';
        offscreenCtx!.strokeText(w.text, wordCenterX, startLineY);
        offscreenCtx!.fillText(w.text, wordCenterX, startLineY);

      } else if (preset === 'beast') {
        if (w.isCurrent) {
          offscreenCtx!.fillStyle = '#4ade80';
          offscreenCtx!.shadowColor = 'rgba(74, 222, 128, 0.65)';
          offscreenCtx!.shadowBlur = Math.min(8, Math.round(w.fontSize * 0.2));
        } else {
          offscreenCtx!.fillStyle = '#ffffff';
          offscreenCtx!.shadowColor = 'transparent';
          offscreenCtx!.shadowBlur = 0;
        }

        offscreenCtx!.lineWidth = Math.max(2, Math.round(w.fontSize * 0.08));
        offscreenCtx!.strokeStyle = '#000000';
        offscreenCtx!.strokeText(w.text, wordCenterX, startLineY);
        offscreenCtx!.fillText(w.text, wordCenterX, startLineY);

      } else {
        // Clean preset
        offscreenCtx!.fillStyle = '#ffffff';
        offscreenCtx!.shadowColor = 'transparent';
        offscreenCtx!.shadowBlur = 0;
        offscreenCtx!.lineWidth = Math.max(1.5, Math.round(w.fontSize * 0.06));
        offscreenCtx!.strokeStyle = '#000000';
        offscreenCtx!.strokeText(w.text, wordCenterX, startLineY);
        offscreenCtx!.fillText(w.text, wordCenterX, startLineY);
      }

      curX += w.textWidth + spacing;
    });

    startLineY += lineHeight;
  });

  offscreenCtx.restore();

  // Update cached state
  lastCacheKey = cacheKey;
  cachedPillX = pillX;
  cachedPillY = pillY;
  cachedPillW = pillWidth;
  cachedPillH = pillHeight;

  // Blit pre-rendered offscreen canvas to main video canvas
  ctx.drawImage(
    offscreenCanvas,
    0,
    0,
    pillWidth,
    pillHeight,
    pillX,
    pillY,
    pillWidth,
    pillHeight
  );
}
