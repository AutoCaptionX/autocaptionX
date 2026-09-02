import type { CaptionWord, CaptionLanguageMode } from '../types';
import { polishCaptionWords, translateHindiWordsToEnglish, transliterateDevanagariToHinglish } from './transcription';
import { decodeAudioBufferFromFile, alignWordTimestampsWithAudio } from '../utils/audioExtractor';

// Browser Web Speech Recognition Engine with Web Audio API Context Alignment
export async function transcribeWithBrowserSpeech(
  videoBlobUrl: string,
  languageMode: CaptionLanguageMode = 'translate-en',
  onProgress?: (progress: number) => void
): Promise<{ text: string; words: CaptionWord[]; source: string }> {
  const SpeechRecognitionClass =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  if (!SpeechRecognitionClass) {
    throw new Error('Web Speech Recognition not supported in this browser.');
  }

  // Pre-fetch blob and decode AudioBuffer for Web Audio API context alignment
  let decodedAudioBuffer: AudioBuffer | null = null;
  try {
    const resp = await fetch(videoBlobUrl);
    if (resp.ok) {
      const blob = await resp.blob();
      decodedAudioBuffer = await decodeAudioBufferFromFile(blob);
    }
  } catch (audioFetchErr) {
    console.warn('[AutoCaptionX Speech] AudioBuffer pre-decode note:', audioFetchErr);
  }

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = videoBlobUrl;
    video.muted = false;
    video.volume = 0.05; // Audible playback for speech recognition capture
    video.playsInline = true;

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = languageMode === 'original' ? 'hi-IN' : 'en-US';

    const detectedWords: CaptionWord[] = [];
    let isFinished = false;
    let speechStartMs = 0;
    let lastSpokenEndMs = 0;

    const cleanup = () => {
      try {
        recognition.stop();
        video.pause();
        video.remove();
      } catch (e) {}
    };

    const finishSuccess = async () => {
      if (isFinished) return;
      isFinished = true;
      cleanup();

      if (detectedWords.length === 0) {
        reject(new Error('No speech detected in audio stream.'));
        return;
      }

      // Step 1: Align words with Web Audio API context energy envelope
      const audioAlignedWords = alignWordTimestampsWithAudio(detectedWords, decodedAudioBuffer);

      // Step 2: Polish spelling, capitalizations, and punctuation
      let processedWords = polishCaptionWords(audioAlignedWords);

      // Step 3: Handle translation / transliteration
      if (languageMode === 'translate-en') {
        processedWords = await translateHindiWordsToEnglish(processedWords, onProgress);
      } else if (languageMode === 'romanized-hinglish') {
        processedWords = processedWords.map((w) => ({
          ...w,
          text: transliterateDevanagariToHinglish(w.text),
        }));
      }

      resolve({
        text: processedWords.map((w) => w.text).join(' '),
        words: processedWords,
        source: 'browser-speech-engine',
      });
    };

    recognition.onspeechstart = () => {
      speechStartMs = Math.round(video.currentTime * 1000);
    };

    recognition.onaudiostart = () => {
      if (speechStartMs === 0) {
        speechStartMs = Math.round(video.currentTime * 1000);
      }
    };

    recognition.onresult = (event: any) => {
      const currentVideoMs = Math.round(video.currentTime * 1000);

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const transcript = event.results[i][0].transcript.trim();
          const wordsList = transcript.split(/\s+/).filter(Boolean);
          if (wordsList.length === 0) continue;

          // Calculate precise time span for this speech segment
          const segStart = Math.max(lastSpokenEndMs, speechStartMs > 0 ? speechStartMs : currentVideoMs - wordsList.length * 280);
          const segEnd = Math.max(segStart + 200, currentVideoMs);
          const totalDuration = Math.max(wordsList.length * 160, segEnd - segStart);

          // Calculate character-weighted lengths for proportional natural speech distribution
          const charWeights = wordsList.map((w: string) => Math.max(2, w.replace(/[^\w]/g, '').length));
          const totalWeight = charWeights.reduce((a: number, b: number) => a + b, 0);

          let currentWordStart = segStart;

          wordsList.forEach((wordText: string, idx: number) => {
            const wordWeight = charWeights[idx] / totalWeight;
            const wordDuration = Math.max(120, Math.round(totalDuration * wordWeight));
            const wordEnd = idx === wordsList.length - 1 ? segEnd : currentWordStart + wordDuration;

            detectedWords.push({
              text: wordText,
              start: currentWordStart,
              end: Math.max(currentWordStart + 80, wordEnd),
              confidence: event.results[i][0].confidence || 0.95,
            });

            currentWordStart = wordEnd;
          });

          lastSpokenEndMs = segEnd;
          speechStartMs = currentVideoMs; // Reset for next chunk
        }
      }
    };

    recognition.onerror = (err: any) => {
      console.warn('[AutoCaptionX Speech] Speech recognition notice:', err?.error || err);
    };

    recognition.onend = () => {
      if (!isFinished && video.currentTime < video.duration - 0.5) {
        try {
          recognition.start();
        } catch (e) {}
      } else {
        finishSuccess();
      }
    };

    video.onended = () => {
      setTimeout(finishSuccess, 600);
    };

    video.onloadedmetadata = () => {
      try {
        speechStartMs = 0;
        const totalDuration = isFinite(video.duration) && video.duration > 0 ? video.duration : 30;
        const safetyTimeoutMs = Math.max(60000, Math.round((totalDuration + 15) * 1000));
        setTimeout(() => {
          if (!isFinished) {
            finishSuccess();
          }
        }, safetyTimeoutMs);

        recognition.start();
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => {});
        });
      } catch (e) {
        reject(e);
      }
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Unable to read video media stream.'));
    };
  });
}

