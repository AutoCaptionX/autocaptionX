import React from 'react';
import { Languages, Sparkles } from 'lucide-react';
import type { CaptionLanguageMode } from '../types';

interface LanguageSelectorProps {
  languageMode: CaptionLanguageMode;
  onChange: (mode: CaptionLanguageMode) => void;
  disabled?: boolean;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  languageMode,
  onChange,
  disabled = false,
}) => {
  return (
    <div className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-3.5 shadow-sm text-slate-100">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-950/70 border border-blue-800/80 text-blue-400 flex items-center justify-center">
            <Languages className="w-3.5 h-3.5" />
          </div>
          <div>
            <span className="text-xs font-bold text-slate-100 block leading-tight">
              Caption Language & Translation
            </span>
            <span className="text-[11px] text-slate-400">
              Auto-translate Hindi & other languages to English
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange('translate-en')}
          className={`py-2 px-3 rounded-xl border text-left transition-all cursor-pointer select-none relative ${
            languageMode === 'translate-en'
              ? 'bg-blue-950/60 border-blue-500 text-white shadow-xs ring-1 ring-blue-500/40'
              : 'bg-slate-800/80 border-slate-700/80 text-slate-200 hover:bg-slate-800 hover:border-slate-600'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold flex items-center gap-1 text-slate-100">
              Translate to English
            </span>
            <span className="px-1.5 py-0.2 bg-blue-600 text-white rounded text-[9px] font-extrabold uppercase tracking-wide">
              Auto
            </span>
          </div>
          <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
            Hindi/Others → English Subtitles
          </p>
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange('original')}
          className={`py-2 px-3 rounded-xl border text-left transition-all cursor-pointer select-none ${
            languageMode === 'original'
              ? 'bg-blue-950/60 border-blue-500 text-white shadow-xs ring-1 ring-blue-500/40'
              : 'bg-slate-800/80 border-slate-700/80 text-slate-200 hover:bg-slate-800 hover:border-slate-600'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <span className="text-xs font-bold block text-slate-100 leading-tight">
            Original Language
          </span>
          <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
            Keep exact native words (Hindi/Original)
          </p>
        </button>
      </div>
    </div>
  );
};
