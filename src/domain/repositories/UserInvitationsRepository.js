// src/domain/repositories/UserInvitationsRepository.js
/**
 * UserInvitationsRepository — domain-level port (interface).
 *
 * JSDoc-only by design: importing this file at runtime only pulls in
 * typedef metadata, never a Firestore client. Components and hooks talk
 * to a concrete adapter (firestoreUserInvitationsRepository) through this
 * shape.
 *
 * Concrete adapter:
 *   - src/infra/repositories/firestoreUserInvitationsRepository.js
 *
 * Method semantics:
 *   listPending(onData, onError):
 *     subscribe to all invitations with status='pending' ordered by
 *     invitedAt DESC. Returns an unsubscribe function.
 *
 *   create(input, actor):
 *     atomically create userInvitations/{emailLower} with status='pending'
 *     and an audit_logs entry of action 'create'. Returns the email used
 *     as the doc id. Rejects if a doc already exists at that id.
 *
 *   revoke(emailLower, before, actor):
 *     atomically transition pending -> revoked and write 'revoke' audit.
 */

/**
 * @typedef {import('@/domain/userInvitations.js').UserInvitation} UserInvitation
 * @typedef {import('@/domain/userInvitations.js').InviteInput} InviteInput
 */

/**
 * @typedef {Object} ActorContext
 * @property {string} uid
 * @property {string} role
 */

/**
 * @typedef {Object} UserInvitationsRepository
 * @property {(onData: (invites: UserInvitation[]) => void, onError: (err: Error) => void) => () => void} listPending
 * @property {(input: InviteInput, actor: ActorContext) => Promise<string>} create
 * @property {(emailLower: string, before: UserInvitation, actor: ActorContext) => Promise<void>} revoke
 */

export {};
