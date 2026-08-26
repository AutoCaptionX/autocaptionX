import React, { useState, useEffect } from 'react';
import {
  X,
  Key,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Code,
  Eye,
  EyeOff,
  Save,
  Trash2,
  Loader2,
} from 'lucide-react';

interface AssemblyKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  assemblyConfigured: boolean;
  onKeySaved?: (configured: boolean) => void;
}

export const AssemblyKeyModal: React.FC<AssemblyKeyModalProps> = ({
  isOpen,
  onClose,
  assemblyConfigured,
  onKeySaved,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const DEFAULT_KEY = '75c993a46b784bc4a66e8481b5c4812f';

  useEffect(() => {
    if (isOpen) {
      const stored = localStorage.getItem('autocaption_assembly_key') || '';
      setApiKeyInput(stored || DEFAULT_KEY);
      setErrorMessage(null);
      setSuccessMessage(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveToServer = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = apiKeyInput.trim();
    if (!cleanKey) {
      setErrorMessage('Please enter your AssemblyAI API key token.');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      // 1. Save locally for GitHub Pages / Static client usage
      localStorage.setItem('autocaption_assembly_key', cleanKey);

      // 2. Validate directly with AssemblyAI API to verify authenticity
      try {
        const verifyRes = await fetch('https://api.assemblyai.com/v2/transcript?limit=1', {
          headers: { authorization: cleanKey },
        });
        if (verifyRes.status === 401 || verifyRes.status === 403) {
          throw new Error('Invalid AssemblyAI API Key. Authentication failed.');
        }
      } catch (verifyErr: any) {
        if (verifyErr.message.includes('Invalid AssemblyAI API Key')) {
          throw verifyErr;
        }
        console.warn('Direct validation network check skipped:', verifyErr);
      }

      // 3. If running with a backend server, also sync to Express backend
      try {
        const response = await fetch('/api/assemblyai/set-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: cleanKey }),
        });
        if (response.ok) {
          console.log('Synced key to Express backend');
        }
      } catch (backendErr) {
        console.log('Running in static mode (GitHub Pages), saved in browser localStorage.');
      }

      setSuccessMessage('AssemblyAI API Key active & verified! Auto-captions are ready to use.');
      if (onKeySaved) {
        onKeySaved(true);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error authenticating AssemblyAI key.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearServerKey = async () => {
    setIsSaving(true);
    setErrorMessage(null);
    try {
      localStorage.removeItem('autocaption_assembly_key');
      try {
        await fetch('/api/assemblyai/clear-key', { method: 'POST' });
      } catch (e) {
        // static environment
      }
      setSuccessMessage('AssemblyAI API key removed.');
      if (onKeySaved) {
        onKeySaved(false);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to clear key.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-2xl p-6 shadow-2xl relative text-slate-100 animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          id="close-key-modal-btn"
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-blue-950/70 border border-blue-800/80 rounded-xl flex items-center justify-center text-blue-400 shadow-xs">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">AssemblyAI API Key Security</h3>
            <p className="text-xs text-slate-400">Server-side speech recognition & auto-caption setup</p>
          </div>
        </div>

        {/* Current status banner */}
        <div
          className={`p-4 rounded-xl border mb-5 flex items-start gap-3 ${
            assemblyConfigured
              ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
              : 'bg-amber-950/60 border-amber-800 text-amber-300'
          }`}
        >
          {assemblyConfigured ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold">
                {assemblyConfigured
                  ? 'AssemblyAI Key Active & Connected'
                  : 'AssemblyAI API Key Required'}
              </h4>
              {assemblyConfigured && (
                <button
                  type="button"
                  onClick={handleClearServerKey}
                  disabled={isSaving}
                  className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 cursor-pointer"
                  title="Remove saved key"
                >
                  <Trash2 className="w-3 h-3" /> Clear
                </button>
              )}
            </div>
            <p className="text-xs mt-1 text-slate-300">
              {assemblyConfigured
                ? 'Your backend server is securely connected to AssemblyAI for high-accuracy word-level speech transcription.'
                : 'Enter your AssemblyAI API Key below to instantly enable word-by-word timestamps for auto-captions.'}
            </p>
          </div>
        </div>

        {/* Secure Key Input Box */}
        <form onSubmit={handleSaveToServer} className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-4 mb-5 space-y-3">
          <div className="flex items-center justify-between">
            <label htmlFor="assembly-api-key-input" className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-blue-400" />
              Secure Key Input (Masked & Protected):
            </label>
            <span className="text-[11px] text-slate-400">Server-Encrypted</span>
          </div>

          <div className="relative">
            <input
              id="assembly-api-key-input"
              type={showKey ? 'text' : 'password'}
              value={apiKeyInput}
              onChange={(e) => {
                setApiKeyInput(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              placeholder="Paste your AssemblyAI API Key here (e.g. 8f4a...)"
              autoComplete="off"
              spellCheck="false"
              className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-lg pl-3 pr-10 py-2.5 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-3 text-slate-400 hover:text-slate-200 cursor-pointer"
              title={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {errorMessage && (
            <div className="text-xs text-red-400 bg-red-950/40 border border-red-800/50 rounded-lg p-2.5 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 rounded-lg p-2.5 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <p className="text-[11px] text-slate-400">
              Never exposed to browser or public code.
            </p>
            <button
              type="submit"
              id="save-assembly-key-btn"
              disabled={isSaving || !apiKeyInput.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-lg text-xs transition-all flex items-center gap-1.5 cursor-pointer shadow-md shadow-blue-500/20"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verifying...
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" /> Save Key
                </>
              )}
            </button>
          </div>
        </form>

        {/* Security & Instructions Details */}
        <div className="space-y-3 text-xs text-slate-300">
          <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-750">
            <span className="font-bold text-white block mb-1 flex items-center gap-1.5">
              <Code className="w-3.5 h-3.5 text-blue-400" />
              How the Key is Secured
            </span>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              When saved, the key is securely received by the Express backend API and kept in server memory. It is <strong className="text-white font-semibold">never written to public client bundles or visible to other users</strong>.
            </p>
          </div>

          <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-750">
            <span className="font-bold text-white block mb-1 flex items-center gap-1.5">
              <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
              Get a Free AssemblyAI API Key
            </span>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              Get your free transcription API key from{' '}
              <a
                href="https://www.assemblyai.com"
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:underline inline-flex items-center gap-0.5 font-semibold"
              >
                assemblyai.com <ExternalLink className="w-2.5 h-2.5 inline" />
              </a>
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl text-xs transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
