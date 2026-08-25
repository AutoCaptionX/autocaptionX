import React, { useState, useMemo } from 'react';
import { Clock, Edit3, Check, Plus, Trash2, Search, ChevronDown, ChevronUp, FastForward } from 'lucide-react';
import type { CaptionWord, CaptionPreset } from '../types';

interface CaptionTimelineEditorProps {
  words: CaptionWord[];
  currentTimeMs: number;
  onSeek: (ms: number) => void;
  onUpdateWords: (newWords: CaptionWord[]) => void;
  preset: CaptionPreset;
  onPresetChange: (preset: CaptionPreset) => void;
}

export const CaptionTimelineEditor: React.FC<CaptionTimelineEditorProps> = ({
  words,
  currentTimeMs,
  onSeek,
  onUpdateWords,
  preset,
  onPresetChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  if (!words || words.length === 0) return null;

  const handleStartEdit = (idx: number, currentText: string) => {
    setEditingIndex(idx);
    setEditText(currentText);
  };

  const handleSaveEdit = (idx: number) => {
    if (editText.trim() === '') return;
    const updated = [...words];
    updated[idx] = { ...updated[idx], text: editText.trim() };
    onUpdateWords(updated);
    setEditingIndex(null);
  };

  const handleAdjustTiming = (idx: number, deltaMs: number) => {
    const updated = [...words];
    const item = updated[idx];
    const newStart = Math.max(0, item.start + deltaMs);
    const newEnd = Math.max(newStart + 100, item.end + deltaMs);
    updated[idx] = { ...item, start: newStart, end: newEnd };
    onUpdateWords(updated);
  };

  const handleDeleteWord = (idx: number) => {
    const updated = words.filter((_, i) => i !== idx);
    onUpdateWords(updated);
  };

  const handleAddWord = () => {
    const lastWord = words[words.length - 1];
    const start = lastWord ? lastWord.end + 100 : Math.round(currentTimeMs);
    const newWord: CaptionWord = {
      text: 'New Word',
      start,
      end: start + 500,
      confidence: 1.0,
    };
    onUpdateWords([...words, newWord]);
  };

  const formatMs = (ms: number) => {
    const totalSeconds = ms / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = (totalSeconds % 60).toFixed(1);
    return `${minutes}:${seconds.padStart(4, '0')}`;
  };

  // Filter words for fast searching across long videos
  const filteredWords = useMemo(() => {
    if (!searchQuery.trim()) return words;
    const q = searchQuery.toLowerCase();
    return words.filter((w) => w.text.toLowerCase().includes(q));
  }, [words, searchQuery]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm text-slate-100">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-950/70 border border-blue-800/80 text-blue-400 flex items-center justify-center">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-100">
              Captions & Timeline Synchronizer
            </h4>
            <p className="text-[11px] text-slate-400">
              {words.length} synchronized words detected (Up to 30 min full video coverage)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Subtitle Preset Selector */}
          <div className="flex items-center gap-1 bg-slate-800/90 border border-slate-700/80 p-1 rounded-xl">
            {(['hormozi', 'neon', 'clean', 'beast'] as CaptionPreset[]).map((p) => (
              <button
                key={p}
                onClick={() => onPresetChange(p)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer ${
                  preset === p
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {p === 'hormozi' ? 'Reels' : p}
              </button>
            ))}
          </div>

          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title={isOpen ? 'Collapse timeline' : 'Expand timeline'}
          >
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expandable Word-Level Timeline List */}
      {isOpen && (
        <div className="mt-4 pt-4 border-t border-slate-800 space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 text-xs text-slate-400 mb-2">
            {/* Search Bar for long video transcripts */}
            <div className="relative flex-1 max-w-xs">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search word or timestamp in video..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700/80 rounded-lg pl-8 pr-2.5 py-1 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleAddWord}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-400 hover:text-blue-300 bg-blue-950/60 px-2.5 py-1 rounded-lg border border-blue-800/80 cursor-pointer"
              >
                <Plus className="w-3 h-3" /> Add Word
              </button>
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            {filteredWords.map((w, idx) => {
              const originalIndex = words.indexOf(w);
              const isActive = currentTimeMs >= w.start && currentTimeMs <= w.end;
              const isEditing = editingIndex === originalIndex;

              return (
                <div
                  key={`${w.text}-${w.start}-${originalIndex}`}
                  className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition-all ${
                    isActive
                      ? 'bg-blue-950/70 border-blue-500 shadow-md ring-1 ring-blue-500/50'
                      : 'bg-slate-800/80 border-slate-700/80 hover:bg-slate-800 hover:border-slate-600'
                  }`}
                >
                  <div
                    onClick={() => onSeek(w.start)}
                    className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer"
                  >
                    <span className="font-mono text-[10px] text-slate-300 bg-slate-950 border border-slate-700 px-1.5 py-0.5 rounded shrink-0">
                      {formatMs(w.start)}
                    </span>

                    {isEditing ? (
                      <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit(originalIndex)}
                          className="bg-slate-900 border border-blue-400 px-2 py-0.5 rounded text-white text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 w-full"
                          autoFocus
                        />
                        <button
                          onClick={() => handleSaveEdit(originalIndex)}
                          className="p-1 bg-blue-600 text-white rounded hover:bg-blue-700 cursor-pointer"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <span
                        className={`font-bold truncate ${
                          isActive ? 'text-blue-300 scale-105' : 'text-slate-100'
                        }`}
                      >
                        {w.text}
                      </span>
                    )}
                  </div>

                  {/* Micro Timing Adjust & Actions */}
                  <div className="flex items-center gap-1 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleAdjustTiming(originalIndex, -50)}
                      className="px-1.5 py-0.5 text-[10px] bg-slate-900 border border-slate-700 hover:bg-slate-700 rounded text-slate-300 font-mono cursor-pointer"
                      title="-50ms"
                    >
                      -50ms
                    </button>
                    <button
                      onClick={() => handleAdjustTiming(originalIndex, 50)}
                      className="px-1.5 py-0.5 text-[10px] bg-slate-900 border border-slate-700 hover:bg-slate-700 rounded text-slate-300 font-mono cursor-pointer"
                      title="+50ms"
                    >
                      +50ms
                    </button>

                    {!isEditing && (
                      <button
                        onClick={() => handleStartEdit(originalIndex, w.text)}
                        className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-700 cursor-pointer ml-1"
                        title="Edit text"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                    )}

                    <button
                      onClick={() => handleDeleteWord(originalIndex)}
                      className="p-1 text-slate-400 hover:text-red-400 rounded hover:bg-red-950/50 cursor-pointer"
                      title="Delete word"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
