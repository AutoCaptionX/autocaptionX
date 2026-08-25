import React from 'react';
import { Sparkles, FolderGit2, LogIn, LogOut, Key, CheckCircle2, AlertCircle, Download } from 'lucide-react';
import type { User } from '../lib/firebase';

interface HeaderProps {
  user: User | null;
  onOpenAuth: () => void;
  onSignOut: () => void;
  onOpenProjects: () => void;
  onOpenKeyModal: () => void;
  assemblyConfigured: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  onOpenAuth,
  onSignOut,
  onOpenProjects,
  onOpenKeyModal,
  assemblyConfigured,
}) => {
  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40 px-4 sm:px-8 py-3.5 flex items-center justify-between shadow-sm text-slate-100">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-sm shadow-blue-500/30 text-white font-bold text-sm">
          <Sparkles className="w-4 h-4 text-white fill-white" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-lg tracking-tight text-white">
            AutoCaption<span className="text-blue-500">X</span>
          </span>
          <span className="text-[11px] font-medium text-slate-400 bg-slate-800 border border-slate-700/80 px-1.5 py-0.5 rounded-md">
            v2.0
          </span>
        </div>
      </div>

      {/* Center Nav */}
      <nav className="hidden md:flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700/80 text-xs font-medium">
        <span className="px-3 py-1.5 rounded-lg bg-slate-900 text-blue-400 font-semibold shadow-xs border border-slate-700">
          Dashboard
        </span>
        <button
          onClick={onOpenProjects}
          className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700/60 transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <FolderGit2 className="w-3.5 h-3.5 text-slate-400" />
          Projects
        </button>
        <a
          href="#footer-about-us"
          className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700/60 transition-colors cursor-pointer"
        >
          About
        </a>
        <a
          href="#footer-contact-us"
          className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700/60 transition-colors cursor-pointer"
        >
          Contact
        </a>
      </nav>

      {/* Right Actions */}
      <div className="flex items-center gap-2.5">
        {/* Direct Download Project ZIP Button */}
        <a
          href="/api/export-project-zip"
          download="AutoCaptionX-Project-Source.zip"
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600/90 hover:bg-indigo-600 text-white border border-indigo-500/80 shadow-xs flex items-center gap-1.5 transition-all hover:scale-102 active:scale-98"
          title="Download Complete Project as .ZIP Archive"
        >
          <Download className="w-3.5 h-3.5 text-indigo-200" />
          <span className="hidden sm:inline">Download .ZIP</span>
        </a>

        {/* AssemblyAI Status button */}
        <button
          onClick={onOpenKeyModal}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-all cursor-pointer ${
            assemblyConfigured
              ? 'bg-emerald-950/60 border-emerald-800 text-emerald-400 hover:bg-emerald-900/50'
              : 'bg-amber-950/60 border-amber-800 text-amber-300 hover:bg-amber-900/50'
          }`}
          title="AssemblyAI API Key Status"
        >
          <Key className={`w-3.5 h-3.5 ${assemblyConfigured ? 'text-emerald-400' : 'text-amber-400'}`} />
          <span className="hidden md:inline font-semibold">AssemblyAI:</span>
          {assemblyConfigured ? (
            <span className="flex items-center gap-1 font-semibold">
              <CheckCircle2 className="w-3 h-3 inline text-emerald-400" /> Active
            </span>
          ) : (
            <span className="flex items-center gap-1 font-semibold">
              <AlertCircle className="w-3 h-3 inline text-amber-400" /> .env Key
            </span>
          )}
        </button>

        {/* User Auth */}
        {user ? (
          <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-xl p-1 pr-2">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || 'User'}
                className="w-7 h-7 rounded-lg object-cover ring-1 ring-slate-600"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs">
                {(user.displayName?.[0] || user.email?.[0] || 'U').toUpperCase()}
              </div>
            )}
            <span className="text-xs font-semibold text-slate-200 hidden md:inline max-w-[120px] truncate">
              {user.displayName || user.email?.split('@')[0]}
            </span>
            <button
              onClick={onSignOut}
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={onOpenAuth}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer"
          >
            <LogIn className="w-3.5 h-3.5" />
            Sign In
          </button>
        )}
      </div>
    </header>
  );
};
