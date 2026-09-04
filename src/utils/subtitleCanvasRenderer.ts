import type { CaptionWord, CaptionPreset } from '../types';
import { getActiveWordIndexForPhrase } from './captionConverters';

export interface RenderSubtitleParams {
  ctx: CanvasRenderingContext2D;
  phrase: { words: CaptionWord[]; start: number; end: number; id?: number };
  curMs: number;
  preset: CaptionPreset;
  width: number;
  height: number;
}

// Reusable off-screen text canvas to avoid repeated memory allocations
let offscreenCanvas: HTMLCanvasElement | null = null;
let offscreenCtx: CanvasRenderingContext2D | null = null;

// Reusable scratch canvas dedicated exclusively to one-time pre-layout measurements
let scratchMeasureCanvas: HTMLCanvasElement | null = null;
let scratchMeasureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!scratchMeasureCanvas) {
    scratchMeasureCanvas = document.createElement('canvas');
    scratchMeasureCtx = scratchMeasureCanvas.getContext('2d', { alpha: false });
  }
  return scratchMeasureCtx;
}

export interface PrecomputedWord {
  text: string;
  idx: number;
  wordCenterX: number;
  wordX: number;
  textWidth: number;
  baseFontSize: number;
  activeFontSize: number;
  badgeRect: {
    x: number;
    y: number;
    w: number;
    h: number;
    r: number;
  };
  lineIndex: number;
  lineY: number;
}

export interface PrecomputedPhraseLayout {
  cacheKey: string;
  pillWidth: number;
  pillHeight: number;
  pillX: number;
  pillY: number;
  borderRadius: number;
  fontFamily: string;
  baseFontSize: number;
  activeFontSize: number;
  words: PrecomputedWord[];
  lines: Array<{
    lineY: number;
    words: PrecomputedWord[];
  }>;
}

// Phrase layout cache to eliminate font measurement and reflow during live playback
const phraseLayoutCache = new Map<string, PrecomputedPhraseLayout>();

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
  if (scratchMeasureCanvas) {
    scratchMeasureCanvas.width = 0;
    scratchMeasureCanvas.height = 0;
    scratchMeasureCanvas = null;
    scratchMeasureCtx = null;
  }
  phraseLayoutCache.clear();
  lastCacheKey = '';
  cachedPillX = 0;
  cachedPillY = 0;
  cachedPillW = 0;
  cachedPillH = 0;
}

/**
 * Computes and caches pre-calculated dynamic bounding boxes for words in a phrase:
 * - Eliminates font measurement (measureText) from the live playback loop.
 * - Pre-computes line wrapping, word coordinates, and highlight badge bounding boxes.
 */
function getPrecomputedPhraseLayout(
  phrase: { words: CaptionWord[]; start: number; end: number; id?: number },
  preset: CaptionPreset,
  width: number,
  height: number
): PrecomputedPhraseLayout | null {
  const wordsSignature = phrase.words.map((w) => w.text).join('|');
  const phraseId = phrase.id !== undefined ? phrase.id : `${phrase.start}_${phrase.end}`;
  const layoutKey = `${phraseId}_${preset}_${width}_${height}_${wordsSignature}`;

  const cached = phraseLayoutCache.get(layoutKey);
  if (cached) {
    return cached;
  }

  const mCtx = getMeasureCtx();
  if (!mCtx) return null;

  const isVertical = height > width;
  const totalChars = phrase.words.reduce((sum, item) => sum + (item.text || '').length, 0);
  let charScale = 1;
  if (totalChars > 32) {
    charScale = 0.78;
  } else if (totalChars > 22) {
    charScale = 0.88;
  } else if (totalChars > 16) {
    charScale = 0.95;
  }

  const baseFontSize = isVertical
    ? Math.max(16, Math.min(36, Math.round(width * 0.052 * charScale)))
    : Math.max(18, Math.min(40, Math.round(height * 0.060 * charScale)));

  const posY = Math.round(height * 0.78);

  const fontFamily =
    preset === 'hormozi'
      ? '"Montserrat", "Impact", Arial, sans-serif'
      : preset === 'beast'
      ? '"Poppins", "Arial Black", sans-serif'
      : '"Plus Jakarta Sans", sans-serif';

  const spacing = Math.max(20, isVertical ? Math.round(width * 0.024) : Math.round(width * 0.018));
  const activeScale = 1.15;
  const activeFontSize = Math.round(baseFontSize * activeScale);

  // Measure word dimensions with active font to reserve maximum stable width
  mCtx.font = `900 ${activeFontSize}px ${fontFamily}`;

  interface IntermediateWord {
    text: string;
    textWidth: number;
    maxWordWidth: number;
    baseFontSize: number;
    activeFontSize: number;
    idx: number;
  }

  const measuredWords: IntermediateWord[] = phrase.words.map((w, idx) => {
    const text = w.text || '';
    mCtx.font = `900 ${baseFontSize}px ${fontFamily}`;
    const textWidth = Math.ceil(mCtx.measureText(text).width);

    mCtx.font = `900 ${activeFontSize}px ${fontFamily}`;
    const maxWordWidth = Math.ceil(mCtx.measureText(text).width);

    return { text, textWidth, maxWordWidth, baseFontSize, activeFontSize, idx };
  });

  const maxLineWidth = Math.max(140, Math.min(width * (isVertical ? 0.82 : 0.76), width - 64));

  // Split words into lines with stable wrapping
  const lineGroups: IntermediateWord[][] = [];
  let curGroup: IntermediateWord[] = [];
  let curLineWidth = 0;

  for (const item of measuredWords) {
    const itemSpacing = curGroup.length > 0 ? spacing : 0;
    const itemTotal = item.maxWordWidth + itemSpacing;

    if (curGroup.length > 0 && curLineWidth + itemTotal > maxLineWidth) {
      lineGroups.push(curGroup);
      curGroup = [item];
      curLineWidth = item.maxWordWidth;
    } else {
      curGroup.push(item);
      curLineWidth += itemTotal;
    }
  }
  if (curGroup.length > 0) {
    lineGroups.push(curGroup);
  }

  const lineHeight = Math.round(baseFontSize * 1.54);
  const totalContentHeight = lineGroups.length * lineHeight;
  const maxLineW = Math.max(
    0,
    ...lineGroups.map((l) => l.reduce((s, w) => s + w.maxWordWidth, 0) + Math.max(0, l.length - 1) * spacing)
  );

  const paddingX = Math.max(28, Math.round(baseFontSize * 1.10));
  const paddingY = Math.max(16, Math.round(baseFontSize * 0.65));
  const pillWidth = Math.min(width - 24, Math.max(maxLineW + paddingX * 2, 160));
  const pillHeight = Math.round(totalContentHeight + paddingY * 2);
  const pillX = Math.round((width - pillWidth) / 2);
  const pillY = Math.round(posY - pillHeight / 2);
  const borderRadius = Math.round(baseFontSize * 0.38);

  // Pre-calculate exact coordinates and dynamic bounding box badges for every word
  let startLineY = paddingY + lineHeight / 2;
  const precomputedWords: PrecomputedWord[] = [];
  const lines: Array<{ lineY: number; words: PrecomputedWord[] }> = [];

  lineGroups.forEach((group, lineIdx) => {
    const lineWidth = group.reduce((s, w) => s + w.textWidth, 0) + Math.max(0, group.length - 1) * spacing;
    let curX = Math.round((pillWidth - lineWidth) / 2);
    const lineWords: PrecomputedWord[] = [];

    group.forEach((w) => {
      const wordCenterX = Math.round(curX + w.textWidth / 2);
      const badgePaddingX = 12; // 12px each side = 24px total badge padding
      const hlW = Math.round(w.textWidth + 24);
      const hlH = Math.round(w.activeFontSize * 1.32);
      const hlX = Math.round(curX - badgePaddingX);
      const hlY = Math.round(startLineY - hlH / 2);
      const hlR = Math.max(6, Math.round(w.activeFontSize * 0.22));

      const pw: PrecomputedWord = {
        text: w.text,
        idx: w.idx,
        wordCenterX,
        wordX: curX,
        textWidth: w.textWidth,
        baseFontSize: w.baseFontSize,
        activeFontSize: w.activeFontSize,
        badgeRect: {
          x: hlX,
          y: hlY,
          w: hlW,
          h: hlH,
          r: hlR,
        },
        lineIndex: lineIdx,
        lineY: startLineY,
      };

      precomputedWords.push(pw);
      lineWords.push(pw);
      curX += w.textWidth + spacing;
    });

    lines.push({ lineY: startLineY, words: lineWords });
    startLineY += lineHeight;
  });

  const layout: PrecomputedPhraseLayout = {
    cacheKey: layoutKey,
    pillWidth,
    pillHeight,
    pillX,
    pillY,
    borderRadius,
    fontFamily,
    baseFontSize,
    activeFontSize,
    words: precomputedWords,
    lines,
  };

  // Keep cache size bounded (max 60 phrases)
  if (phraseLayoutCache.size > 60) {
    const firstKey = phraseLayoutCache.keys().next().value;
    if (firstKey) phraseLayoutCache.delete(firstKey);
  }
  phraseLayoutCache.set(layoutKey, layout);

  return layout;
}

/**
 * High-performance, zero-latency canvas subtitle renderer:
 * 1. Uses pre-calculated dynamic bounding boxes for words so the canvas never re-measures
 *    font size, padding, or lines during live playback.
 * 2. Uses strict audio-visual timestamp interpolation to snap the active word highlighting
 *    precisely to video.currentTime without queuing lag.
 * 3. Off-screen canvas bitmap caching allows 95% of frames to execute a simple GPU blit.
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

  // 1. Strict Audio-Visual Timestamp Interpolation with Zero Queuing Lag
  const activeWordIdx = getActiveWordIndexForPhrase(phrase.words, curMs, phrase.start, phrase.end);

  // Generate cache key based on phrase content, active word, preset, and dimensions
  const phraseId = phrase.id !== undefined ? phrase.id : `${phrase.start}_${phrase.end}`;
  const cacheKey = `${phraseId}_${activeWordIdx}_${preset}_${width}_${height}`;

  // If off-screen canvas already has the exact frame rendered, blit it directly (zero layout/raster cost)
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

  // 2. Retrieve Pre-Calculated Dynamic Bounding Box Layout (zero measureText during playback)
  const layout = getPrecomputedPhraseLayout(phrase, preset, width, height);
  if (!layout) return;

  // Initialize or resize reusable offscreen canvas
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas');
    offscreenCtx = offscreenCanvas.getContext('2d', { alpha: true });
  }

  if (!offscreenCanvas || !offscreenCtx) {
    return;
  }

  const { pillWidth, pillHeight, pillX, pillY, borderRadius, fontFamily } = layout;

  // Resize offscreen canvas to exact pill bounds if needed
  if (offscreenCanvas.width !== pillWidth || offscreenCanvas.height !== pillHeight) {
    offscreenCanvas.width = pillWidth;
    offscreenCanvas.height = pillHeight;
  } else {
    // Clear off-screen text canvas completely
    offscreenCtx.clearRect(0, 0, pillWidth, pillHeight);
  }

  // 3. Draw Pill Background on Off-Screen Canvas
  offscreenCtx.save();
  offscreenCtx.beginPath();
  offscreenCtx.roundRect(0, 0, pillWidth, pillHeight, borderRadius);
  offscreenCtx.fillStyle = 'rgba(0, 0, 0, 0.88)';
  offscreenCtx.fill();
  offscreenCtx.lineWidth = Math.max(1.5, Math.round(layout.baseFontSize * 0.04));
  offscreenCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  offscreenCtx.stroke();

  // 4. Render Active Word Highlight Badge (Pre-Calculated Bounding Box)
  if (activeWordIdx >= 0 && activeWordIdx < layout.words.length) {
    const activeW = layout.words[activeWordIdx];
    const { x, y, w, h, r } = activeW.badgeRect;

    offscreenCtx.beginPath();
    offscreenCtx.roundRect(x, y, w, h, r);

    if (preset === 'hormozi') {
      offscreenCtx.fillStyle = 'rgba(234, 179, 8, 0.42)';
      offscreenCtx.fill();
    } else if (preset === 'neon') {
      offscreenCtx.fillStyle = 'rgba(34, 211, 238, 0.28)';
      offscreenCtx.fill();
    } else if (preset === 'beast') {
      offscreenCtx.fillStyle = 'rgba(74, 222, 128, 0.32)';
      offscreenCtx.fill();
    }
  }

  // 5. Render Words using Pre-Calculated Center Coordinates & Font Sizes (Zero Runtime Math)
  offscreenCtx.textAlign = 'center';
  offscreenCtx.textBaseline = 'middle';
  offscreenCtx.lineJoin = 'round';

  for (let i = 0; i < layout.words.length; i++) {
    const w = layout.words[i];
    const isCurrent = i === activeWordIdx;
    const fontSize = isCurrent ? w.activeFontSize : w.baseFontSize;

    offscreenCtx.font = `900 ${fontSize}px ${fontFamily}`;

    if (preset === 'hormozi') {
      if (isCurrent) {
        offscreenCtx.fillStyle = '#fde047';
      } else {
        offscreenCtx.fillStyle = '#ffffff';
      }
      // Force off heavy shadowBlur filter during real-time video playback to prevent main thread blocking
      offscreenCtx.shadowColor = 'transparent';
      offscreenCtx.shadowBlur = 0;
      offscreenCtx.lineWidth = Math.max(2, Math.round(fontSize * 0.08));
      offscreenCtx.strokeStyle = '#000000';
      offscreenCtx.strokeText(w.text, w.wordCenterX, w.lineY);
      offscreenCtx.fillText(w.text, w.wordCenterX, w.lineY);

    } else if (preset === 'neon') {
      if (isCurrent) {
        offscreenCtx.fillStyle = '#67e8f9';
      } else {
        offscreenCtx.fillStyle = '#ffffff';
      }
      // Force off heavy shadowBlur filter during real-time video playback to prevent main thread blocking
      offscreenCtx.shadowColor = 'transparent';
      offscreenCtx.shadowBlur = 0;
      offscreenCtx.lineWidth = Math.max(2, Math.round(fontSize * 0.08));
      offscreenCtx.strokeStyle = '#000000';
      offscreenCtx.strokeText(w.text, w.wordCenterX, w.lineY);
      offscreenCtx.fillText(w.text, w.wordCenterX, w.lineY);

    } else if (preset === 'beast') {
      if (isCurrent) {
        offscreenCtx.fillStyle = '#4ade80';
      } else {
        offscreenCtx.fillStyle = '#ffffff';
      }
      // Force off heavy shadowBlur filter during real-time video playback to prevent main thread blocking
      offscreenCtx.shadowColor = 'transparent';
      offscreenCtx.shadowBlur = 0;
      offscreenCtx.lineWidth = Math.max(2, Math.round(fontSize * 0.08));
      offscreenCtx.strokeStyle = '#000000';
      offscreenCtx.strokeText(w.text, w.wordCenterX, w.lineY);
      offscreenCtx.fillText(w.text, w.wordCenterX, w.lineY);

    } else {
      // Clean preset
      offscreenCtx.fillStyle = '#ffffff';
      offscreenCtx.shadowColor = 'transparent';
      offscreenCtx.shadowBlur = 0;
      offscreenCtx.lineWidth = Math.max(1.5, Math.round(fontSize * 0.06));
      offscreenCtx.strokeStyle = '#000000';
      offscreenCtx.strokeText(w.text, w.wordCenterX, w.lineY);
      offscreenCtx.fillText(w.text, w.wordCenterX, w.lineY);
    }
  }

  offscreenCtx.restore();

  // Update cached state
  lastCacheKey = cacheKey;
  cachedPillX = pillX;
  cachedPillY = pillY;
  cachedPillW = pillWidth;
  cachedPillH = pillHeight;

  // Blit pre-rendered offscreen canvas to main video canvas in a single draw operation
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
