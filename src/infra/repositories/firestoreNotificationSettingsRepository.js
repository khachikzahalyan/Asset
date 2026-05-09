import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';
import {
  sanitizeNotificationSettingsInput,
  validateNotificationSettingsInput,
} from '@/domain/notificationSettings.js';

function settingsDocRef() {
  return doc(db, 'settings', 'notifications');
}

export async function getNotificationSettings() {
  const snap = await getDoc(settingsDocRef());
  if (!snap.exists()) return null;
  const data = snap.data();
  return { licenseExpiryWarningDays: data.licenseExpiryWarningDays };
}

/**
 * Subscribe to /settings/notifications.
 *
 * @param {{
 *   onData: (settings: { licenseExpiryWarningDays: number }|null) => void,
 *   onError?: (err: Error) => void,
 * }} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeToNotificationSettings({ onData, onError } = {}) {
  return onSnapshot(
    settingsDocRef(),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data();
      onData({ licenseExpiryWarningDays: data.licenseExpiryWarningDays });
    },
    (err) => {
      if (onError) onError(err);
    },
  );
}

export async function setNotificationSettings(input, actor) {
  const errors = validateNotificationSettingsInput(input);
  if (Object.keys(errors).length > 0) {
    throw new Error(
      `notificationSettings/${errors.licenseExpiryWarningDays || 'invalid'}`
    );
  }
  const sanitized = sanitizeNotificationSettingsInput(input);

  const ref = settingsDocRef();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const before = snap.exists() ? { ...snap.data() } : null;

    tx.set(ref, {
      licenseExpiryWarningDays: sanitized.licenseExpiryWarningDays,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });

    tx.set(
      newAuditLogRef(),
      buildAuditLog({
        entity: 'settings',
        entityId: 'notifications',
        action: snap.exists() ? 'updated' : 'created',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: before
          ? { licenseExpiryWarningDays: before.licenseExpiryWarningDays }
          : null,
        after: { licenseExpiryWarningDays: sanitized.licenseExpiryWarningDays },
      })
    );
  });
}

export const firestoreNotificationSettingsRepository = Object.freeze({
  getNotificationSettings,
  subscribeToNotificationSettings,
  setNotificationSettings,
});
