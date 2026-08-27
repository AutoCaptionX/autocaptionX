export type VideoResolution = '720p' | '1080p' | '4k';
export type CaptionLanguageMode = 'translate-en' | 'original' | 'romanized-hinglish';

export interface CaptionWord {
  text: string;
  start: number; // in milliseconds
  end: number;
  confidence?: number;
}

export interface CaptionUtterance {
  speaker?: string;
  text: string;
  start: number;
  end: number;
  words: CaptionWord[];
}

export interface CaptionJobData {
  id: string;
  fileName: string;
  fileSize?: string;
  status: 'idle' | 'uploading' | 'transcribing' | 'rendering' | 'completed' | 'error';
  progress: number;
  resolution: VideoResolution;
  transcriptText: string;
  words: CaptionWord[];
  videoBlobUrl?: string;
  createdAt: string;
  userId?: string;
}

export type CaptionPreset = 'hormozi' | 'beast' | 'clean' | 'neon' | 'classic';

export interface CaptionStyle {
  preset: CaptionPreset;
  fontSize: number;
  highlightColor: string;
  textColor: string;
  strokeColor: string;
  strokeWidth: number;
  positionY: number; // 0 to 100% from top
}
