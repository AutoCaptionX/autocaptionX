import React, { useState } from 'react';
import { X, Mail, Lock, User as UserIcon, AlertCircle, Loader2, Sparkles, ShieldCheck, ArrowRight, Zap, ExternalLink } from 'lucide-react';
import { createAccount, signInAccount, signInGoogle, isMobileDevice, setLocalSessionUser } from '../lib/authService';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    const isMobile = isMobileDevice();
    setStatusMessage(isMobile ? 'Redirecting to Google Sign-In...' : 'Opening Google Account Chooser...');

    try {
      const user = await signInGoogle();
      if (user) {
        setStatusMessage('Authenticated! Syncing workspace...');
        setTimeout(() => {
          onClose();
          onSuccess?.();
        }, 300);
      }
    } catch (err: any) {
      console.error('[AutoCaptionX Auth] Google Sign-In Error:', err);
      setError(err.message || 'Failed to sign in with Google');
    } finally {
      setLoading(false);
      setStatusMessage(null);
    }
  };

  const handleGuestSignIn = () => {
    const guestUser = {
      uid: 'guest_' + Math.random().toString(36).substring(2, 10),
      email: 'creator@autocaptionx.local',
      displayName: 'AutoCaption Creator',
      photoURL: null,
      provider: 'local' as const,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    setLocalSessionUser(guestUser);
    setStatusMessage('Access granted! Loading workspace...');
    setTimeout(() => {
      onClose();
      onSuccess?.();
      window.location.reload();
    }, 300);
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter both email and password');
      return;
    }
    setError(null);
    setLoading(true);
    setStatusMessage(isRegister ? 'Creating your account...' : 'Signing in...');

    try {
      if (isRegister) {
        await createAccount(email, password, name);
      } else {
        await signInAccount(email, password);
      }
      setStatusMessage('Welcome! Syncing workspace...');
      setTimeout(() => {
        onClose();
        onSuccess?.();
      }, 300);
    } catch (err: any) {
      console.error('[AutoCaptionX Auth] Email Auth error:', err);
      let msg = err.message || 'Authentication failed';
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        msg = 'Invalid email or password combination';
      } else if (err.code === 'auth/email-already-in-use') {
        msg = 'An account with this email already exists';
      } else if (err.code === 'auth/weak-password') {
        msg = 'Password should be at least 6 characters';
      }
      setError(msg);
    } finally {
      setLoading(false);
      setStatusMessage(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-6 shadow-2xl relative text-slate-100 animate-in fade-in zoom-in-95 duration-200 max-h-[95vh] overflow-y-auto">
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Brand Icon & Heading */}
        <div className="text-center mb-5">
          <div className="w-12 h-12 bg-blue-950/70 border border-blue-800/80 rounded-2xl flex items-center justify-center mx-auto mb-2.5 text-blue-400 shadow-xs">
            <Sparkles className="w-6 h-6 fill-blue-400" />
          </div>
          <h3 className="text-xl font-bold text-white">
            {isRegister ? 'Create AutoCaptionX Account' : 'Sign in to AutoCaptionX'}
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Save captioned projects, synchronized timelines & exports
          </p>
        </div>

        {/* Status notification */}
        {statusMessage && (
          <div className="mb-4 p-3 bg-blue-950/60 border border-blue-800 rounded-xl text-blue-300 text-xs flex items-center gap-2 animate-pulse">
            <Loader2 className="w-4 h-4 text-blue-400 shrink-0 animate-spin" />
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Error notification */}
        {error && (
          <div className="mb-4 p-3 bg-red-950/60 border border-red-800/80 rounded-xl text-red-300 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        {/* Prominent Direct Google Sign-In Button */}
        <div className="space-y-2.5 mb-4">
          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full py-3 px-4 bg-white hover:bg-slate-100 text-slate-900 font-bold rounded-xl text-sm flex items-center justify-center gap-3 transition-all active:scale-[0.99] disabled:opacity-60 cursor-pointer shadow-md hover:shadow-lg"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>{loading ? 'Connecting...' : 'Continue with Google'}</span>
          </button>
        </div>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-800" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-slate-900 px-3 text-slate-500 font-medium">Or continue with email</span>
          </div>
        </div>

        {/* Email & Password Form */}
        <form onSubmit={handleEmailAuth} className="space-y-3">
          {isRegister && (
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Full Name</label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Arbaz Khan"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9.5 pr-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:bg-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Email address</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9.5 pr-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:bg-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="•••••••• (Min 6 characters)"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9.5 pr-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:bg-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-50 cursor-pointer mt-1"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isRegister ? (
              <>
                <span>Create Free Account</span>
                <ArrowRight className="w-4 h-4" />
              </>
            ) : (
              <>
                <span>Sign In</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Toggle between Register, Login, and Instant Access */}
        <div className="mt-4 flex flex-col items-center gap-2">
          <div className="text-center text-xs text-slate-400 flex items-center justify-center gap-1.5">
            <span>{isRegister ? 'Already have an account?' : "Don't have an account?"}</span>
            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setError(null);
              }}
              className="text-blue-400 hover:text-blue-300 font-semibold cursor-pointer underline-offset-2 hover:underline"
            >
              {isRegister ? 'Sign In' : 'Sign Up Free'}
            </button>
          </div>

          <button
            type="button"
            onClick={handleGuestSignIn}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 py-1 px-3 rounded-lg hover:bg-slate-800/80 transition-colors cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5 text-yellow-400" />
            <span>Instant Guest Mode (No sign up needed)</span>
          </button>
        </div>

        <div className="mt-3.5 pt-2.5 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
          <span>Universal Auth • Instant Google & Cloud Sync</span>
        </div>
      </div>
    </div>
  );
};


