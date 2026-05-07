import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import { auth, db } from '@/lib/firebase/index.js';
import {
  signInWithGoogle,
  signOut as fbSignOut,
  sendEmployeeSignInLink,
  isEmailLink,
  completeEmailLinkSignIn,
} from '@/lib/firebase/auth.js';
import { normalizeEmail, INVITE_STATUS } from '@/domain/userInvitations.js';

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
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    console.info('[AMS auth] bootstrapped super_admin for', fbUser.email);
  } catch (err) {
    console.warn('[AMS auth] seed bootstrap skipped:', err?.code ?? err);
  }
}

async function bootstrapFromInvitationIfEligible(fbUser) {
  if (!fbUser?.email) return;
  if (!fbUser.emailVerified) return;
  const email = normalizeEmail(fbUser.email);
  if (!email) return;

  const userRef = doc(db, 'users', fbUser.uid);
  try {
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) return;

    const inviteRef = doc(db, 'userInvitations', email);
    await runTransaction(db, async (tx) => {
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists()) return;
      const invite = inviteSnap.data();
      if (invite.status !== INVITE_STATUS.PENDING) return;

      tx.set(userRef, {
        email,
        displayName: fbUser.displayName ?? null,
        photoURL: fbUser.photoURL ?? null,
        role: invite.role,
        branchId: invite.branchId ?? null,
        departmentId: invite.departmentId ?? null,
        employeeId: null,
        preferredLocale: 'ru',
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      tx.update(inviteRef, {
        status: INVITE_STATUS.ACCEPTED,
        acceptedUid: fbUser.uid,
        acceptedAt: serverTimestamp(),
      });
    });
    console.info('[AMS auth] bootstrapped from invitation for', email);
  } catch (err) {
    console.warn('[AMS auth] invitation bootstrap skipped:', err?.code ?? err);
  }
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [employeeId, setEmployeeId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accountDisabled, setAccountDisabled] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUser(null);
        setRole(null);
        setEmployeeId(null);
        setLoading(false);
        return;
      }
      // Run both bootstrap flows in order. They no-op when not eligible.
      await bootstrapSuperAdminIfEligible(fbUser);
      await bootstrapFromInvitationIfEligible(fbUser);
      setUser(fbUser);
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
          if (data.isActive === false) {
            setAccountDisabled(true);
            setRole(null);
            setEmployeeId(null);
            setLoading(false);
            Promise.resolve(fbSignOut()).catch((err) => {
              console.warn('[AMS auth] forced signOut failed:', err?.code ?? err);
            });
            return;
          }
          setAccountDisabled(false);
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
      accountDisabled,
      signInWithGoogle,
      sendEmployeeSignInLink,
      isEmailLink,
      completeEmailLinkSignIn,
      signOut: fbSignOut,
    }),
    [user, role, employeeId, loading, accountDisabled]
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
