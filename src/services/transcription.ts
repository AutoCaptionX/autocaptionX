import type { CaptionWord, CaptionLanguageMode } from '../types';

export interface TranscriptionResult {
  id: string;
  status: 'completed' | 'failed';
  text: string;
  words: CaptionWord[];
  source: string;
  detectedLanguage?: string;
}

// Client-side direct fallback to AssemblyAI (when running on static hosts like GitHub Pages without Express backend)
export async function transcribeDirectAssemblyAI(
  file: File,
  apiKey: string,
  languageMode: CaptionLanguageMode = 'translate-en',
  onProgress?: (progress: number) => void
): Promise<TranscriptionResult> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error('AssemblyAI API Key is missing');
  }

  onProgress?.(15);

  // 1. Upload audio/video binary buffer directly to AssemblyAI
  const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: {
      authorization: cleanKey,
      'content-type': 'application/octet-stream',
    },
    body: file,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`AssemblyAI Upload failed (${uploadResponse.status}): ${errorText || 'Authentication/Network error'}`);
  }

  const uploadData = (await uploadResponse.json()) as { upload_url: string };
  const audioUrl = uploadData.upload_url;
  onProgress?.(35);

  // 2. Submit transcription job
  const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      authorization: cleanKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      punctuate: true,
      format_text: true,
      language_detection: true,
    }),
  });

  if (!transcriptResponse.ok) {
    const errorText = await transcriptResponse.text();
    throw new Error(`AssemblyAI Transcript request failed (${transcriptResponse.status}): ${errorText}`);
  }

  const transcriptData = (await transcriptResponse.json()) as { id: string; status: string };
  const transcriptId = transcriptData.id;
  onProgress?.(50);

  // 3. Poll for completion
  let attempts = 0;
  const maxAttempts = 120; // 2 minutes

  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    attempts++;

    const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: { authorization: cleanKey },
    });

    if (!pollResponse.ok) continue;

    const pollData = (await pollResponse.json()) as any;
    onProgress?.(Math.min(90, 50 + attempts * 2));

    if (pollData.status === 'completed') {
      const rawWords: CaptionWord[] = (pollData.words || []).map((w: any) => ({
        text: String(w.text || '').trim(),
        start: Math.round(Number(w.start) || 0),
        end: Math.round(Number(w.end) || 0),
        confidence: Number(w.confidence) || 0.95,
      }));

      return {
        id: transcriptId,
        status: 'completed',
        text: pollData.text || rawWords.map((w) => w.text).join(' '),
        words: rawWords,
        source: 'assemblyai-client-direct',
        detectedLanguage: pollData.language_code || 'auto',
      };
    }

    if (pollData.status === 'error') {
      throw new Error(pollData.error || 'AssemblyAI transcription failed');
    }
  }

  throw new Error('Transcription timed out after 2 minutes');
}
