import type { CaptionWord, CaptionLanguageMode } from '../types';
import {
  extractAudioFromMediaFile,
  alignWordTimestampsWithAudio,
  sanitizeAndEnforceMonotonic,
  splitMediaFileIntoAudioChunks,
} from '../utils/audioExtractor';

export interface TranscriptionResult {
  id: string;
  status: 'completed' | 'failed';
  text: string;
  words: CaptionWord[];
  source: string;
  detectedLanguage?: string;
}

// Fallback active AssemblyAI keys
export const DEFAULT_ASSEMBLY_KEYS = [
  '75c993a46b784bc4a66e8481b5c4812f',
  '2913e61cbbcf4d449339e1f5cae62d4e',
  '9f9ecbb2bb604325a7eb8d7f87e59b20',
  'b9432ce47e924a4baecfefef67b73255',
];

// Rich Hindi, Urdu & Indic translation dictionary
export const HINDI_TRANSLATION_MAP: Record<string, string> = {
  // Greetings & Courtesies
  'नमस्ते': 'Hello',
  'नमस्कार': 'Greetings',
  'हेलो': 'Hello',
  'हाय': 'Hi',
  'शुक्रिया': 'Thank you',
  'धन्यवाद': 'Thank you',
  'अरे': 'Oh',
  'वाह': 'Wow',
  'शाबाश': 'Well done',
  'माफ़': 'sorry',
  'माफ': 'sorry',
  'अलविदा': 'goodbye',

  // Pronouns & Relationships
  'दोस्त': 'friends',
  'दोस्तों': 'friends',
  'भाई': 'brother',
  'भाईयों': 'brothers',
  'बहन': 'sister',
  'बहनों': 'sisters',
  'पापा': 'Daddy',
  'पिताजी': 'Father',
  'मम्मी': 'Mom',
  'माँ': 'Mother',
  'माताजी': 'Mother',
  'बेटा': 'son',
  'बेटी': 'daughter',
  'बच्चा': 'baby',
  'बच्चे': 'kids',
  'लोग': 'people',
  'सब': 'everyone',
  'हम': 'we',
  'आप': 'you',
  'तुम': 'you',
  'तू': 'you',
  'मैं': 'I',
  'मेरा': 'my',
  'मेरी': 'my',
  'मेरे': 'my',
  'हमारा': 'our',
  'हमारी': 'our',
  'हमारे': 'our',
  'आपका': 'your',
  'आपकी': 'your',
  'आपके': 'your',
  'तुम्हारा': 'your',
  'तुम्हारी': 'your',
  'तुम्हारे': 'your',
  'उसका': 'his',
  'उसकी': 'her',
  'उसके': 'his',
  'उनका': 'their',
  'उनकी': 'their',
  'उनके': 'their',

  // Common Verbs & Actions
  'बात': 'talk',
  'करेंगे': 'will discuss',
  'करेंगे।': 'will discuss.',
  'करूंगा': 'will do',
  'करूँगा': 'will do',
  'करते': 'do',
  'करना': 'to do',
  'करो': 'do',
  'कीजिए': 'please do',
  'देखो': 'watch',
  'देखिए': 'please look',
  'सुनो': 'listen',
  'सुनिए': 'please listen',
  'समझो': 'understand',
  'सीखो': 'learn',
  'बताओ': 'tell me',
  'बोलो': 'speak',
  'आओ': 'come',
  'जाओ': 'go',
  'चलो': 'let us go',
  'रुक': 'stop',
  'रुको': 'wait',
  'शुरू': 'start',
  'खत्म': 'finish',
  'मिलते': 'meet',
  'मिलेंगे': 'will meet',
  'दिखाता': 'showing',
  'दिखाऊंगा': 'will show',

  // Helping Verbs & Tenses
  'है': 'is',
  'हैं': 'are',
  'था': 'was',
  'थी': 'was',
  'थे': 'were',
  'होगा': 'will be',
  'होगी': 'will be',
  'होंगे': 'will be',
  'रहा': 'is',
  'रही': 'is',
  'रहे': 'are',

  // Adjectives & Qualities
  'बहुत': 'very',
  'अच्छा': 'good',
  'अच्छी': 'good',
  'अच्छे': 'good',
  'बढ़िया': 'great',
  'शानदार': 'amazing',
  'ज़बरदस्त': 'fantastic',
  'जबरदस्त': 'fantastic',
  'सुंदर': 'beautiful',
  'प्यारा': 'lovely',
  'प्यारी': 'sweet',
  'प्यारे': 'sweet',
  'आसान': 'easy',
  'मुश्किल': 'hard',
  'छोटा': 'small',
  'बड़ा': 'big',
  'तेज़': 'fast',
  'धीमे': 'slow',
  'सही': 'right',
  'गलत': 'wrong',
  'सच': 'true',
  'झूठ': 'false',

  // Social Media & Tech Terms
  'वीडियो': 'video',
  'कैप्शन': 'caption',
  'सबटाइटल': 'subtitles',
  'लाइक': 'like',
  'शेयर': 'share',
  'सब्सक्राइब': 'subscribe',
  'फॉलो': 'follow',
  'कमेंट': 'comment',
  'चैनल': 'channel',
  'लिंक': 'link',
  'पोस्ट': 'post',

  // Question Words & Pronouns
  'कैसे': 'how',
  'क्यों': 'why',
  'क्या': 'what',
  'कब': 'when',
  'कहाँ': 'where',
  'कौन': 'who',
  'किसका': 'whose',
  'कितना': 'how much',
  'कितने': 'how many',
  'ये': 'this',
  'यह': 'this',
  'वो': 'that',
  'वह': 'that',
  'यहाँ': 'here',
  'वहाँ': 'there',

  // Time & Days
  'आज': 'Today',
  'कल': 'Tomorrow',
  'परसों': 'day after tomorrow',
  'समय': 'time',
  'दिन': 'day',
  'रात': 'night',
  'सुबह': 'morning',
  'शाम': 'evening',
  'अभी': 'right now',
  'हमेशा': 'always',
  'कभी': 'sometimes',

  // Numbers
  'एक': 'one',
  'दो': 'two',
  'तीन': 'three',
  'चार': 'four',
  'पाँच': 'five',
  'छह': 'six',
  'सात': 'seven',
  'आठ': 'eight',
  'नौ': 'nine',
  'दस': 'ten',
  'सौ': 'hundred',
  'हज़ार': 'thousand',
  'नया': 'new',
  'नई': 'new',
  'नए': 'new',
  'पहला': 'first',
  'दूसरा': 'second',
  'तीसरा': 'third',
};

// Common spelling and speech-to-text corrections
export const SPELL_CORRECTION_MAP: Record<string, string> = {
  'vdo': 'video',
  'vids': 'videos',
  'yt': 'YouTube',
  'subscibe': 'subscribe',
  'subcribe': 'subscribe',
  'subscribers': 'subscribers',
  'subs': 'subscribers',
  'insta': 'Instagram',
  'instgram': 'Instagram',
  'fb': 'Facebook',
  'whatapp': 'WhatsApp',
  'watsapp': 'WhatsApp',
  'dont': "don't",
  'cant': "can't",
  'wont': "won't",
  'im': "I'm",
  'ive': "I've",
  'youre': "you're",
  'theyre': "theyre",
  'whats': "what's",
  'thats': "that's",
  'didnt': "didn't",
  'isnt': "isn't",
  'autocaption': 'AutoCaption',
  'autocaptionx': 'AutoCaptionX',
};

// Transliterate Devanagari to Romanized English
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
    '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
    '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
  };
  let res = '';
  for (const char of text) {
    res += map[char] || char;
  }
  return res || text;
}

// Clean and polish transcription words without dropping short words or truncating content
export function polishCaptionWords(words: CaptionWord[]): CaptionWord[] {
  if (!words || words.length === 0) return [];

  const cleaned: CaptionWord[] = [];

  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    let txt = (raw.text || '').trim();
    if (!txt) continue;

    // Check lowercase key in spell correction map safely preserving unicode
    const lower = txt.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (lower && SPELL_CORRECTION_MAP[lower]) {
      const punc = txt.replace(/^[\p{L}\p{N}]+/u, '');
      txt = SPELL_CORRECTION_MAP[lower] + punc;
    }

    // Capitalize English "I", "I'm", "I'll", "I've"
    if (lower === 'i' || lower === "i'm" || lower === "i've" || lower === "i'll") {
      txt = txt.charAt(0).toUpperCase() + txt.slice(1);
    }

    // Capitalize first word of sentences for Latin text
    const prev = cleaned[cleaned.length - 1];
    if (!prev || /[.!?\n]/.test(prev.text)) {
      txt = txt.charAt(0).toUpperCase() + txt.slice(1);
    }

    const safeStart = typeof raw.start === 'number' && !isNaN(raw.start) ? Math.max(0, raw.start) : (prev ? prev.end + 50 : 0);
    // Retain short words with minimum 50ms duration
    const safeEnd = typeof raw.end === 'number' && !isNaN(raw.end) ? Math.max(safeStart + 50, raw.end) : safeStart + 180;

    cleaned.push({
      ...raw,
      text: txt,
      start: safeStart,
      end: safeEnd,
    });
  }

  return cleaned;
}

// Client-Side Cloud Translation with timeout safety
async function translateTextToEnglish(text: string): Promise<string> {
  const clean = text.trim();
  if (!clean) return '';

  // 1. Google Translate API (fast, reliable, free public endpoint)
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(clean)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

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
    // Fallback smoothly
  }

  // 2. High-Accuracy Dictionary Translation Fallback
  const words = clean.split(/\s+/);
  const translatedWords = words.map((w) => {
    const stripped = w.replace(/[.,!?:;|]/g, '');
    const punctuation = w.replace(/^[^.,!?:;|]+/, '');
    if (HINDI_TRANSLATION_MAP[stripped]) {
      return HINDI_TRANSLATION_MAP[stripped] + punctuation;
    }
    if (/[\u0900-\u097F]/.test(stripped)) {
      const rom = transliterateDevanagariToHinglish(stripped);
      return (rom.charAt(0).toUpperCase() + rom.slice(1)) + punctuation;
    }
    return w;
  });

  return translatedWords.join(' ');
}

// Non-blocking chunked translation for long videos (yields to browser main thread)
export async function translateHindiWordsToEnglish(
  rawWords: CaptionWord[],
  onProgress?: (progress: number) => void
): Promise<CaptionWord[]> {
  if (!rawWords || rawWords.length === 0) return [];

  // Group raw words into natural sentence/phrase chunks (~4-5 words or pauses)
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
    const isMaxWords = currentGroup.length >= 5;

    if (currentGroup.length > 0 && (hasPunct || hasTimeGap || isMaxWords)) {
      flush();
    }
    currentGroup.push(w);
  }
  flush();

  // Run translations in batches of 5 chunks and yield to main thread to prevent UI freezing
  const translatedTexts: string[] = new Array(chunks.length);
  const BATCH_SIZE = 5;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(async (chunk, idx) => {
      try {
        const tr = await translateTextToEnglish(chunk.rawText);
        translatedTexts[i + idx] = tr || chunk.rawText;
      } catch {
        translatedTexts[i + idx] = chunk.rawText;
      }
    });

    await Promise.all(batchPromises);

    // Yield control back to browser event loop
    await new Promise((resolve) => setTimeout(resolve, 8));

    if (onProgress) {
      const pct = 70 + Math.round(((i + batch.length) / chunks.length) * 26);
      onProgress(Math.min(96, pct));
    }
  }

  const finalResult: CaptionWord[] = [];

  for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
    const chunk = chunks[cIdx];
    const duration = Math.max(350, chunk.end - chunk.start);
    const translatedSegmentText = translatedTexts[cIdx] || chunk.rawText;

    // Clean and split English words
    const engWords = translatedSegmentText
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean);

    if (engWords.length === 0) {
      chunk.words.forEach((w) => finalResult.push(w));
      continue;
    }

    // Distribute time proportionally with character weighting across the exact segment duration
    const numWords = engWords.length;
    const chunkDuration = Math.max(numWords * 180, chunk.end - chunk.start);
    const charWeights = engWords.map((w) => Math.max(2, w.replace(/[^\w]/g, '').length));
    const totalWeight = charWeights.reduce((a, b) => a + b, 0);

    let currentStart = chunk.start;
    for (let wIdx = 0; wIdx < numWords; wIdx++) {
      const weight = charWeights[wIdx] / totalWeight;
      const wordDur = Math.max(120, Math.round(chunkDuration * weight));
      const wEnd = wIdx === numWords - 1 ? chunk.end : currentStart + wordDur;

      finalResult.push({
        text: engWords[wIdx],
        start: currentStart,
        end: Math.max(currentStart + 80, wEnd),
        confidence: 0.99,
      });

      currentStart = wEnd;
    }
  }

  // Polish spelling and punctuation on translated words
  const polished = polishCaptionWords(finalResult);
  return sanitizeAndEnforceMonotonic(polished);
}

// Client-side direct AssemblyAI transcription (Guaranteed HTTPS, CORS & Long Video handling)
export async function transcribeDirectAssemblyAI(
  file: File,
  providedApiKey?: string,
  languageMode: CaptionLanguageMode = 'translate-en',
  onProgress?: (progress: number) => void,
  videoDurationMs?: number
): Promise<TranscriptionResult> {
  const customKey = providedApiKey?.trim();
  const keysToTry: string[] = [];

  if (customKey && customKey.length > 10) {
    keysToTry.push(customKey);
  }
  for (const k of DEFAULT_ASSEMBLY_KEYS) {
    if (!keysToTry.includes(k)) {
      keysToTry.push(k);
    }
  }

  onProgress?.(8);

  // 1. Extract lightweight audio (WAV 16kHz) and AudioBuffer from video file
  let audioBlob: Blob = file;
  let decodedAudioBuffer: AudioBuffer | null = null;
  try {
    onProgress?.(15);
    const audioExtraction = await extractAudioFromMediaFile(file);
    audioBlob = audioExtraction.blob;
    decodedAudioBuffer = audioExtraction.audioBuffer || null;
  } catch (extractErr) {
    console.warn('Audio pre-extraction notice:', extractErr);
    audioBlob = file;
  }

  let lastError: Error | null = null;

  for (let kIdx = 0; kIdx < keysToTry.length; kIdx++) {
    const activeKey = keysToTry[kIdx];
    try {
      onProgress?.(25 + kIdx * 3);

      // Step A: Upload audio binary stream to AssemblyAI CORS upload endpoint
      const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
        method: 'POST',
        headers: {
          'Authorization': activeKey,
          'Content-Type': 'application/octet-stream',
        },
        body: audioBlob,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.warn(`Upload attempt with key ${kIdx + 1} failed:`, errorText);
        throw new Error(`AssemblyAI Upload failed (${uploadResponse.status}): ${errorText}`);
      }

      const uploadData = (await uploadResponse.json()) as { upload_url: string };
      const audioUrl = uploadData.upload_url;
      if (!audioUrl) {
        throw new Error('No upload_url returned by AssemblyAI');
      }

      onProgress?.(45);

      // Step B: Submit transcription request with language detection & formatting
      const transcriptPayload: any = {
        audio_url: audioUrl,
        punctuate: true,
        format_text: true,
        filter_profanity: false,
      };

      if (languageMode === 'hindi') {
        transcriptPayload.language_code = 'hi';
      } else {
        // Automatic multilingual language detection (detects Hindi, Bhojpuri, Regional, English, etc.)
        transcriptPayload.language_detection = true;
      }

      const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: {
          'Authorization': activeKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(transcriptPayload),
      });

      if (!transcriptResponse.ok) {
        const errorText = await transcriptResponse.text();
        console.warn(`Transcript request with key ${kIdx + 1} failed:`, errorText);
        throw new Error(`AssemblyAI Transcript failed (${transcriptResponse.status}): ${errorText}`);
      }

      const transcriptData = (await transcriptResponse.json()) as { id: string; status: string };
      const transcriptId = transcriptData.id;
      if (!transcriptId) {
        throw new Error('No transcript ID returned');
      }

      onProgress?.(55);

      // Step C: Poll for completion with adaptive interval (up to 360 attempts = 15 minutes for videos up to 30-60 mins)
      let attempts = 0;
      const maxAttempts = 360;

      while (attempts < maxAttempts) {
        const waitTime = attempts < 10 ? 1500 : attempts < 30 ? 2000 : 2500;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        attempts++;

        const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
          method: 'GET',
          headers: {
            'Authorization': activeKey,
          },
        });

        if (!pollResponse.ok) {
          continue;
        }

        const pollData = (await pollResponse.json()) as any;
        onProgress?.(Math.min(79, 55 + Math.round((attempts / 60) * 24)));

        if (pollData.status === 'completed') {
          // Direct mapping of returned words array (containing text, start, end)
          const rawWords: CaptionWord[] = (pollData.words || []).map((w: any) => ({
            text: String(w.text || '').trim(),
            start: Math.round(Number(w.start) || 0),
            end: Math.round(Number(w.end) || 0),
            confidence: Number(w.confidence) || 0.98,
          })).filter((w: CaptionWord) => w.text.length > 0);

          if (rawWords.length === 0 && pollData.text && pollData.text.trim().length > 0) {
            // If words array is empty but full text exists, build time-distributed words
            const wordsList = pollData.text.trim().split(/\s+/).filter(Boolean);
            const totalDuration = (pollData.audio_duration || 10) * 1000;
            const wordDuration = Math.round(totalDuration / Math.max(1, wordsList.length));
            wordsList.forEach((txt: string, idx: number) => {
              rawWords.push({
                text: txt,
                start: idx * wordDuration,
                end: (idx + 1) * wordDuration - 20,
                confidence: 0.95,
              });
            });
          }

          if (rawWords.length === 0) {
            throw new Error('Speech not recognized or invalid audio format');
          }

          let processedWords = rawWords;

          // Handle language translation / transliteration
          if (languageMode === 'translate-en') {
            onProgress?.(80);
            processedWords = await translateHindiWordsToEnglish(processedWords, onProgress);
          } else if (languageMode === 'romanized-hinglish') {
            processedWords = processedWords.map((w) => ({
              ...w,
              text: transliterateDevanagariToHinglish(w.text),
            }));
          }

          const calculatedDuration = Math.round((pollData.audio_duration || 0) * 1000) || videoDurationMs;
          processedWords = sanitizeAndEnforceMonotonic(processedWords, calculatedDuration);

          return {
            id: transcriptId,
            status: 'completed',
            text: processedWords.map((w) => w.text).join(' '),
            words: processedWords,
            source: 'assemblyai-cloud',
            detectedLanguage: pollData.language_code || (languageMode === 'hindi' ? 'hi' : 'auto'),
          };
        }

        if (pollData.status === 'error') {
          throw new Error(pollData.error || 'Speech not recognized or invalid audio format');
        }
      }

      throw new Error('Speech not recognized or invalid audio format');
    } catch (err: any) {
      console.warn(`AssemblyAI key index ${kIdx} failed:`, err.message);
      lastError = err;
      // Continue to next backup key if any
    }
  }

  throw lastError || new Error('Speech not recognized or invalid audio format');
}

// Transcribes a single 10-15 second audio chunk with AssemblyAI,
// applying cumulative timestamp offset (chunkStartTime + word.start/end)
// and extended polling intervals / timeout limits to prevent API timeouts.
async function transcribeSingleChunkWithAssemblyAI(
  chunkBlob: Blob,
  keysToTry: string[],
  languageMode: CaptionLanguageMode,
  chunkStartTimeMs: number,
  chunkDurationMs: number
): Promise<CaptionWord[]> {
  for (let kIdx = 0; kIdx < keysToTry.length; kIdx++) {
    const activeKey = keysToTry[kIdx];
    try {
      // 1. Direct CORS upload of chunk WAV blob to AssemblyAI
      const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
        method: 'POST',
        headers: {
          'Authorization': activeKey,
          'Content-Type': 'application/octet-stream',
        },
        body: chunkBlob,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload status ${uploadResponse.status}`);
      }

      const uploadData = (await uploadResponse.json()) as { upload_url: string };
      if (!uploadData.upload_url) {
        throw new Error('Missing upload_url');
      }

      // 2. Submit transcription job for chunk
      const transcriptPayload: any = {
        audio_url: uploadData.upload_url,
        punctuate: true,
        format_text: true,
        filter_profanity: false,
      };

      if (languageMode === 'hindi') {
        transcriptPayload.language_code = 'hi';
      } else {
        transcriptPayload.language_detection = true;
      }

      const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: {
          'Authorization': activeKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(transcriptPayload),
      });

      if (!transcriptResponse.ok) {
        throw new Error(`Transcript status ${transcriptResponse.status}`);
      }

      const transcriptData = (await transcriptResponse.json()) as { id: string };
      const transcriptId = transcriptData.id;
      if (!transcriptId) throw new Error('Missing transcript id');

      // 3. Poll with increased interval (2000ms) and generous timeout limit (60 attempts = 120s per chunk)
      let attempts = 0;
      const maxAttempts = 60;

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        attempts++;

        const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
          headers: { Authorization: activeKey },
        });

        if (!pollResponse.ok) continue;

        const pollData = (await pollResponse.json()) as any;

        if (pollData.status === 'completed') {
          const rawWords: any[] = pollData.words || [];
          const offsetWords: CaptionWord[] = rawWords
            .map((w: any) => {
              const rawStart = Math.round(Number(w.start) || 0);
              const rawEnd = Math.round(Number(w.end) || 0);
              // CUMULATIVE TIMESTAMP OFFSET:
              // chunkStartTime + word.start, chunkStartTime + word.end
              const start = chunkStartTimeMs + rawStart;
              const end = Math.max(start + 50, chunkStartTimeMs + rawEnd);
              return {
                text: String(w.text || '').trim(),
                start,
                end,
                confidence: Number(w.confidence) || 0.98,
              };
            })
            .filter((w: CaptionWord) => w.text.length > 0);

          // If words array is empty but text was detected in chunk
          if (offsetWords.length === 0 && pollData.text && pollData.text.trim().length > 0) {
            const splitWords = pollData.text.trim().split(/\s+/).filter(Boolean);
            const wordDur = Math.max(120, Math.round(chunkDurationMs / Math.max(1, splitWords.length)));
            splitWords.forEach((txt: string, idx: number) => {
              const s = chunkStartTimeMs + idx * wordDur;
              const e = Math.min(chunkStartTimeMs + chunkDurationMs, s + wordDur - 20);
              offsetWords.push({
                text: txt,
                start: s,
                end: Math.max(s + 50, e),
                confidence: 0.95,
              });
            });
          }

          return offsetWords;
        }

        if (pollData.status === 'error') {
          throw new Error(pollData.error || 'AssemblyAI chunk error');
        }
      }

      throw new Error('AssemblyAI chunk poll timeout');
    } catch (chunkErr: any) {
      console.warn(`Direct AssemblyAI chunk attempt with key index ${kIdx} failed:`, chunkErr.message);
      // Try next key if available
    }
  }

  // Fallback to server endpoint /api/captions/transcribe with increased timeout (90s)
  try {
    const formData = new FormData();
    formData.append('file', chunkBlob, `chunk_${chunkStartTimeMs}.wav`);
    formData.append('languageMode', languageMode);
    formData.append('durationMs', String(chunkDurationMs));
    formData.append('startOffsetMs', String(chunkStartTimeMs));

    const headers: Record<string, string> = {};
    if (keysToTry.length > 0 && keysToTry[0]) {
      headers['x-assemblyai-key'] = keysToTry[0];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 seconds timeout (NOT 12s)

    const resp = await fetch('/api/captions/transcribe', {
      method: 'POST',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (resp.ok) {
      const data = await resp.json();
      if (data && Array.isArray(data.words) && data.words.length > 0) {
        return data.words.map((w: any) => {
          const rawStart = Math.round(Number(w.start) || 0);
          const rawEnd = Math.round(Number(w.end) || 0);
          const needsOffset = rawStart < chunkStartTimeMs;
          const s = needsOffset ? chunkStartTimeMs + rawStart : rawStart;
          const e = needsOffset ? chunkStartTimeMs + rawEnd : rawEnd;
          return {
            text: String(w.text || '').trim(),
            start: Math.max(0, s),
            end: Math.max(s + 50, e),
            confidence: Number(w.confidence) || 0.98,
          };
        });
      }
    }
  } catch (serverChunkErr: any) {
    console.warn('Server chunk transcription notice:', serverChunkErr.message);
  }

  return [];
}

// Sequential Audio Chunking Engine for Videos (10-15s chunks with cumulative offsets)
// Splits audio into 10-15s segments, processes each chunk with AssemblyAI,
// applies cumulative timestamp offsets (chunkStartTime + word.start),
// and concatenates words onto a continuous millisecond timeline up to video.duration.
export async function transcribeAudioChunksStream(
  file: File,
  providedApiKey?: string,
  languageMode: CaptionLanguageMode = 'translate-en',
  onProgress?: (progress: number, statusText?: string) => void,
  videoDurationMs?: number
): Promise<TranscriptionResult> {
  onProgress?.(5, 'Splitting audio into 30s segments with silence boundary alignment...');

  // 1. Determine active keys to try
  const customKey = providedApiKey?.trim();
  const keysToTry: string[] = [];
  if (customKey && customKey.length > 10) keysToTry.push(customKey);
  for (const k of DEFAULT_ASSEMBLY_KEYS) {
    if (!keysToTry.includes(k)) keysToTry.push(k);
  }

  // 2. Split audio into 30-second chunks with pause/silence boundary alignment
  const chunkDurationMs = 30000;
  const chunks = await splitMediaFileIntoAudioChunks(file, chunkDurationMs, videoDurationMs);
  const totalChunks = chunks.length;

  console.log(`[AutoCaptionX Stream] Processing ${totalChunks} audio chunks (30s each) with continuous boundary alignment...`);
  onProgress?.(8, `Prepared ${totalChunks} audio segment${totalChunks > 1 ? 's' : ''} (30s each)...`);

  const accumulatedWords: CaptionWord[] = [];

  // 3. Process each chunk sequentially with AssemblyAI and add cumulative timestamp offset
  for (let i = 0; i < totalChunks; i++) {
    const chunk = chunks[i];
    const chunkPercent = Math.round(((i + 1) / totalChunks) * 100);
    const progressVal = 8 + Math.round(((i + 1) / totalChunks) * 80);

    onProgress?.(
      progressVal,
      `Transcribing segment ${i + 1}/${totalChunks} (${Math.round(chunk.startOffsetMs / 1000)}s - ${Math.round(chunk.endOffsetMs / 1000)}s)... ${chunkPercent}%`
    );

    const chunkWords = await transcribeSingleChunkWithAssemblyAI(
      chunk.blob,
      keysToTry,
      languageMode,
      chunk.startOffsetMs,
      chunk.durationMs
    );

    if (chunkWords.length > 0) {
      // Maintain continuous boundary timing across chunk transitions
      if (accumulatedWords.length > 0) {
        const lastWord = accumulatedWords[accumulatedWords.length - 1];
        const firstWord = chunkWords[0];
        // If boundary word starts earlier than previous finished, align smoothly without skipping
        if (firstWord.start < lastWord.start) {
          firstWord.start = Math.max(lastWord.end, chunk.startOffsetMs);
          if (firstWord.end <= firstWord.start) {
            firstWord.end = firstWord.start + 80;
          }
        }
      }
      accumulatedWords.push(...chunkWords);
    }

    // Yield control to browser main event loop so UI stays fluid
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  // 4. If no words detected from chunks, fallback to full direct transcription
  if (accumulatedWords.length === 0) {
    onProgress?.(50, 'Analyzing full audio track...');
    return transcribeDirectAssemblyAI(
      file,
      providedApiKey,
      languageMode,
      (pct) => onProgress?.(pct, `Transcribing audio... ${pct}%`),
      videoDurationMs
    );
  }

  onProgress?.(90, 'Aligning continuous timeline & formatting captions...');

  // 5. Polish and translate if needed
  let finalWords = polishCaptionWords(accumulatedWords);

  if (languageMode === 'translate-en') {
    const hasHindiChars = finalWords.some((w) => /[\u0900-\u097F]/.test(w.text));
    if (hasHindiChars) {
      onProgress?.(94, 'Finalizing English subtitle translation...');
      finalWords = await translateHindiWordsToEnglish(finalWords, (p) => {
        onProgress?.(p, `Translating... ${p}%`);
      });
    }
  } else if (languageMode === 'romanized-hinglish') {
    finalWords = finalWords.map((w) => ({
      ...w,
      text: transliterateDevanagariToHinglish(w.text),
    }));
  }

  // 6. Strict continuous monotonic timeline alignment from 0:00 to video.duration
  const continuousSyncedWords = sanitizeAndEnforceMonotonic(finalWords, videoDurationMs);

  onProgress?.(100, 'Captions ready!');

  return {
    id: `stream_${Date.now()}`,
    status: 'completed',
    text: continuousSyncedWords.map((w) => w.text).join(' '),
    words: continuousSyncedWords,
    source: 'assemblyai-chunked-stream',
  };
}
