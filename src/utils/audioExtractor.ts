// Audio extraction utility using Web Audio API to extract lightweight 16kHz WAV from video files
export async function extractAudioFromMediaFile(file: File): Promise<{ blob: Blob; durationMs: number }> {
  // If file is already a lightweight audio file (< 10MB audio), return it directly
  if (file.type.startsWith('audio/') && file.size < 12 * 1024 * 1024) {
    return { blob: file, durationMs: 0 };
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      return { blob: file, durationMs: 0 };
    }

    const audioCtx = new AudioContextClass({ sampleRate: 16000 });
    const decodedAudio = await audioCtx.decodeAudioData(arrayBuffer);
    const durationMs = Math.round(decodedAudio.duration * 1000);

    // Convert audio buffer to mono 16kHz 16-bit PCM WAV Blob
    const wavBlob = audioBufferToWav(decodedAudio, 16000);
    return { blob: wavBlob, durationMs };
  } catch (err) {
    console.warn('Web Audio extraction fallback to direct file:', err);
    return { blob: file, durationMs: 0 };
  }
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
