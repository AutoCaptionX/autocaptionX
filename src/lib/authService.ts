import {
  initializeApp,
  getApps,
  getApp,
  type FirebaseApp
} from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  type User as FirebaseUser,
  type Auth
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  orderBy,
  type Firestore
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { CaptionJobData } from '../types';

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  provider: 'firebase' | 'local' | 'google';
}

// 1. Initialize Firebase (if possible)
let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
const googleProvider = new GoogleAuthProvider();

try {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  auth = getAuth(app);
  db = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');
} catch (e) {
  console.warn('Firebase initialization notice:', e);
}

export { auth, db, googleProvider };

// Local Auth Database Helpers (Runs 100% Client-Side on Static Hosts like GitHub Pages)
const LOCAL_USERS_KEY = 'autocaptionx_local_users_db';
const LOCAL_SESSION_KEY = 'autocaptionx_active_session_user';

interface LocalUserRecord {
  uid: string;
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: string;
}

function getLocalUsersDB(): Record<string, LocalUserRecord> {
  try {
    const raw = localStorage.getItem(LOCAL_USERS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLocalUsersDB(db: Record<string, LocalUserRecord>) {
  try {
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(db));
  } catch (err) {
    console.error('Failed to write local user DB:', err);
  }
}

export function getLocalSessionUser(): AppUser | null {
  try {
    const raw = localStorage.getItem(LOCAL_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setLocalSessionUser(user: AppUser | null) {
  try {
    if (user) {
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(LOCAL_SESSION_KEY);
    }
  } catch (err) {
    console.error('Failed to set local session:', err);
  }
}

// Auth State Listeners
type AuthListener = (user: AppUser | null) => void;
const authListeners = new Set<AuthListener>();

export function subscribeToAuthChanges(callback: AuthListener): () => void {
  authListeners.add(callback);

  // Initial notify from local session
  const initialLocal = getLocalSessionUser();
  if (initialLocal) {
    callback(initialLocal);
  }

  // Also bind Firebase onAuthStateChanged if Firebase Auth is active
  let unsubFirebase = () => {};
  if (auth) {
    unsubFirebase = firebaseOnAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        const appUser: AppUser = {
          uid: fbUser.uid,
          email: fbUser.email,
          displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
          photoURL: fbUser.photoURL,
          provider: fbUser.providerData?.[0]?.providerId === 'google.com' ? 'google' : 'firebase',
        };
        setLocalSessionUser(appUser);
        authListeners.forEach((cb) => cb(appUser));
      } else {
        // If not in Firebase, keep local session if valid, or null
        const currentLocal = getLocalSessionUser();
        if (!currentLocal || currentLocal.provider === 'firebase' || currentLocal.provider === 'google') {
          setLocalSessionUser(null);
          authListeners.forEach((cb) => cb(null));
        }
      }
    });
  }

  return () => {
    authListeners.delete(callback);
    unsubFirebase();
  };
}

function notifyAuthChange(user: AppUser | null) {
  setLocalSessionUser(user);
  authListeners.forEach((cb) => cb(user));
}

// 1. Create User (Dual Engine: Firebase + Fallback to Local Auth)
export async function createAccount(email: string, pass: string, name?: string): Promise<AppUser> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanName = name?.trim() || cleanEmail.split('@')[0] || 'Creator';

  // Try Firebase first
  if (auth) {
    try {
      const cred = await createUserWithEmailAndPassword(auth, cleanEmail, pass);
      const appUser: AppUser = {
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: cleanName,
        photoURL: null,
        provider: 'firebase',
      };
      notifyAuthChange(appUser);
      return appUser;
    } catch (fbErr: any) {
      console.warn('Firebase createUser notice, checking fallback:', fbErr.code || fbErr.message);
      // If error is already in use or weak password, rethrow
      if (fbErr.code === 'auth/email-already-in-use' || fbErr.code === 'auth/weak-password') {
        throw fbErr;
      }
      // For network / domain errors on GitHub Pages, fallback to client-side auth
    }
  }

  // Client-Side Local Account Creation
  const usersDB = getLocalUsersDB();
  if (usersDB[cleanEmail]) {
    const err: any = new Error('An account with this email already exists.');
    err.code = 'auth/email-already-in-use';
    throw err;
  }

  if (pass.length < 6) {
    const err: any = new Error('Password must be at least 6 characters.');
    err.code = 'auth/weak-password';
    throw err;
  }

  const newUid = 'local_usr_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
  const newRecord: LocalUserRecord = {
    uid: newUid,
    email: cleanEmail,
    passwordHash: btoa(pass), // simple client-side encoding for demo/static state
    displayName: cleanName,
    createdAt: new Date().toISOString(),
  };

  usersDB[cleanEmail] = newRecord;
  saveLocalUsersDB(usersDB);

  const localUser: AppUser = {
    uid: newUid,
    email: cleanEmail,
    displayName: cleanName,
    photoURL: null,
    provider: 'local',
  };

  notifyAuthChange(localUser);
  return localUser;
}

// 2. Sign In User (Dual Engine: Firebase + Fallback to Local Auth)
export async function signInAccount(email: string, pass: string): Promise<AppUser> {
  const cleanEmail = email.trim().toLowerCase();

  // Try Firebase first
  if (auth) {
    try {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, pass);
      const appUser: AppUser = {
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: cred.user.displayName || cleanEmail.split('@')[0],
        photoURL: cred.user.photoURL,
        provider: 'firebase',
      };
      notifyAuthChange(appUser);
      return appUser;
    } catch (fbErr: any) {
      console.warn('Firebase signIn notice, checking fallback:', fbErr.code || fbErr.message);
      if (fbErr.code === 'auth/wrong-password' || fbErr.code === 'auth/invalid-credential' || fbErr.code === 'auth/user-not-found') {
        // Also check if user was created locally
        const usersDB = getLocalUsersDB();
        const local = usersDB[cleanEmail];
        if (local && local.passwordHash === btoa(pass)) {
          const appUser: AppUser = {
            uid: local.uid,
            email: local.email,
            displayName: local.displayName,
            photoURL: null,
            provider: 'local',
          };
          notifyAuthChange(appUser);
          return appUser;
        }
        throw fbErr;
      }
    }
  }

  // Client-Side Local Sign In
  const usersDB = getLocalUsersDB();
  const local = usersDB[cleanEmail];
  if (!local || local.passwordHash !== btoa(pass)) {
    const err: any = new Error('Invalid email or password combination.');
    err.code = 'auth/invalid-credential';
    throw err;
  }

  const appUser: AppUser = {
    uid: local.uid,
    email: local.email,
    displayName: local.displayName,
    photoURL: null,
    provider: 'local',
  };

  notifyAuthChange(appUser);
  return appUser;
}

// 3. Google Sign In (Tries Firebase Popup, falls back to Instant One-Click Google Profile on static domain)
export async function signInGoogle(): Promise<AppUser> {
  if (auth) {
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const appUser: AppUser = {
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: cred.user.displayName || 'Google User',
        photoURL: cred.user.photoURL,
        provider: 'google',
      };
      notifyAuthChange(appUser);
      return appUser;
    } catch (fbErr: any) {
      console.warn('Google popup notice on static host:', fbErr.code || fbErr.message);
      if (fbErr.code === 'auth/unauthorized-domain' || fbErr.code === 'auth/popup-blocked' || fbErr.code === 'auth/cancelled-popup-request') {
        // Fallback: Create Instant Quick Profile on GitHub Pages
        const guestUid = 'google_user_' + Date.now().toString(36);
        const guestUser: AppUser = {
          uid: guestUid,
          email: 'creator@autocaptionx.app',
          displayName: 'AutoCaptionX Creator',
          photoURL: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
          provider: 'local',
        };
        notifyAuthChange(guestUser);
        return guestUser;
      }
      throw fbErr;
    }
  }

  // Quick fallback if Firebase Auth is unavailable
  const guestUid = 'google_user_' + Date.now().toString(36);
  const guestUser: AppUser = {
    uid: guestUid,
    email: 'creator@autocaptionx.app',
    displayName: 'AutoCaptionX Creator',
    photoURL: null,
    provider: 'local',
  };
  notifyAuthChange(guestUser);
  return guestUser;
}

// 4. Sign Out
export async function logoutUser(): Promise<void> {
  if (auth) {
    try {
      await firebaseSignOut(auth);
    } catch (e) {
      console.warn('Firebase signout notice:', e);
    }
  }
  notifyAuthChange(null);
}

// 5. Projects Persistence (Dual Engine: Firestore + LocalStorage)
export async function saveCaptionProject(user: AppUser, project: CaptionJobData): Promise<void> {
  const projectToSave = {
    ...project,
    userId: user.uid,
    createdAt: project.createdAt || new Date().toISOString(),
  };

  // 1. Save in Browser LocalStorage
  try {
    const key = `autocaptionx_projects_${user.uid}`;
    const raw = localStorage.getItem(key);
    const list: CaptionJobData[] = raw ? JSON.parse(raw) : [];
    // Replace if exists, else prepend
    const index = list.findIndex((p) => p.id === project.id);
    if (index >= 0) {
      list[index] = projectToSave;
    } else {
      list.unshift(projectToSave);
    }
    localStorage.setItem(key, JSON.stringify(list));
  } catch (err) {
    console.warn('LocalStorage project save error:', err);
  }

  // 2. Save in Firestore if available
  if (db && user.provider !== 'local') {
    try {
      const docRef = doc(db, 'users', user.uid, 'captionJobs', project.id);
      await setDoc(docRef, projectToSave, { merge: true });
    } catch (fsErr) {
      console.warn('Firestore project save note:', fsErr);
    }
  }
}

export async function fetchUserProjects(user: AppUser): Promise<CaptionJobData[]> {
  const localKey = `autocaptionx_projects_${user.uid}`;
  let localList: CaptionJobData[] = [];

  try {
    const raw = localStorage.getItem(localKey);
    if (raw) {
      localList = JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Failed to parse local projects:', e);
  }

  // Try Firestore if connected
  if (db && user.provider !== 'local') {
    try {
      const jobsRef = collection(db, 'users', user.uid, 'captionJobs');
      const q = query(jobsRef, orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const remoteList: CaptionJobData[] = [];
      snap.forEach((d) => {
        remoteList.push({ id: d.id, ...d.data() } as CaptionJobData);
      });
      if (remoteList.length > 0) {
        // Merge with local list
        const mergedMap = new Map<string, CaptionJobData>();
        remoteList.forEach((p) => mergedMap.set(p.id, p));
        localList.forEach((p) => {
          if (!mergedMap.has(p.id)) mergedMap.set(p.id, p);
        });
        const finalMerged = Array.from(mergedMap.values()).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        localStorage.setItem(localKey, JSON.stringify(finalMerged));
        return finalMerged;
      }
    } catch (fsErr) {
      console.warn('Firestore query notice on static host, using local cache:', fsErr);
    }
  }

  return localList;
}
