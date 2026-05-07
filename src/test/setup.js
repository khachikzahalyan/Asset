import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Set navigator.language to 'ru' so i18next-browser-languagedetector picks up
// Russian locale in jsdom tests. All assertion strings in tests assume Russian.
Object.defineProperty(navigator, 'language', {
  value: 'ru',
  configurable: true,
  writable: true,
});

vi.mock('@/lib/firebase/index.js', () => ({
  app: {},
  auth: { currentUser: null },
  db: {},
  storage: {},
}));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: vi.fn(function Provider() {
    this.setCustomParameters = vi.fn();
  }),
  signInWithPopup: vi.fn().mockResolvedValue({ user: null }),
  sendSignInLinkToEmail: vi.fn().mockResolvedValue(undefined),
  signInWithEmailLink: vi.fn().mockResolvedValue({ user: null }),
  isSignInWithEmailLink: vi.fn().mockReturnValue(false),
  signOut: vi.fn().mockResolvedValue(undefined),
  onAuthStateChanged: vi.fn((_auth, cb) => {
    cb(null);
    return () => {};
  }),
  getAuth: vi.fn(() => ({ currentUser: null })),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  collection: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
  getFirestore: vi.fn(() => ({})),
}));

vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(() => ({})),
}));

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
  getApps: vi.fn(() => []),
  getApp: vi.fn(() => ({})),
}));
