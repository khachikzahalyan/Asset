import {
  GoogleAuthProvider,
  signInWithPopup,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  isSignInWithEmailLink,
  signOut as fbSignOut,
} from 'firebase/auth';

import { auth } from './index.js';

const EMAIL_LINK_STORAGE_KEY = 'ams.emailLinkPendingEmail';

export function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}

export function signOut() {
  return fbSignOut(auth);
}

export function sendEmployeeSignInLink(email, continueUrl) {
  const actionCodeSettings = {
    url: continueUrl,
    handleCodeInApp: true,
  };
  window.localStorage.setItem(EMAIL_LINK_STORAGE_KEY, email);
  return sendSignInLinkToEmail(auth, email, actionCodeSettings);
}

// Used when a super_admin sends an invitation. The recipient opens the link
// on a different device/browser, so we deliberately do NOT cache the email
// in the sender's localStorage — the EmailLinkLandingPage falls back to
// asking the recipient for their email when nothing is cached.
export function sendInvitationSignInLink(email, continueUrl) {
  const actionCodeSettings = {
    url: continueUrl,
    handleCodeInApp: true,
  };
  return sendSignInLinkToEmail(auth, email, actionCodeSettings);
}

export function isEmailLink(href = window.location.href) {
  return isSignInWithEmailLink(auth, href);
}

export function completeEmailLinkSignIn(emailFromForm, href = window.location.href) {
  const stored = window.localStorage.getItem(EMAIL_LINK_STORAGE_KEY);
  const email = emailFromForm || stored;
  if (!email) {
    return Promise.reject(new Error('email-required'));
  }
  return signInWithEmailLink(auth, email, href).finally(() => {
    window.localStorage.removeItem(EMAIL_LINK_STORAGE_KEY);
  });
}
