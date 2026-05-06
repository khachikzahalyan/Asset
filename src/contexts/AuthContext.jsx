import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

import { auth, db } from '@/lib/firebase/index.js';
import {
  signInWithGoogle,
  signOut as fbSignOut,
  sendEmployeeSignInLink,
  isEmailLink,
  completeEmailLinkSignIn,
} from '@/lib/firebase/auth.js';

/**
 * Emails that may self-bootstrap a `users/{uid}` doc with role=super_admin on first sign-in.
 * MUST stay in sync with the same list in firestore.rules (isSeedSuperAdminEmail()).
 */
const SEED_SUPER_ADMIN_EMAILS = ['zahalyanxcho@gmail.com'];

async function bootstrapSuperAdminIfEligible(fbUser) {
  if (!fbUser?.email) return;
  if (!SEED_SUPER_ADMIN_EMAILS.includes(fbUser.email)) return;

  const userRef = doc(db, 'users', fbUser.uid);
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) return;
    await setDoc(userRef, {
      email: fbUser.email,
      displayName: fbUser.displayName ?? null,
      photoURL: fbUser.photoURL ?? null,
      role: 'super_admin',
      branchId: null,
      departmentId: null,
      employeeId: null,
      preferredLocale: 'ru',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    console.info('[AMS auth] bootstrapped super_admin for', fbUser.email);
  } catch (err) {
    // Best-effort: don't block sign-in if rules reject (e.g., email_verified=false).
    console.warn('[AMS auth] bootstrap skipped:', err?.code ?? err);
  }
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [employeeId, setEmployeeId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setUser(fbUser);
      if (!fbUser) {
        setRole(null);
        setEmployeeId(null);
        setLoading(false);
      } else {
        // Fire-and-forget: if this is the seed super-admin signing in for the first time,
        // create their users/{uid} doc so the role-resolving onSnapshot below resolves immediately.
        bootstrapSuperAdminIfEligible(fbUser);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const ref = doc(db, 'users', user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setRole(data.role ?? null);
          setEmployeeId(data.employeeId ?? null);
        } else {
          setRole(null);
          setEmployeeId(null);
        }
        setLoading(false);
      },
      () => {
        setRole(null);
        setEmployeeId(null);
        setLoading(false);
      }
    );
    return unsub;
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      role,
      employeeId,
      loading,
      signInWithGoogle,
      sendEmployeeSignInLink,
      isEmailLink,
      completeEmailLinkSignIn,
      signOut: fbSignOut,
    }),
    [user, role, employeeId, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx == null) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
