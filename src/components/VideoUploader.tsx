import React, { useRef, useState } from 'react';
import { UploadCloud, Video, CheckCircle2, X } from 'lucide-react';

interface VideoUploaderProps {
  selectedFile: File | null;
  onFileSelect: (file: File) => void;
  onFileRemove: () => void;
  onLoadSample?: () => void;
  disabled?: boolean;
}

export const VideoUploader: React.FC<VideoUploaderProps> = ({
  selectedFile,
  onFileSelect,
  onFileRemove,
  onLoadSample,
  disabled = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('video/') || file.name.match(/\.(mp4|mov|webm|mkv|avi|flv|wmv|m4v|3gp)$/i) || file.type === '') {
        onFileSelect(file);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelect(e.target.files[0]);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*, .mp4, .mkv, .webm, .mov"
        onChange={handleChange}
        className="hidden"
        disabled={disabled}
      />

      {!selectedFile ? (
        <div className="space-y-2">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !disabled && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-7 text-center transition-all cursor-pointer select-none bg-slate-900/90 border-slate-700 shadow-sm ${
              isDragging
                ? 'border-blue-500 bg-blue-950/40 ring-2 ring-blue-500/30'
                : 'hover:border-blue-500 hover:bg-slate-850/80'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto mb-3 text-blue-400 shadow-xs group-hover:scale-105 transition-transform">
              <UploadCloud className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-100 mb-1">
              Upload or Drag Video Here
            </h4>
            <p className="text-xs text-slate-400 font-medium">
              16:9 Landscape & 9:16 Portrait • MP4, MOV, WebM, MKV <span className="font-semibold text-blue-400">(Up to 5 GB supported)</span>
            </p>
          </div>

          {onLoadSample && (
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={onLoadSample}
                disabled={disabled}
                className="text-xs text-blue-400 hover:text-blue-300 font-semibold py-1.5 px-3 rounded-lg hover:bg-slate-800/80 border border-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Video className="w-3.5 h-3.5" /> Or click to load demo video with speech
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-blue-950/60 border border-blue-800/80 flex items-center justify-center text-blue-400 shrink-0">
              <Video className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-100 truncate max-w-xs md:max-w-md">
                  {selectedFile.name}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                <span>{formatFileSize(selectedFile.size)}</span>
                <span className="text-slate-600">•</span>
                <span className="inline-flex items-center gap-1 text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-full text-[11px] font-semibold border border-emerald-800">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Ready
                </span>
              </div>
            </div>
          </div>

          {!disabled && (
            <button
              onClick={onFileRemove}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-colors shrink-0 cursor-pointer"
              title="Remove file"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
