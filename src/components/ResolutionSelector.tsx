import React from 'react';
import type { VideoResolution } from '../types';

interface ResolutionSelectorProps {
  selectedResolution: VideoResolution;
  onSelect: (res: VideoResolution) => void;
  disabled?: boolean;
}

export const ResolutionSelector: React.FC<ResolutionSelectorProps> = ({
  selectedResolution,
  onSelect,
  disabled = false,
}) => {
  const options: { id: VideoResolution; label: string; sub: string }[] = [
    { id: '1080p', label: '1080p', sub: 'FULL HD' },
    { id: '4k', label: '4K', sub: 'ULTRA HD' },
    { id: '720p', label: '720p', sub: 'HD' },
  ];

  return (
    <div className="w-full">
      <label className="block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider">
        Select Resolution:
      </label>
      <div className="grid grid-cols-3 gap-2.5">
        {options.map((opt) => {
          const isSelected = selectedResolution === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(opt.id)}
              className={`py-2.5 px-3 rounded-xl border text-center transition-all cursor-pointer select-none ${
                isSelected
                  ? 'bg-blue-950/60 border-blue-500 text-white shadow-xs ring-1 ring-blue-500/40'
                  : 'bg-slate-900 border-slate-800 text-slate-200 hover:bg-slate-800 hover:border-slate-700'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="font-bold text-sm leading-tight text-slate-100">{opt.label}</div>
              <div
                className={`text-[9px] uppercase font-mono tracking-wider mt-0.5 ${
                  isSelected ? 'text-blue-400 font-bold' : 'text-slate-500 font-medium'
                }`}
              >
                {opt.sub}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
