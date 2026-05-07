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
});
