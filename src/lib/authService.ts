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
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
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

// FORCE EXPLICIT MULTI-ACCOUNT CHOOSER POPUP (Shows all logged-in Google accounts on Mobile/Chrome)
googleProvider.setCustomParameters({
  prompt: 'select_account',
});
googleProvider.addScope('email');
googleProvider.addScope('profile');

try {
  // Detect if running on GitHub Pages or custom host
  const isGitHubHost = typeof window !== 'undefined' && (
    window.location.hostname.includes('github.io') ||
    window.location.hostname.includes('autocaptionx')
  );

  // Use project configuration with explicit domain resolution for vizotube-77980
  const effectiveConfig = {
    ...firebaseConfig,
    projectId: isGitHubHost ? 'vizotube-77980' : (firebaseConfig.projectId || 'vizotube-77980'),
    authDomain: isGitHubHost ? 'vizotube-77980.firebaseapp.com' : (firebaseConfig.authDomain || 'vizotube-77980.firebaseapp.com'),
  };

  app = !getApps().length ? initializeApp(effectiveConfig) : getApp();
  auth = getAuth(app);
  db = getFirestore(app, effectiveConfig.firestoreDatabaseId || '(default)');

  // Ensure persistent local auth state across reloads
  if (auth) {
    setPersistence(auth, browserLocalPersistence).catch((err) => {
      console.warn('[AutoCaptionX Auth] setPersistence note:', err?.message || err);
    });
  }
} catch (e) {
  console.warn('[AutoCaptionX Auth] Firebase initialization note:', e);
}

export { auth, db, googleProvider };

// Automatically initialize or update user profile document in Firestore upon sign in
export async function syncUserProfileToFirestore(user: AppUser | { uid: string; email?: string | null; displayName?: string | null; photoURL?: string | null; provider?: string }): Promise<void> {
  if (!db || !user || !user.uid) return;
  try {
    const userRef = doc(db, 'users', user.uid);
    await setDoc(
      userRef,
      {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || user.email?.split('@')[0] || 'User',
        photoURL: user.photoURL || null,
        provider: user.provider || 'google',
        lastLoginAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    console.log('[AutoCaptionX Auth] User profile synced to Firestore:', user.uid);
  } catch (err) {
    console.warn('[AutoCaptionX Auth] Note on Firestore profile sync:', err);
  }
}

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

// Check if current browser is mobile / tablet
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || (window.innerWidth <= 768);
}

// Auth State Listeners
type AuthListener = (user: AppUser | null) => void;
const authListeners = new Set<AuthListener>();

// Check for redirect result on page load (Mobile Redirect Flow)
let redirectResultChecked = false;
export async function checkRedirectLogin(): Promise<AppUser | null> {
  if (!auth || redirectResultChecked) return null;
  redirectResultChecked = true;
  try {
    console.log('[AutoCaptionX Auth] Checking redirect authentication result...');
    const cred = await getRedirectResult(auth);
    if (cred && cred.user) {
      console.log('[AutoCaptionX Auth] Redirect Sign-In verified successfully:', cred.user.email);
      const appUser: AppUser = {
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: cred.user.displayName || cred.user.email?.split('@')[0] || 'Google User',
        photoURL: cred.user.photoURL,
        provider: 'google',
      };
      notifyAuthChange(appUser);
      return appUser;
    }
  } catch (err: any) {
    console.warn('[AutoCaptionX Auth] Redirect login check notice:', err?.code || err?.message);
    if (err?.code === 'auth/unauthorized-domain') {
      const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'autocaptionx.github.io';
      console.warn(
        `[AutoCaptionX Auth] Please add "${currentHost}" and "autocaptionx.github.io" in Firebase Console (project vizotube-77980) -> Authentication -> Settings -> Authorized Domains.`
      );
    }
    // Clean stale / corrupt tokens if expired or invalid credential error occurs
    if (
      err?.code === 'auth/invalid-credential' ||
      err?.code === 'auth/user-token-expired' ||
      err?.code === 'auth/invalid-user-token'
    ) {
      setLocalSessionUser(null);
      authListeners.forEach((cb) => cb(null));
    }
  }
  return null;
}

export function subscribeToAuthChanges(callback: AuthListener): () => void {
  authListeners.add(callback);

  // Initial notify from local session
  const initialLocal = getLocalSessionUser();
  if (initialLocal) {
    callback(initialLocal);
  }

  // Check redirect login on page load
  checkRedirectLogin();

  // Also bind Firebase onAuthStateChanged if Firebase Auth is active
  let unsubFirebase = () => {};
  if (auth) {
    unsubFirebase = firebaseOnAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        console.log('[AutoCaptionX Auth] Firebase session active:', fbUser.email);
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
  if (user) {
    // Dynamically initialize / update user document in Firestore on login
    syncUserProfileToFirestore(user).catch((e) => {
      console.warn('[AutoCaptionX Auth] User Firestore profile sync note:', e);
    });
  }
  authListeners.forEach((cb) => cb(user));
}

// 1. Create User (Dual Engine: Firebase + Fallback to Local Auth)
export async function createAccount(email: string, pass: string, name?: string): Promise<AppUser> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanName = name?.trim() || cleanEmail.split('@')[0] || 'Creator';

  // Try Firebase first
  if (auth) {
    try {
      await setPersistence(auth, browserLocalPersistence).catch(() => {});
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
      await setPersistence(auth, browserLocalPersistence).catch(() => {});
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

// 3. Google Sign In (Automatic fallback: Popup -> Redirect on any popup blocker or domain restriction)
export async function signInGoogle(preferRedirect?: boolean): Promise<AppUser | void> {
  if (!auth) {
    throw new Error('Authentication service is initializing. Please try again in a moment.');
  }

  // Ensure persistent local storage
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (e) {
    // Continue even if setting persistence fails in restricted sandbox
  }

  const isMobile = isMobileDevice();
  const currentHost = typeof window !== 'undefined' && window.location && window.location.hostname ? window.location.hostname : 'autocaptionx.github.io';

  // If on mobile device or explicitly requested, use signInWithRedirect directly
  if (isMobile || preferRedirect) {
    try {
      console.log(`[AutoCaptionX Auth] Triggering Google Sign-In redirect flow on ${currentHost}...`);
      await signInWithRedirect(auth, googleProvider);
      return;
    } catch (redirectErr: any) {
      console.error('[AutoCaptionX Auth] Google Redirect Error:', redirectErr);
      if (redirectErr.code === 'auth/unauthorized-domain') {
        throw new Error(
          `Domain "${currentHost}" not authorized in Firebase Console (Project: vizotube-77980). Please add "${currentHost}" and "autocaptionx.github.io" under Authentication -> Settings -> Authorized Domains. Alternatively, use email sign-in below!`
        );
      }
      throw new Error(redirectErr.message || 'Failed to redirect to Google Sign-In.');
    }
  }

  // Desktop Flow: Try popup first, wrapped in explicit try/catch with immediate auto-fallback to redirect on ANY popup block or domain mismatch
  try {
    console.log(`[AutoCaptionX Auth] Opening Google Sign-In popup from ${currentHost}...`);
    const cred = await signInWithPopup(auth, googleProvider);
    if (!cred || !cred.user) {
      throw new Error('Google Sign-In was cancelled.');
    }

    console.log('[AutoCaptionX Auth] Google Sign-In popup success:', cred.user.email);
    const appUser: AppUser = {
      uid: cred.user.uid,
      email: cred.user.email,
      displayName: cred.user.displayName || cred.user.email?.split('@')[0] || 'Google User',
      photoURL: cred.user.photoURL,
      provider: 'google',
    };

    notifyAuthChange(appUser);
    return appUser;
  } catch (fbErr: any) {
    console.warn(`[AutoCaptionX Auth] Google Popup notice/error (${currentHost}):`, fbErr?.code || fbErr?.message);

    // If popup was blocked, closed, unsupported, OR if unauthorized domain in popup -> immediately fallback to redirect!
    if (
      fbErr.code === 'auth/popup-blocked' ||
      fbErr.code === 'auth/cancelled-popup-request' ||
      fbErr.code === 'auth/popup-closed-by-user' ||
      fbErr.code === 'auth/operation-not-supported-in-this-environment' ||
      fbErr.code === 'auth/internal-error' ||
      fbErr.code === 'auth/unauthorized-domain'
    ) {
      try {
        console.log(`[AutoCaptionX Auth] Falling back directly to Google Sign-In redirect flow on ${currentHost}...`);
        await signInWithRedirect(auth, googleProvider);
        return;
      } catch (redirectFallbackErr: any) {
        console.error('[AutoCaptionX Auth] Redirect fallback error:', redirectFallbackErr);
        if (redirectFallbackErr.code === 'auth/unauthorized-domain' || fbErr.code === 'auth/unauthorized-domain') {
          throw new Error(
            `Unauthorized Domain: Please whitelist "${currentHost}" and "autocaptionx.github.io" in Firebase Console (Project: vizotube-77980) -> Authentication -> Settings -> Authorized Domains. Or use Instant Email Sign-In below.`
          );
        }
        if (fbErr.code === 'auth/popup-closed-by-user') {
          throw new Error('Sign-In popup was closed. Click again to continue.');
        }
        throw new Error(redirectFallbackErr.message || 'Failed to complete Google Sign-In.');
      }
    }

    if (fbErr.code === 'auth/network-request-failed') {
      throw new Error('Network error during authentication. Please check your internet connection.');
    }

    throw new Error(fbErr.message || 'Failed to sign in with Google.');
  }
}

// 4. Sign Out
export async function logoutUser(): Promise<void> {
  if (auth) {
    try {
      await firebaseSignOut(auth);
      console.log('[AutoCaptionX Auth] User signed out from Firebase.');
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

