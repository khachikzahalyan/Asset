/**
 * AuditRepository port (interface).
 *
 * Pure JavaScript: imports nothing from Firebase. The Firestore-backed
 * adapter lives in `src/infra/repositories/firestoreAuditRepository.js`.
 *
 * @typedef {Object} AuditRepository
 * @property {(entity: string, entityId: string, opts?: { limit?: number }) =>
 *   Promise<import('@/domain/audit.js').AuditLog[]>} listForEntity
 *   Returns the most recent audit entries for the given entity, ordered by
 *   `at` descending. Caller must be an admin (rules enforce this).
 */

export {};
