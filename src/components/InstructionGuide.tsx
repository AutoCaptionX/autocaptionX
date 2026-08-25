import React, { useState } from 'react';
import {
  Sparkles,
  Upload,
  Languages,
  Download,
  Zap,
  Clock,
  ShieldCheck,
  Sliders,
  ChevronDown,
  ChevronUp,
  FileVideo,
  CheckCircle2,
} from 'lucide-react';

export const InstructionGuide: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'how-to' | 'features'>('how-to');
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm text-slate-100 mt-2 backdrop-blur-xs">
      {/* Header with Title & Collapse Toggle */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-slate-100 flex items-center gap-1.5">
              AutoCaptionX Guide & Features
            </h3>
            <p className="text-[11px] text-slate-400">
              Create viral, high-accuracy captioned videos in seconds
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Tab Switcher */}
          <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px]">
            <button
              type="button"
              onClick={() => {
                setActiveTab('how-to');
                setIsCollapsed(false);
              }}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                activeTab === 'how-to' && !isCollapsed
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              How to Use
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('features');
                setIsCollapsed(false);
              }}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                activeTab === 'features' && !isCollapsed
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Features
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            title={isCollapsed ? 'Expand Guide' : 'Collapse Guide'}
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Collapsible Content Body */}
      {!isCollapsed && (
        <div className="pt-3.5 space-y-4 animate-in fade-in duration-200">
          {/* TAB 1: HOW TO USE */}
          {activeTab === 'how-to' && (
            <div className="grid grid-cols-1 gap-2.5">
              {/* Step 1 */}
              <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <div className="w-6 h-6 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0 text-xs font-bold font-mono mt-0.5">
                  1
                </div>
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5 text-blue-400" />
                    <h4 className="text-xs font-bold text-slate-200">Upload Your Video</h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Drag and drop any MP4, MOV, or WebM video file (supports short clips or long videos up to 30 mins, max 5GB), or click <strong className="text-slate-300 font-medium">"Load Sample Video"</strong> for an instant preview.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <div className="w-6 h-6 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400 flex items-center justify-center shrink-0 text-xs font-bold font-mono mt-0.5">
                  2
                </div>
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Languages className="w-3.5 h-3.5 text-purple-400" />
                    <h4 className="text-xs font-bold text-slate-200">Choose Language & Resolution</h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Select <strong className="text-slate-300 font-medium">"Translate to English"</strong> (Hindi/Regional to natural English) or keep original audio script. Choose your preferred export resolution (<strong className="text-slate-300 font-medium">1080p FHD, 4K UHD, or 720p</strong>).
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <div className="w-6 h-6 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0 text-xs font-bold font-mono mt-0.5">
                  3
                </div>
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                    <h4 className="text-xs font-bold text-slate-200">Generate, Edit & Download</h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Hit <strong className="text-slate-300 font-medium">"Create Captions"</strong>. Preview in real-time, adjust subtitle styles or timestamps in the timeline synchronizer, and click <strong className="text-slate-300 font-medium">"Download"</strong> to save your ready-to-post video!
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: KEY FEATURES */}
          {activeTab === 'features' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Feature 1 */}
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                <div className="flex items-center gap-1.5 text-blue-400">
                  <Zap className="w-3.5 h-3.5" />
                  <h5 className="text-xs font-bold text-slate-200">Karaoke Word Highlighting</h5>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Millisecond-level word timing ensures subtitles light up exactly as spoken with zero delay and steady phrase holds.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                <div className="flex items-center gap-1.5 text-purple-400">
                  <Languages className="w-3.5 h-3.5" />
                  <h5 className="text-xs font-bold text-slate-200">Smart Hindi-to-English</h5>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Contextual AI translation translates the true meaning and tone of conversations into natural English subtitles.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <Clock className="w-3.5 h-3.5" />
                  <h5 className="text-xs font-bold text-slate-200">30+ Min Long Videos</h5>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Intelligent chunked engine processes podcasts, interviews, and long tutorials smoothly from 0:00 to the end.
                </p>
              </div>

              {/* Feature 4 */}
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                <div className="flex items-center gap-1.5 text-amber-400">
                  <Sliders className="w-3.5 h-3.5" />
                  <h5 className="text-xs font-bold text-slate-200">Timeline & Preset Editor</h5>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Fine-tune word timings with ±50ms micro-adjustments, edit spelling, and switch between viral caption presets.
                </p>
              </div>
            </div>
          )}

          {/* Bottom Quick Tips Banner */}
          <div className="p-2.5 rounded-xl bg-blue-950/30 border border-blue-900/50 flex items-center justify-between text-[11px] text-blue-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
              <span>
                <strong>Pro Tip:</strong> Click any word in the Timeline Editor to instantly jump to that timestamp in the video preview.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
