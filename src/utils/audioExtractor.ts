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

    const audioCtx = new AudioContextClass({ sampleRate: 16000 });
    const decodedAudio = await audioCtx.decodeAudioData(arrayBuffer);
    return decodedAudio;
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
    const voiceThreshold = Math.max(0.015, avgRms * 0.45, maxRms * 0.08);

    const aligned: CaptionWord[] = [];

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      let startMs = Math.max(0, Math.round(w.start));
      let endMs = Math.max(startMs + 80, Math.round(w.end));

      // 1. Search in a local window [-300ms, +300ms] for closest voice onset (energy rising edge)
      const bucketIdx = Math.floor(startMs / 20);
      const searchRadius = 15; // 15 * 20ms = 300ms
      const minBucket = Math.max(0, bucketIdx - searchRadius);
      const maxBucket = Math.min(rms.length - 1, bucketIdx + searchRadius);

      let bestOnsetMs = startMs;
      let foundOnset = false;

      // Look for the first bucket in the window that crosses the voice threshold
      for (let b = minBucket; b <= maxBucket; b++) {
        if (rms[b] >= voiceThreshold && (b === 0 || rms[b - 1] < voiceThreshold)) {
          bestOnsetMs = timesMs[b];
          foundOnset = true;
          break;
        }
      }

      if (foundOnset && Math.abs(bestOnsetMs - startMs) <= 300) {
        startMs = bestOnsetMs;
      }

      // Ensure min duration weighted by word text length
      const charCount = (w.text || '').replace(/[^\w]/g, '').length || 3;
      const minDuration = Math.max(120, Math.min(650, charCount * 45 + 80));
      endMs = Math.max(startMs + minDuration, endMs);

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

// Helper to guarantee strictly non-decreasing, non-overlapping timestamps
export function sanitizeAndEnforceMonotonic(words: CaptionWord[]): CaptionWord[] {
  if (!words || words.length === 0) return [];

  const result: CaptionWord[] = [];

  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    let s = typeof raw.start === 'number' && !isNaN(raw.start) ? Math.max(0, Math.round(raw.start)) : i * 300;
    let e = typeof raw.end === 'number' && !isNaN(raw.end) ? Math.max(s + 80, Math.round(raw.end)) : s + 250;

    const prev = result[result.length - 1];
    if (prev) {
      if (s < prev.start) {
        s = prev.end + 10;
      }
      if (prev.end > s) {
        prev.end = Math.max(prev.start + 60, s - 10);
      }
      if (e <= s) {
        e = s + 150;
      }
    }

    result.push({
      ...raw,
      text: (raw.text || '').trim(),
      start: s,
      end: e,
    });
  }

  return result;
}

// Convert AudioBuffer to standard 16-bit PCM WAV Blob
function audioBufferToWav(audioBuffer: AudioBuffer, targetSampleRate = 16000): Blob {
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

