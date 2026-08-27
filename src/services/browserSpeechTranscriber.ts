import type { CaptionWord, CaptionLanguageMode } from '../types';
import { polishCaptionWords, translateHindiWordsToEnglish, transliterateDevanagariToHinglish } from './transcription';

// Browser Web Speech Recognition Engine for 100% offline & client-side backup
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

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = videoBlobUrl;
    video.muted = false;
    video.volume = 0.01; // subtle audible playback for speech API to capture
    video.playsInline = true;

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = languageMode === 'original' ? 'hi-IN' : 'en-US';

    const detectedWords: CaptionWord[] = [];
    let isFinished = false;

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

      let processedWords = polishCaptionWords(detectedWords);
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

    recognition.onresult = (event: any) => {
      const currentTimeMs = Math.round(video.currentTime * 1000);

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const transcript = event.results[i][0].transcript.trim();
          const wordsList = transcript.split(/\s+/).filter(Boolean);
          const durationPerWord = 300;
          const chunkStart = Math.max(0, currentTimeMs - (wordsList.length * durationPerWord));

          wordsList.forEach((wordText: string, idx: number) => {
            const start = chunkStart + idx * durationPerWord;
            const end = start + durationPerWord - 30;
            detectedWords.push({
              text: wordText,
              start,
              end,
              confidence: event.results[i][0].confidence || 0.95,
            });
          });
        }
      }
    };

    recognition.onerror = (err: any) => {
      console.warn('Browser speech recognition notice:', err);
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
      setTimeout(finishSuccess, 800);
    };

    video.onloadedmetadata = () => {
      try {
        recognition.start();
        video.play().catch(() => {
          // If autoplay restricted
          video.muted = true;
          video.play();
        });
      } catch (e) {
        reject(e);
      }
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Unable to read video media stream.'));
    };

    // Safety timeout (max 45 seconds)
    setTimeout(() => {
      if (!isFinished) {
        finishSuccess();
      }
    }, 45000);
  });
}
