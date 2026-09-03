// Audio extraction and Web Audio API alignment utilities for AutoCaptionX
import type { CaptionWord } from '../types';

export interface ExtractedAudioResult {
  blob: Blob;
  durationMs: number;
  audioBuffer?: AudioBuffer;
}

// Decode AudioBuffer from media file or blob with Web Audio API
export async function decodeAudioBufferFromFile(file: Blob | File): Promise<AudioBuffer | null> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;

    let audioCtx: AudioContext;
    try {
      audioCtx = new AudioContextClass();
    } catch {
      audioCtx = new AudioContextClass({ sampleRate: 16000 });
    }

    try {
      const decodedAudio = await new Promise<AudioBuffer | null>((resolve) => {
        try {
          const promise = audioCtx.decodeAudioData(
            arrayBuffer.slice(0),
            (buf) => resolve(buf),
            (err) => {
              console.warn('[AutoCaptionX Audio] decodeAudioData callback error:', err);
              resolve(null);
            }
          );
          if (promise && typeof promise.then === 'function') {
            promise.then((buf) => resolve(buf)).catch((err) => {
              console.warn('[AutoCaptionX Audio] decodeAudioData promise error:', err);
              resolve(null);
            });
          }
        } catch (ex) {
          console.warn('[AutoCaptionX Audio] decodeAudioData exception:', ex);
          resolve(null);
        }
      });
      return decodedAudio;
    } finally {
      try {
        if (audioCtx.state !== 'closed') {
          audioCtx.close();
        }
      } catch {}
    }
  } catch (err) {
    console.warn('[AutoCaptionX Audio] AudioContext decoding notice:', err);
    return null;
  }
}

// Extract lightweight 16kHz WAV from video files using Web Audio API
export async function extractAudioFromMediaFile(file: File): Promise<ExtractedAudioResult> {
  // If file is already a lightweight audio file (< 15MB audio)
  if (file.type.startsWith('audio/') && file.size < 15 * 1024 * 1024) {
    const decoded = await decodeAudioBufferFromFile(file);
    return {
      blob: file,
      durationMs: decoded ? Math.round(decoded.duration * 1000) : 0,
      audioBuffer: decoded || undefined,
    };
  }

  // For very large files (> 80MB), handle safely
  if (file.size > 80 * 1024 * 1024) {
    return { blob: file, durationMs: 0 };
  }

  try {
    const decodedAudio = await decodeAudioBufferFromFile(file);
    if (!decodedAudio) {
      return { blob: file, durationMs: 0 };
    }

    const durationMs = Math.round(decodedAudio.duration * 1000);
    // Convert audio buffer to mono 16kHz 16-bit PCM WAV Blob
    const wavBlob = audioBufferToWav(decodedAudio, 16000);
    return { blob: wavBlob, durationMs, audioBuffer: decodedAudio };
  } catch (err) {
    console.warn('[AutoCaptionX Audio] Web Audio extraction fallback to direct file:', err);
    return { blob: file, durationMs: 0 };
  }
}

// Calculate audio RMS energy envelope in discrete millisecond buckets (e.g. 20ms)
export function calculateAudioEnergyEnvelope(
  audioBuffer: AudioBuffer,
  bucketSizeMs = 20
): { timesMs: number[]; rms: Float32Array; avgRms: number; maxRms: number } {
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  const samplesPerBucket = Math.max(1, Math.round((bucketSizeMs / 1000) * sampleRate));
  const numBuckets = Math.floor(channelData.length / samplesPerBucket);

  const rms = new Float32Array(numBuckets);
  const timesMs: number[] = new Array(numBuckets);
  let totalRms = 0;
  let maxRms = 0;

  for (let b = 0; b < numBuckets; b++) {
    const startSample = b * samplesPerBucket;
    let sumSq = 0;
    for (let s = 0; s < samplesPerBucket; s++) {
      const val = channelData[startSample + s] || 0;
      sumSq += val * val;
    }
    const valRms = Math.sqrt(sumSq / samplesPerBucket);
    rms[b] = valRms;
    timesMs[b] = Math.round(b * bucketSizeMs);
    totalRms += valRms;
    if (valRms > maxRms) maxRms = valRms;
  }

  const avgRms = numBuckets > 0 ? totalRms / numBuckets : 0;
  return { timesMs, rms, avgRms, maxRms };
}

// Align word timestamps with Web Audio API context energy envelope
export function alignWordTimestampsWithAudio(
  words: CaptionWord[],
  audioBuffer: AudioBuffer | null
): CaptionWord[] {
  if (!words || words.length === 0) return [];
  if (!audioBuffer) {
    return sanitizeAndEnforceMonotonic(words);
  }

  try {
    const { timesMs, rms, avgRms, maxRms } = calculateAudioEnergyEnvelope(audioBuffer, 20);
    // Voice activity threshold
    const voiceThreshold = Math.max(0.012, avgRms * 0.4, maxRms * 0.06);

    const aligned: CaptionWord[] = [];

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      let startMs = Math.max(0, Math.round(w.start));
      let endMs = Math.max(startMs + 50, Math.round(w.end));

      // Search in a local window [-160ms, +160ms] for closest voice onset (energy rising edge)
      const bucketIdx = Math.floor(startMs / 20);
      const searchRadius = 8; // 8 * 20ms = 160ms
      const minBucket = Math.max(0, bucketIdx - searchRadius);
      const maxBucket = Math.min(rms.length - 1, bucketIdx + searchRadius);

      let bestOnsetMs = startMs;
      let foundOnset = false;

      // Look for first bucket in window that crosses voice threshold
      for (let b = minBucket; b <= maxBucket; b++) {
        if (rms[b] >= voiceThreshold && (b === 0 || rms[b - 1] < voiceThreshold)) {
          bestOnsetMs = timesMs[b];
          foundOnset = true;
          break;
        }
      }

      if (foundOnset && Math.abs(bestOnsetMs - startMs) <= 160) {
        startMs = bestOnsetMs;
      }

      // Preserve acoustic duration while ensuring minimum 50ms for micro-utterances
      endMs = Math.max(startMs + 50, endMs);

      aligned.push({
        ...w,
        start: startMs,
        end: endMs,
      });
    }

    return sanitizeAndEnforceMonotonic(aligned);
  } catch (err) {
    console.warn('[AutoCaptionX Audio] Audio alignment fallback:', err);
    return sanitizeAndEnforceMonotonic(words);
  }
}

// Strict word-level timestamp normalization without distorting genuine audio waveform boundaries:
// 1. Preserves exact waveform start and end times for each word (no artificial shifting to 0:00).
// 2. Retains silence gaps between words instead of falsely stretching word endings across pauses.
// 3. Enforces monotonic non-overlapping order and prevents words from exceeding video duration.
// 4. Retains all short words and particles accurately.
export function sanitizeAndEnforceMonotonic(words: CaptionWord[], videoDurationMs?: number): CaptionWord[] {
  if (!words || words.length === 0) return [];

  const sorted = [...words]
    .filter((w) => Boolean(w && typeof w.text === 'string' && w.text.trim().length > 0))
    .map((w, idx) => {
      const s = typeof w.start === 'number' && !isNaN(w.start) ? Math.max(0, Math.round(w.start)) : idx * 300;
      // Minimum duration 50ms for ultra-short words/particles (e.g. Hindi "तो", "है", "ki", English "a", "I")
      const e = typeof w.end === 'number' && !isNaN(w.end) ? Math.max(s + 50, Math.round(w.end)) : s + 200;
      return {
        ...w,
        text: w.text.trim(),
        start: s,
        end: e,
      };
    })
    .sort((a, b) => a.start - b.start);

  if (sorted.length === 0) return [];

  // Enforce chronological progression and clamp overlapping words to genuine boundary
  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];

    if (i < sorted.length - 1) {
      const next = sorted[i + 1];
      if (next.start < curr.start) {
        next.start = curr.start;
      }
      // If current word overlaps into next word, clamp end of current word to next word's start
      if (curr.end > next.start) {
        curr.end = Math.max(curr.start + 50, next.start);
      }
    }

    // Clamp within video duration if specified
    if (videoDurationMs && videoDurationMs > 0) {
      if (curr.start >= videoDurationMs) {
        curr.start = Math.max(0, Math.round(videoDurationMs - 100));
      }
      if (curr.end > videoDurationMs) {
        curr.end = Math.round(videoDurationMs);
      }
    }
  }

  return sorted;
}

export interface AudioChunkSegment {
  index: number;
  totalChunks: number;
  startOffsetMs: number;
  endOffsetMs: number;
  durationMs: number;
  blob: Blob;
  audioBuffer?: AudioBuffer;
}

// Slice AudioBuffer between specific start and end timestamps in milliseconds
export function sliceAudioBuffer(
  audioBuffer: AudioBuffer,
  startMs: number,
  endMs: number
): AudioBuffer | null {
  try {
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.max(0, Math.floor((startMs / 1000) * sampleRate));
    const endSample = Math.min(audioBuffer.length, Math.ceil((endMs / 1000) * sampleRate));
    const sliceLength = endSample - startSample;

    if (sliceLength <= 0) return null;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;

    const audioCtx = new AudioContextClass({ sampleRate });
    const slicedBuffer = audioCtx.createBuffer(
      audioBuffer.numberOfChannels,
      sliceLength,
      sampleRate
    );

    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      const channelData = audioBuffer.getChannelData(c);
      const subData = channelData.subarray(startSample, endSample);
      slicedBuffer.copyToChannel(subData, c, 0);
    }

    return slicedBuffer;
  } catch (err) {
    console.warn('[AutoCaptionX Audio] sliceAudioBuffer notice:', err);
    return null;
  }
}

// Convert raw Float32Array audio samples into standard 16-bit PCM WAV Blob
export function float32ArrayToWavBlob(
  inputData: Float32Array,
  sourceSampleRate: number,
  targetSampleRate = 16000
): Blob {
  const numChannels = 1; // Mono
  const sampleRate = targetSampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  let channelData: Float32Array;
  if (sourceSampleRate !== targetSampleRate) {
    const ratio = sourceSampleRate / targetSampleRate;
    const newLength = Math.max(1, Math.round(inputData.length / ratio));
    channelData = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const originalIndex = Math.floor(i * ratio);
      channelData[i] = inputData[originalIndex] || 0;
    }
  } else {
    channelData = inputData;
  }

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + channelData.length * bytesPerSample);
  const view = new DataView(wavBuffer);

  // RIFF Header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + channelData.length * bytesPerSample, true);
  writeString(view, 8, 'WAVE');
  // fmt subchunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  // data subchunk
  writeString(view, 36, 'data');
  view.setUint32(40, channelData.length * bytesPerSample, true);

  // PCM samples
  let offset = 44;
  for (let i = 0; i < channelData.length; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

// Split media file audio into 30-second streaming chunks with intelligent silence boundary alignment
// Maintains continuous timing across boundaries so words near the 30s boundary do not lag or skip.
export async function splitMediaFileIntoAudioChunks(
  file: File | Blob,
  chunkDurationMs = 30000,
  targetDurationMs?: number
): Promise<AudioChunkSegment[]> {
  try {
    const decodedAudio = await decodeAudioBufferFromFile(file);
    if (!decodedAudio || decodedAudio.duration <= 0) {
      // Fallback: if Web Audio API couldn't decode directly, split by estimated duration
      const totalDur = targetDurationMs && targetDurationMs > 0 ? targetDurationMs : 30000;
      const numFallbackChunks = Math.max(1, Math.ceil(totalDur / chunkDurationMs));
      const fallbackChunks: AudioChunkSegment[] = [];

      for (let i = 0; i < numFallbackChunks; i++) {
        const startOffsetMs = i * chunkDurationMs;
        const endOffsetMs = Math.min(totalDur, (i + 1) * chunkDurationMs);
        fallbackChunks.push({
          index: i,
          totalChunks: numFallbackChunks,
          startOffsetMs,
          endOffsetMs,
          durationMs: endOffsetMs - startOffsetMs,
          blob: file,
        });
      }
      return fallbackChunks;
    }

    const totalDurationMs = Math.round(decodedAudio.duration * 1000);
    const sourceData = decodedAudio.getChannelData(0);
    const sampleRate = decodedAudio.sampleRate;
    const chunks: AudioChunkSegment[] = [];

    let currentStartMs = 0;
    let chunkIndex = 0;

    while (currentStartMs < totalDurationMs) {
      const remainingMs = totalDurationMs - currentStartMs;

      // If remaining duration is smaller than 1.35 * chunkDurationMs, take it all as final chunk
      if (remainingMs <= chunkDurationMs * 1.35) {
        const endOffsetMs = totalDurationMs;
        const durationMs = endOffsetMs - currentStartMs;
        const startSample = Math.max(0, Math.floor((currentStartMs / 1000) * sampleRate));
        const endSample = Math.min(sourceData.length, Math.ceil((endOffsetMs / 1000) * sampleRate));
        const sliceData = sourceData.subarray(startSample, endSample);
        const chunkBlob = float32ArrayToWavBlob(sliceData, sampleRate, 16000);

        chunks.push({
          index: chunkIndex,
          totalChunks: chunkIndex + 1, // updated after loop
          startOffsetMs: currentStartMs,
          endOffsetMs,
          durationMs,
          blob: chunkBlob,
        });
        break;
      }

      // 1. INTELLIGENT SILENCE BOUNDARY DETECTION:
      // Search in window [nominalEnd - 2000ms, nominalEnd + 2000ms] for lowest RMS energy (pause valley)
      const nominalEndMs = currentStartMs + chunkDurationMs;
      const searchStartMs = Math.max(currentStartMs + 10000, nominalEndMs - 2000);
      const searchEndMs = Math.min(totalDurationMs - 2000, nominalEndMs + 2000);

      let bestSplitMs = nominalEndMs;
      let minRms = Infinity;

      const windowStepMs = 40;
      const windowSamples = Math.round((windowStepMs / 1000) * sampleRate);

      for (let t = searchStartMs; t <= searchEndMs; t += windowStepMs) {
        const sampleIdx = Math.floor((t / 1000) * sampleRate);
        if (sampleIdx + windowSamples > sourceData.length) break;

        let sumSq = 0;
        for (let s = 0; s < windowSamples; s++) {
          const val = sourceData[sampleIdx + s] || 0;
          sumSq += val * val;
        }
        const rms = Math.sqrt(sumSq / windowSamples);

        if (rms < minRms) {
          minRms = rms;
          bestSplitMs = t;
        }
      }

      const actualEndMs = Math.min(totalDurationMs, Math.max(currentStartMs + 10000, bestSplitMs));
      const durationMs = actualEndMs - currentStartMs;
      const startSample = Math.max(0, Math.floor((currentStartMs / 1000) * sampleRate));
      const endSample = Math.min(sourceData.length, Math.ceil((actualEndMs / 1000) * sampleRate));
      const sliceData = sourceData.subarray(startSample, endSample);
      const chunkBlob = float32ArrayToWavBlob(sliceData, sampleRate, 16000);

      chunks.push({
        index: chunkIndex,
        totalChunks: 0, // will be updated
        startOffsetMs: currentStartMs,
        endOffsetMs: actualEndMs,
        durationMs,
        blob: chunkBlob,
      });

      currentStartMs = actualEndMs;
      chunkIndex++;
    }

    // Update totalChunks count
    for (const c of chunks) {
      c.totalChunks = chunks.length;
    }

    return chunks;
  } catch (err) {
    console.warn('[AutoCaptionX Audio] Audio chunking fallback to single segment:', err);
    return [
      {
        index: 0,
        totalChunks: 1,
        startOffsetMs: 0,
        endOffsetMs: targetDurationMs || 30000,
        durationMs: targetDurationMs || 30000,
        blob: file,
      },
    ];
  }
}

// Convert AudioBuffer to standard 16-bit PCM WAV Blob
export function audioBufferToWav(audioBuffer: AudioBuffer, targetSampleRate = 16000): Blob {
  const numChannels = 1; // Mono
  const sampleRate = targetSampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  // Mix down channels to mono and resample to 16kHz
  const originalChannelData = audioBuffer.getChannelData(0);
  let channelData: Float32Array;

  if (audioBuffer.sampleRate !== targetSampleRate) {
    const ratio = audioBuffer.sampleRate / targetSampleRate;
    const newLength = Math.round(audioBuffer.length / ratio);
    channelData = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const originalIndex = Math.floor(i * ratio);
      channelData[i] = originalChannelData[originalIndex] || 0;
    }
  } else {
    channelData = originalChannelData;
  }

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + channelData.length * bytesPerSample);
  const view = new DataView(wavBuffer);

  // Write WAV Header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + channelData.length * bytesPerSample, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, channelData.length * bytesPerSample, true);

  // Write PCM Samples
  let offset = 44;
  for (let i = 0; i < channelData.length; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

