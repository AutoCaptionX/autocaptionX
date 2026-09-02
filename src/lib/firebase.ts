import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  onAuthStateChanged,
  type User
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Detect if running on GitHub Pages or custom host
const isGitHubHost = typeof window !== 'undefined' && (
  window.location.hostname.includes('github.io') ||
  window.location.hostname.includes('autocaptionx')
);

const effectiveConfig = {
  ...firebaseConfig,
  projectId: isGitHubHost ? 'vizotube-77980' : (firebaseConfig.projectId || 'vizotube-77980'),
  authDomain: isGitHubHost ? 'vizotube-77980.firebaseapp.com' : (firebaseConfig.authDomain || 'vizotube-77980.firebaseapp.com'),
};

const app = !getApps().length ? initializeApp(effectiveConfig) : getApp();

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Configure Google provider defaults
googleProvider.setCustomParameters({
  prompt: 'select_account',
});
googleProvider.addScope('email');
googleProvider.addScope('profile');

export const db = getFirestore(app, effectiveConfig.firestoreDatabaseId || '(default)');

// Set browser local persistence immediately
if (auth) {
  setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.warn('Firebase setPersistence notice:', err);
  });
}

export {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User
};

