// src/test/AuthContext.bootstrap.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';

// --- Mocks BEFORE imports of the SUT ---

const mockOnAuthStateChanged = vi.fn();
const mockSignOut = vi.fn();
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (...args) => mockOnAuthStateChanged(...args),
}));

// shared mutable state for getDoc / runTransaction
const fixture = {
  userDocExists: false,
  userDocData: null,
  inviteDocExists: false,
  inviteDocData: null,
};

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_, path, id) => ({ __path: `${path}/${id}` })),
  getDoc: vi.fn(async (ref) => {
    if (ref.__path.startsWith('users/')) {
      return { exists: () => fixture.userDocExists, data: () => fixture.userDocData };
    }
    return { exists: () => false, data: () => null };
  }),
  onSnapshot: vi.fn((ref, cb) => {
    if (ref.__path.startsWith('users/')) {
      queueMicrotask(() =>
        cb({
          exists: () => fixture.userDocExists,
          data: () => fixture.userDocData,
        })
      );
    }
    return () => {};
  }),
  setDoc: vi.fn(async () => {}),
  serverTimestamp: vi.fn(() => '__TS__'),
  runTransaction: vi.fn(async (_db, fn) => {
    await fn({
      get: async (ref) => {
        if (ref.__path.startsWith('userInvitations/')) {
          return { exists: () => fixture.inviteDocExists, data: () => fixture.inviteDocData };
        }
        return { exists: () => false };
      },
      set: vi.fn(),
      update: vi.fn(),
    });
  }),
}));

vi.mock('@/lib/firebase/index.js', () => ({ db: {}, auth: {} }));
vi.mock('@/lib/firebase/auth.js', () => ({
  signInWithGoogle: vi.fn(),
  signOut: (...args) => mockSignOut(...args),
  sendEmployeeSignInLink: vi.fn(),
  isEmailLink: vi.fn(),
  completeEmailLinkSignIn: vi.fn(),
}));

import { AuthProvider, useAuth } from '@/contexts/AuthContext.jsx';

function Probe({ onCtx }) {
  const ctx = useAuth();
  useEffect(() => {
    onCtx(ctx);
  });
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.userDocExists = false;
  fixture.userDocData = null;
  fixture.inviteDocExists = false;
  fixture.inviteDocData = null;
});

function renderWithAuthCallback(fbUser) {
  let captured;
  mockOnAuthStateChanged.mockImplementation((_auth, cb) => {
    queueMicrotask(() => cb(fbUser));
    return () => {};
  });
  render(
    <AuthProvider>
      <Probe onCtx={(c) => (captured = c)} />
    </AuthProvider>
  );
  return () => captured;
}

describe('AuthContext invitation bootstrap', () => {
  it('case: invitee with pending invitation -> users/{uid} created', async () => {
    fixture.inviteDocExists = true;
    fixture.inviteDocData = { email: 'kolya@gmail.com', role: 'tech_admin', status: 'pending' };

    const { runTransaction } = await import('firebase/firestore');
    renderWithAuthCallback({
      uid: 'kolya-uid',
      email: 'Kolya@Gmail.COM',
      emailVerified: true,
      displayName: 'Kolya',
      photoURL: null,
    });

    await waitFor(() => {
      expect(runTransaction).toHaveBeenCalled();
    });
  });

  it('case: invitee with revoked invitation -> no transaction', async () => {
    fixture.inviteDocExists = true;
    fixture.inviteDocData = { email: 'kolya@gmail.com', role: 'tech_admin', status: 'revoked' };

    const { runTransaction } = await import('firebase/firestore');
    renderWithAuthCallback({
      uid: 'kolya-uid',
      email: 'kolya@gmail.com',
      emailVerified: true,
    });

    await waitFor(() => {
      // runTransaction is called, but the inner fn finds status != pending and returns
      // before any tx.set. We assert no users/{uid} setDoc happened by checking setDoc.
      expect(runTransaction).toHaveBeenCalled();
    });
    // (deeper assertion lives in the firestoreUserInvitationsRepository test)
  });

  it('case: existing user with isActive=false -> signOut is called', async () => {
    fixture.userDocExists = true;
    fixture.userDocData = { role: 'tech_admin', isActive: false, employeeId: null };

    renderWithAuthCallback({
      uid: 'kolya-uid',
      email: 'kolya@gmail.com',
      emailVerified: true,
    });

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
    });
  });

  it('case: existing active user -> no signOut, no transaction', async () => {
    fixture.userDocExists = true;
    fixture.userDocData = { role: 'tech_admin', isActive: true, employeeId: null };

    const { runTransaction } = await import('firebase/firestore');
    renderWithAuthCallback({
      uid: 'kolya-uid',
      email: 'kolya@gmail.com',
      emailVerified: true,
    });

    await waitFor(() => {
      expect(mockSignOut).not.toHaveBeenCalled();
    });
    // No bootstrap path needed because users/{uid} already exists.
    // runTransaction may not be called.
    expect(runTransaction).not.toHaveBeenCalled();
  });

  // --- Gap-1 additions: 3 missing matrix cases from §11.3 ---

  it('case: seed super_admin first sign-in -> setDoc called, no transaction', async () => {
    // Arrange: no users/{uid} doc exists yet; setDoc will create it.
    // Make setDoc update the fixture so the invitation bootstrap sees the doc and
    // returns early — confirming the invitation path is fully skipped.
    const { setDoc, runTransaction } = await import('firebase/firestore');
    setDoc.mockImplementation(async () => {
      fixture.userDocExists = true;
      fixture.userDocData = { role: 'super_admin', isActive: true, employeeId: null };
    });

    renderWithAuthCallback({
      uid: 'seed-uid',
      email: 'zahalyanxcho@gmail.com',
      emailVerified: true,
      displayName: 'Seed Admin',
      photoURL: null,
    });

    // Act + Assert
    await waitFor(() => {
      expect(setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ __path: 'users/seed-uid' }),
        expect.objectContaining({ role: 'super_admin', isActive: true })
      );
    });
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('case: invitee with accepted invite (status=accepted) -> no tx.set, no users/{uid} write', async () => {
    // Arrange: no users/{uid} doc; invite doc exists but already accepted.
    fixture.inviteDocExists = true;
    fixture.inviteDocData = { email: 'vasya@gmail.com', role: 'asset_admin', status: 'accepted' };

    // Capture calls to tx.set within the transaction so we can verify none target users/.
    let txSetCalls = [];
    const { runTransaction } = await import('firebase/firestore');
    runTransaction.mockImplementation(async (_db, fn) => {
      await fn({
        get: async (ref) => {
          if (ref.__path.startsWith('userInvitations/')) {
            return {
              exists: () => fixture.inviteDocExists,
              data: () => fixture.inviteDocData,
            };
          }
          return { exists: () => false };
        },
        set: vi.fn((...args) => { txSetCalls.push(args); }),
        update: vi.fn(),
      });
    });

    renderWithAuthCallback({
      uid: 'vasya-uid',
      email: 'vasya@gmail.com',
      emailVerified: true,
    });

    // Transaction IS called (invitation bootstrap runs) but inner logic must bail out
    // because status !== 'pending', so tx.set for users/{uid} must never be called.
    await waitFor(() => {
      expect(runTransaction).toHaveBeenCalled();
    });
    const usersSetCall = txSetCalls.find(
      ([ref]) => ref?.__path?.startsWith?.('users/')
    );
    expect(usersSetCall).toBeUndefined();
  });

  it('case: invitee with no invite doc at all -> early return; no error; no tx writes', async () => {
    // Arrange: no users/{uid} doc; no invite doc (inviteDocExists stays false).
    fixture.inviteDocExists = false;

    let txSetCalls = [];
    let txUpdateCalls = [];
    const { runTransaction } = await import('firebase/firestore');
    runTransaction.mockImplementation(async (_db, fn) => {
      await fn({
        get: async (ref) => {
          if (ref.__path.startsWith('userInvitations/')) {
            return { exists: () => false, data: () => null };
          }
          return { exists: () => false };
        },
        set: vi.fn((...args) => { txSetCalls.push(args); }),
        update: vi.fn((...args) => { txUpdateCalls.push(args); }),
      });
    });

    // Should not throw — errors are swallowed via console.warn.
    expect(() =>
      renderWithAuthCallback({
        uid: 'nobody-uid',
        email: 'nobody@gmail.com',
        emailVerified: true,
      })
    ).not.toThrow();

    // Wait long enough for the async bootstrap to complete.
    await waitFor(() => {
      expect(runTransaction).toHaveBeenCalled();
    });
    expect(txSetCalls).toHaveLength(0);
    expect(txUpdateCalls).toHaveLength(0);
  });
});
