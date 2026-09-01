import type { CaptionWord } from '../types';

/**
 * Converts milliseconds to WebVTT timestamp format (HH:MM:SS.mmm)
 */
export function formatVttTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.floor(ms % 1000);

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const mmm = String(milliseconds).padStart(3, '0');

  return `${hh}:${mm}:${ss}.${mmm}`;
}

/**
 * Converts milliseconds to SubRip (.srt) timestamp format (HH:MM:SS,mmm)
 */
export function formatSrtTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.floor(ms % 1000);

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const mmm = String(milliseconds).padStart(3, '0');

  return `${hh}:${mm}:${ss},${mmm}`;
}

/**
 * Groups word-level timestamps into natural 3-4 word phrases for smooth reading
 */
export function groupWordsIntoPhrases(
  words: CaptionWord[],
  maxWordsPerPhrase = 4,
  maxGapMs = 450
): Array<{ start: number; end: number; text: string; words: CaptionWord[] }> {
  if (!words || words.length === 0) return [];

  const sorted = [...words].sort((a, b) => a.start - b.start);
  const phrases: Array<{ start: number; end: number; text: string; words: CaptionWord[] }> = [];
  let current: CaptionWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const start = current[0].start;
    const end = Math.max(start + 200, current[current.length - 1].end);
    const text = current.map((w) => w.text).join(' ');
    phrases.push({ start, end, text, words: [...current] });
    current = [];
  };

  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i];
    const prev = current[current.length - 1];

    const hasPunctuation = prev && /[.!?,\u0964|\n]/.test(prev.text);
    const hasGap = prev && w.start - prev.end > maxGapMs;
    const reachedMax = current.length >= maxWordsPerPhrase;

    if (current.length > 0 && (hasPunctuation || hasGap || reachedMax)) {
      flush();
    }
    current.push(w);
  }
  flush();

  return phrases;
}

/**
 * Generates a valid WebVTT string from word-level timestamps
 */
export function generateWebVTT(words: CaptionWord[]): string {
  const phrases = groupWordsIntoPhrases(words);
  let vtt = 'WEBVTT\n\n';

  phrases.forEach((p, idx) => {
    vtt += `${idx + 1}\n`;
    vtt += `${formatVttTimestamp(p.start)} --> ${formatVttTimestamp(p.end)}\n`;
    vtt += `${p.text}\n\n`;
  });

  return vtt;
}

/**
 * Generates a valid SRT string from word-level timestamps
 */
export function generateSRT(words: CaptionWord[]): string {
  const phrases = groupWordsIntoPhrases(words);
  let srt = '';

  phrases.forEach((p, idx) => {
    srt += `${idx + 1}\n`;
    srt += `${formatSrtTimestamp(p.start)} --> ${formatSrtTimestamp(p.end)}\n`;
    srt += `${p.text}\n\n`;
  });

  return srt;
}

/**
 * Creates a Blob Object URL for dynamic <track> element synchronization in HTML5 video
 */
export function createVTTBlobUrl(words: CaptionWord[]): string {
  const vttContent = generateWebVTT(words);
  const blob = new Blob([vttContent], { type: 'text/vtt;charset=utf-8' });
  return URL.createObjectURL(blob);
}

/**
 * Ultra-fast O(log N) binary search for 30-minute videos containing 5,000+ words
 */
export function binarySearchActiveWordIndex(sortedWords: CaptionWord[], curTimeMs: number): number {
  if (!sortedWords || sortedWords.length === 0) return -1;

  let low = 0;
  let high = sortedWords.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const word = sortedWords[mid];

    if (curTimeMs >= word.start && curTimeMs <= word.end) {
      return mid;
    }

    if (curTimeMs < word.start) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  // If inside gap between words, return the closest previous word if within 250ms
  if (high >= 0 && high < sortedWords.length) {
    const prev = sortedWords[high];
    if (curTimeMs >= prev.start && curTimeMs <= prev.end + 250) {
      return high;
    }
  }

  return -1;
}
