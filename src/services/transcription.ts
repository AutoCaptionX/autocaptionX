import type { CaptionWord, CaptionLanguageMode } from '../types';

export interface TranscriptionResult {
  id: string;
  status: 'completed' | 'failed';
  text: string;
  words: CaptionWord[];
  source: string;
  detectedLanguage?: string;
}

// Common Hindi/Hinglish vocabulary dictionary for instant high-accuracy translation
const HINDI_TRANSLATION_MAP: Record<string, string> = {
  'नमस्ते': 'Hello',
  'नमस्कार': 'Greetings',
  'हेलो': 'Hello',
  'हाय': 'Hi',
  'दोस्तों': 'friends',
  'दोस्त': 'friend',
  'भाई': 'brother',
  'भाईयों': 'brothers',
  'बहन': 'sister',
  'बहनों': 'sisters',
  'आज': 'Today',
  'कल': 'Tomorrow',
  'हम': 'we',
  'आप': 'you',
  'तुम': 'you',
  'मैं': 'I',
  'मेरा': 'my',
  'मेरी': 'my',
  'मेरे': 'my',
  'आपका': 'your',
  'आपकी': 'your',
  'आपके': 'your',
  'बात': 'talk',
  'करेंगे': 'will discuss',
  'करेंगे।': 'will discuss.',
  'करूंगा': 'will do',
  'करूँगा': 'will do',
  'करते': 'do',
  'करना': 'to do',
  'है': 'is',
  'हैं': 'are',
  'था': 'was',
  'थी': 'was',
  'थे': 'were',
  'होगा': 'will be',
  'होगी': 'will be',
  'होंगे': 'will be',
  'बहुत': 'very',
  'अच्छा': 'good',
  'अच्छी': 'good',
  'अच्छे': 'good',
  'बढ़िया': 'great',
  'शानदार': 'amazing',
  'सुंदर': 'beautiful',
  'प्यारा': 'lovely',
  'वीडियो': 'video',
  'कैप्शन': 'caption',
  'सबटाइटल': 'subtitles',
  'लाइक': 'like',
  'शेयर': 'share',
  'सब्सक्राइब': 'subscribe',
  'फॉलो': 'follow',
  'कमेंट': 'comment',
  'करो': 'do',
  'कीजिए': 'please do',
  'देखो': 'watch',
  'सुनो': 'listen',
  'समझो': 'understand',
  'सीखो': 'learn',
  'कैसे': 'how',
  'क्यों': 'why',
  'क्या': 'what',
  'कब': 'when',
  'कहाँ': 'where',
  'ये': 'this',
  'यह': 'this',
  'वो': 'that',
  'वह': 'that',
  'यहाँ': 'here',
  'वहाँ': 'there',
  'एक': 'one',
  'दो': 'two',
  'तीन': 'three',
  'नया': 'new',
  'नई': 'new',
  'नए': 'new',
  'सब': 'all',
  'लोग': 'people',
  'शुक्रिया': 'Thank you',
  'धन्यवाद': 'Thank you',
};

// Transliterate Devanagari to Romanized Hinglish
export function transliterateDevanagariToHinglish(text: string): string {
  const map: Record<string, string> = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
    'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
    'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
    'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
    'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
    'ष': 'sh', 'स': 's', 'ह': 'h', 'अ': 'a', 'आ': 'aa',
    'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ए': 'e',
    'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ा': 'a', 'ि': 'i',
    'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'े': 'e', 'ै': 'ai',
    'ो': 'o', 'ौ': 'au', '्': '', 'ं': 'n', 'ँ': 'n',
  };
  let res = '';
  for (const char of text) {
    res += map[char] || char;
  }
  return res || text;
}

// Client-Side Cloud Translation with fallback
async function translateTextToEnglish(text: string): Promise<string> {
  const clean = text.trim();
  if (!clean) return '';

  // 1. Try public Google Translate endpoint (No API key needed, fast)
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(clean)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const translatedStr = data[0].map((item: any) => item[0]).join('');
        if (translatedStr && translatedStr.trim()) {
          return translatedStr.trim();
        }
      }
    }
  } catch (err) {
    console.warn('Google Translate API notice, using dictionary fallback:', err);
  }

  // 2. Dictionary-based fallback
  const words = clean.split(/\s+/);
  const translatedWords = words.map((w) => {
    const stripped = w.replace(/[.,!?:;|]/g, '');
    const punctuation = w.replace(/^[^.,!?:;|]+/, '');
    const mapped = HINDI_TRANSLATION_MAP[stripped] || stripped;
    return mapped + punctuation;
  });

  return translatedWords.join(' ');
}

// Proportionally maps translated English words to precise millisecond timestamps
export async function translateHindiWordsToEnglish(
  rawWords: CaptionWord[],
  onProgress?: (progress: number) => void
): Promise<CaptionWord[]> {
  if (!rawWords || rawWords.length === 0) return [];

  // Group raw words into natural sentence/clause chunks
  const chunks: Array<{ words: CaptionWord[]; start: number; end: number; rawText: string }> = [];
  let currentGroup: CaptionWord[] = [];

  const flush = () => {
    if (currentGroup.length === 0) return;
    const start = currentGroup[0].start;
    const end = currentGroup[currentGroup.length - 1].end;
    const rawText = currentGroup.map((w) => w.text).join(' ');
    chunks.push({ words: [...currentGroup], start, end, rawText });
    currentGroup = [];
  };

  for (let i = 0; i < rawWords.length; i++) {
    const w = rawWords[i];
    const prev = currentGroup[currentGroup.length - 1];

    const hasPunct = prev && /[.!?,\u0964|\n]/.test(prev.text);
    const hasTimeGap = prev && w.start - prev.end > 700;
    const isMaxWords = currentGroup.length >= 6;

    if (currentGroup.length > 0 && (hasPunct || hasTimeGap || isMaxWords)) {
      flush();
    }
    currentGroup.push(w);
  }
  flush();

  const finalResult: CaptionWord[] = [];

  for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
    const chunk = chunks[cIdx];
    const duration = Math.max(300, chunk.end - chunk.start);

    // Check if chunk has Hindi characters
    const hasHindi = /[\u0900-\u097F]/.test(chunk.rawText);

    let translatedSegmentText = chunk.rawText;
    if (hasHindi) {
      try {
        translatedSegmentText = await translateTextToEnglish(chunk.rawText);
      } catch {
        translatedSegmentText = chunk.rawText;
      }
    }

    const engWords = translatedSegmentText
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean);

    if (engWords.length === 0) {
      // Keep original if empty
      chunk.words.forEach((w) => finalResult.push(w));
      continue;
    }

    // Distribute time proportionally across the exact segment duration
    const totalChars = engWords.reduce((sum, w) => sum + w.length, 0) || 1;
    let currentStart = chunk.start;

    engWords.forEach((word, wIdx) => {
      const weight = word.length / totalChars;
      const wordDuration = Math.max(180, Math.round(duration * weight));
      const wordEnd = wIdx === engWords.length - 1 ? chunk.end : Math.min(chunk.end, currentStart + wordDuration);

      finalResult.push({
        text: word,
        start: currentStart,
        end: Math.max(currentStart + 100, wordEnd),
        confidence: 0.98,
      });

      currentStart = wordEnd;
    });

    if (onProgress) {
      const pct = 70 + Math.round(((cIdx + 1) / chunks.length) * 25);
      onProgress(Math.min(96, pct));
    }
  }

  // Ensure timestamps are strictly non-decreasing and non-overlapping
  for (let i = 0; i < finalResult.length - 1; i++) {
    if (finalResult[i].end > finalResult[i + 1].start) {
      finalResult[i].end = Math.max(finalResult[i].start + 80, finalResult[i + 1].start);
    }
  }

  return finalResult;
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

  // 2. Submit transcription job with language detection
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
  const maxAttempts = 150; // 3.5 minutes for full videos

  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    attempts++;

    const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: { authorization: cleanKey },
    });

    if (!pollResponse.ok) continue;

    const pollData = (await pollResponse.json()) as any;
    onProgress?.(Math.min(75, 50 + attempts));

    if (pollData.status === 'completed') {
      const rawWords: CaptionWord[] = (pollData.words || []).map((w: any) => ({
        text: String(w.text || '').trim(),
        start: Math.round(Number(w.start) || 0),
        end: Math.round(Number(w.end) || 0),
        confidence: Number(w.confidence) || 0.95,
      }));

      let processedWords = rawWords;

      // Handle language modes
      if (languageMode === 'translate-en') {
        onProgress?.(80);
        // Translate Hindi / foreign words to English with full duration sync
        processedWords = await translateHindiWordsToEnglish(rawWords, onProgress);
      } else if (languageMode === 'romanized-hinglish') {
        processedWords = rawWords.map((w) => ({
          ...w,
          text: transliterateDevanagariToHinglish(w.text),
        }));
      }

      return {
        id: transcriptId,
        status: 'completed',
        text: processedWords.map((w) => w.text).join(' '),
        words: processedWords,
        source: 'assemblyai-client-direct',
        detectedLanguage: pollData.language_code || 'auto',
      };
    }

    if (pollData.status === 'error') {
      throw new Error(pollData.error || 'AssemblyAI transcription failed');
    }
  }

  throw new Error('Transcription timed out after 3 minutes');
}
