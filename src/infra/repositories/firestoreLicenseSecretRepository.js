import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/index.js';
import { buildAuditLog, newAuditLogRef } from '@/lib/audit/auditHelper.js';
import {
  sanitizeLicenseSecretValue,
  validateLicenseSecretValue,
} from '@/domain/licenseSecrets.js';
import {
  LicenseKeyOnNonLicenseError,
  LicenseKeyMissingError,
  LicenseKeyTargetOccupiedError,
} from '@/domain/assets.js';

const SECRET_DOC_ID = 'key';

function secretDocRef(assetId) {
  return doc(db, 'assets', assetId, 'secrets', SECRET_DOC_ID);
}

function assetDocRef(assetId) {
  return doc(db, 'assets', assetId);
}

/**
 * Read the license-key value for an asset.
 *
 * Callers (UI through `useLicenseSecret`) only ever need the value
 * itself — `updatedAt` / `updatedBy` are part of the audit metadata,
 * not the user-facing surface, so we deliberately drop them here to
 * avoid accidental rendering of the key alongside metadata.
 *
 * @param {string} assetId
 * @returns {Promise<string|null>}
 */
export async function getLicenseKey(assetId) {
  const snap = await getDoc(secretDocRef(assetId));
  if (!snap.exists()) return null;
  const data = snap.data();
  return typeof data.value === 'string' ? data.value : null;
}

/**
 * Set or rotate the license key. The secret value NEVER appears in
 * the audit row; only the boolean fact-of-set/clear does. The value
 * NEVER appears in any thrown Error.message.
 *
 * Fix 6: rejects if the asset's categoryId !== 'license'.
 *
 * @param {string} assetId
 * @param {string} value
 * @param {{ uid: string, role: string }} actor
 * @returns {Promise<void>}
 */
export async function setLicenseKey(assetId, value, actor) {
  const sanitized = sanitizeLicenseSecretValue(value);
  const validationError = validateLicenseSecretValue(sanitized);
  if (validationError) {
    throw new Error(`license/${validationError}`);
  }

  const ref = secretDocRef(assetId);
  const aRef = assetDocRef(assetId);
  await runTransaction(db, async (tx) => {
    // Fix 6: category guard — only license assets may have a key.
    const assetSnap = await tx.get(aRef);
    if (assetSnap.exists()) {
      const categoryId = assetSnap.data()?.categoryId;
      if (categoryId && categoryId !== 'license') {
        throw new LicenseKeyOnNonLicenseError(assetId, categoryId);
      }
    }

    const snap = await tx.get(ref);
    const before = snap.exists()
      ? { licenseKeySet: true }
      : { licenseKeySet: false };

    tx.set(ref, {
      value: sanitized,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });

    tx.set(
      newAuditLogRef(),
      buildAuditLog({
        entity: 'asset',
        entityId: assetId,
        action: snap.exists() ? 'license_key_changed' : 'license_key_set',
        actorUid: actor.uid,
        actorRole: actor.role,
        before,
        after: { licenseKeySet: true },
        relatedAssetId: assetId,
      })
    );
  });
}

/**
 * Transfer a license key from one asset to another in a single transaction.
 *
 * Rules:
 *   - Both assets must have categoryId === 'license'.
 *   - The source must have an existing secret doc.
 *   - The target must NOT already have a secret doc.
 *   - The source asset MAY be in a final/written-off status — the transfer
 *     only touches the secret subcollection, not the asset doc.
 *   - Two audit rows are written: `license_key_transferred_out` on the source
 *     and `license_key_transferred_in` on the target. Neither contains the
 *     literal key value.
 *
 * @param {{
 *   fromAssetId: string,
 *   toAssetId: string,
 *   actor: { uid: string, role: string },
 * }} params
 * @returns {Promise<void>}
 */
export async function transferLicenseKey({ fromAssetId, toAssetId, actor }) {
  if (!actor?.uid) throw new Error('transferLicenseKey: actor.uid required');
  if (!fromAssetId || !toAssetId) {
    throw new Error('transferLicenseKey: fromAssetId and toAssetId required');
  }

  const fromAssetRef = assetDocRef(fromAssetId);
  const toAssetRef = assetDocRef(toAssetId);
  const fromSecretRef = secretDocRef(fromAssetId);
  const toSecretRef = secretDocRef(toAssetId);

  await runTransaction(db, async (tx) => {
    const [fromAssetSnap, toAssetSnap, fromSecretSnap, toSecretSnap] =
      await Promise.all([
        tx.get(fromAssetRef),
        tx.get(toAssetRef),
        tx.get(fromSecretRef),
        tx.get(toSecretRef),
      ]);

    // Category guard on both assets.
    const fromCategory = fromAssetSnap.exists()
      ? fromAssetSnap.data()?.categoryId
      : null;
    if (fromCategory !== 'license') {
      throw new LicenseKeyOnNonLicenseError(fromAssetId, fromCategory ?? '(missing)');
    }

    const toCategory = toAssetSnap.exists()
      ? toAssetSnap.data()?.categoryId
      : null;
    if (toCategory !== 'license') {
      throw new LicenseKeyOnNonLicenseError(toAssetId, toCategory ?? '(missing)');
    }

    // Source must have a key.
    if (!fromSecretSnap.exists()) {
      throw new LicenseKeyMissingError(fromAssetId);
    }

    // Target must NOT already have a key.
    if (toSecretSnap.exists()) {
      throw new LicenseKeyTargetOccupiedError(toAssetId);
    }

    const keyValue = fromSecretSnap.data().value;

    // Move: write to target, delete from source.
    tx.set(toSecretRef, {
      value: keyValue,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
    tx.delete(fromSecretRef);

    // Audit: transferred_out on source (never includes the key value).
    tx.set(
      newAuditLogRef(),
      buildAuditLog({
        entity: 'asset',
        entityId: fromAssetId,
        action: 'license_key_transferred_out',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: { licenseKeySet: true },
        after: { licenseKeySet: false },
        relatedAssetId: fromAssetId,
        meta: { toAssetId },
      })
    );

    // Audit: transferred_in on target.
    tx.set(
      newAuditLogRef(),
      buildAuditLog({
        entity: 'asset',
        entityId: toAssetId,
        action: 'license_key_transferred_in',
        actorUid: actor.uid,
        actorRole: actor.role,
        before: { licenseKeySet: false },
        after: { licenseKeySet: true },
        relatedAssetId: toAssetId,
        meta: { fromAssetId },
      })
    );
  });
}

export const firestoreLicenseSecretRepository = Object.freeze({
  getLicenseKey,
  setLicenseKey,
  transferLicenseKey,
});
