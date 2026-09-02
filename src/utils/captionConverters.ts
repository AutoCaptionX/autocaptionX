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

export interface CaptionPhrase {
  id: number;
  words: CaptionWord[];
  start: number;
  end: number;
  text: string;
}

/**
 * Builds continuous caption phrases spanning 100% of the video duration:
 * 1. Full video timeline extension from 0:00 to video.duration.
 * 2. Auto-padding between phrases (endTime of previous caption = startTime of next caption) to eliminate blank screen gaps.
 * 3. Final spoken caption block holds persistence until the exact end timestamp of the video (video.duration).
 */
export function buildContinuousCaptionPhrases(
  words: CaptionWord[],
  videoDurationMs?: number,
  maxWordsPerPhrase = 4
): CaptionPhrase[] {
  if (!words || words.length === 0) return [];

  // 1. Sanitize, validate and sort words
  const sorted = [...words]
    .filter((w) => Boolean(w && w.text && w.text.trim()))
    .map((w, idx) => {
      const s = typeof w.start === 'number' && !isNaN(w.start) ? Math.max(0, Math.round(w.start)) : idx * 300;
      const e = typeof w.end === 'number' && !isNaN(w.end) ? Math.max(s + 80, Math.round(w.end)) : s + 250;
      return {
        ...w,
        text: w.text.trim(),
        start: s,
        end: e,
      };
    })
    .sort((a, b) => a.start - b.start);

  if (sorted.length === 0) return [];

  // 2. Initial natural grouping (3-4 words or sentence punctuation)
  const phrases: CaptionPhrase[] = [];
  let currentGroup: CaptionWord[] = [];

  const flush = () => {
    if (currentGroup.length === 0) return;
    const start = currentGroup[0].start;
    const end = Math.max(start + 100, currentGroup[currentGroup.length - 1].end);
    phrases.push({
      id: phrases.length,
      words: currentGroup.map((w) => ({ ...w })),
      start,
      end,
      text: currentGroup.map((w) => w.text).join(' '),
    });
    currentGroup = [];
  };

  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i];
    const prev = currentGroup[currentGroup.length - 1];

    const hasPunctuation = prev && /[.!?,\u0964|\n]/.test(prev.text);
    const reachedMax = currentGroup.length >= maxWordsPerPhrase;

    if (currentGroup.length > 0 && (hasPunctuation || reachedMax)) {
      flush();
    }
    currentGroup.push(w);
  }
  flush();

  if (phrases.length === 0) return [];

  // 3. FULL VIDEO TIMELINE EXTENSION:
  // Anchor first phrase at 0:00 so overlay is immediately visible with zero blank lead-in
  phrases[0].start = 0;
  if (phrases[0].words.length > 0) {
    phrases[0].words[0].start = 0;
  }

  // 4. PREVENT BLANK SCREEN GAPS (AUTO-PAD):
  // Extend display duration of each caption block so it remains visible on screen
  // until the next spoken word/sentence begins.
  for (let i = 0; i < phrases.length - 1; i++) {
    const nextStart = phrases[i + 1].start;
    phrases[i].end = nextStart;

    // Extend words inside phrase i so word transitions are seamless with zero gaps
    const pWords = phrases[i].words;
    for (let j = 0; j < pWords.length - 1; j++) {
      pWords[j].end = pWords[j + 1].start;
    }
    if (pWords.length > 0) {
      pWords[pWords.length - 1].end = nextStart;
    }
  }

  // 5. CAPTION HOLD & PERSISTENCE UNTIL VIDEO END:
  // For the final spoken caption block, force its display duration to hold until
  // the exact end timestamp of the video (video.duration).
  const lastPhrase = phrases[phrases.length - 1];
  const targetEnd = videoDurationMs && videoDurationMs > 0
    ? Math.max(lastPhrase.end, Math.round(videoDurationMs))
    : Math.max(lastPhrase.end, lastPhrase.start + 3000);

  lastPhrase.end = targetEnd;
  const lastPWords = lastPhrase.words;
  for (let j = 0; j < lastPWords.length - 1; j++) {
    lastPWords[j].end = lastPWords[j + 1].start;
  }
  if (lastPWords.length > 0) {
    lastPWords[lastPWords.length - 1].end = targetEnd;
  }

  return phrases;
}

/**
 * Fast O(log N) binary search that guarantees finding the active subtitle phrase
 * without returning -1 or dropping overlays during pauses or playback.
 */
export function findActivePhraseIndex(
  phrases: Array<{ words: CaptionWord[]; start: number; end: number }>,
  curMs: number
): number {
  if (!phrases || phrases.length === 0) return -1;
  if (curMs <= phrases[0].start) return 0;
  if (curMs >= phrases[phrases.length - 1].start) return phrases.length - 1;

  let low = 0;
  let high = phrases.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const phrase = phrases[mid];

    if (curMs >= phrase.start && curMs < phrase.end) {
      return mid;
    }

    if (curMs < phrase.start) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return Math.max(0, Math.min(phrases.length - 1, low));
}

/**
 * Groups word-level timestamps into natural 3-4 word phrases with continuous timeline padding
 */
export function groupWordsIntoPhrases(
  words: CaptionWord[],
  videoDurationMs?: number,
  maxWordsPerPhrase = 4
): Array<{ start: number; end: number; text: string; words: CaptionWord[] }> {
  return buildContinuousCaptionPhrases(words, videoDurationMs, maxWordsPerPhrase);
}

/**
 * Generates a valid WebVTT string from word-level timestamps
 */
export function generateWebVTT(words: CaptionWord[], videoDurationMs?: number): string {
  const phrases = buildContinuousCaptionPhrases(words, videoDurationMs);
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
export function generateSRT(words: CaptionWord[], videoDurationMs?: number): string {
  const phrases = buildContinuousCaptionPhrases(words, videoDurationMs);
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
