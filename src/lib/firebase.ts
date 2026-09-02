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

export const firebaseConfig = {
  apiKey: "AIzaSyC8irMozxkYpuvva62jchdAcqV9WIgkyMs",
  authDomain: "vizotube-77980.firebaseapp.com",
  projectId: "vizotube-77980",
  storageBucket: "vizotube-77980.firebasestorage.app",
  messagingSenderId: "299339735795",
  appId: "1:299339735795:web:1f003b45dfd688b40ecd86",
  measurementId: "G-EXHXWJWBV8"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Configure Google provider defaults
googleProvider.setCustomParameters({
  prompt: 'select_account',
});
googleProvider.addScope('email');
googleProvider.addScope('profile');

export const db = getFirestore(app);

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

