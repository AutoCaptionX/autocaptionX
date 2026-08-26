import React, { useEffect, useState } from 'react';
import { X, FolderGit2, Video, Calendar, Sparkles, Loader2, Play } from 'lucide-react';
import { fetchUserProjects, type AppUser } from '../lib/authService';
import type { CaptionJobData } from '../types';

interface ProjectsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: AppUser | null;
  onOpenAuth: () => void;
  onSelectProject?: (job: CaptionJobData) => void;
}

export const ProjectsModal: React.FC<ProjectsModalProps> = ({
  isOpen,
  onClose,
  user,
  onOpenAuth,
  onSelectProject,
}) => {
  const [projects, setProjects] = useState<CaptionJobData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !user) {
      return;
    }

    const loadProjects = async () => {
      setLoading(true);
      try {
        const list = await fetchUserProjects(user);
        setProjects(list);
      } catch (err) {
        console.error('Error fetching projects:', err);
      } finally {
        setLoading(false);
      }
    };

    loadProjects();
  }, [isOpen, user]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-xl rounded-2xl p-6 shadow-2xl relative text-slate-100 animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-blue-950/70 border border-blue-800/80 rounded-xl flex items-center justify-center text-blue-400 shadow-xs">
            <FolderGit2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Saved Projects & Captions</h3>
            <p className="text-xs text-slate-400">Stored securely in your Firestore Cloud database</p>
          </div>
        </div>

        {!user ? (
          <div className="text-center py-10 bg-slate-800/60 border border-slate-700/80 rounded-2xl p-6">
            <Sparkles className="w-8 h-8 text-blue-400 mx-auto mb-2 opacity-80" />
            <h4 className="text-sm font-bold text-slate-200">Sign In to Save Projects</h4>
            <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
              Connect your Firebase account to automatically synchronize and manage your video captions across devices.
            </p>
            <button
              onClick={() => {
                onClose();
                onOpenAuth();
              }}
              className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-500/20 transition-all cursor-pointer"
            >
              Sign In with Firebase
            </button>
          </div>
        ) : loading ? (
          <div className="py-12 flex flex-col items-center justify-center text-slate-400 text-xs gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
            <span>Loading your projects from Firestore...</span>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-10 bg-slate-800/60 border border-slate-700/80 rounded-2xl p-6">
            <Video className="w-8 h-8 text-slate-500 mx-auto mb-2" />
            <h4 className="text-sm font-bold text-slate-300">No Captioned Projects Yet</h4>
            <p className="text-xs text-slate-400 mt-1">
              Upload an MP4 or MOV video on the dashboard to generate and save your first captioned video.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {projects.map((proj) => (
              <div
                key={proj.id}
                className="bg-slate-800/80 hover:bg-slate-800 border border-slate-700 rounded-xl p-3.5 flex items-center justify-between transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-950/70 border border-blue-800/80 text-blue-400 flex items-center justify-center shrink-0">
                    <Video className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-slate-200 group-hover:text-blue-400 transition-colors">
                      {proj.fileName}
                    </h5>
                    <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-500" />
                        {new Date(proj.createdAt).toLocaleDateString()}
                      </span>
                      <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 font-mono font-semibold">
                        {proj.resolution || '1080p'}
                      </span>
                    </div>
                  </div>
                </div>

                {onSelectProject && (
                  <button
                    onClick={() => {
                      onSelectProject(proj);
                      onClose();
                    }}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-blue-600 hover:text-white text-slate-200 border border-slate-700 hover:border-blue-600 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Play className="w-3 h-3" /> Load
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
