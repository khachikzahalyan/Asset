/**
 * BranchRepository — domain-level port (interface).
 *
 * This file documents the contract every Branch repository adapter must
 * implement. It is JSDoc-only by design: importing this file at runtime
 * only pulls in typedef metadata, never a Firestore client. Components and
 * hooks talk to a concrete adapter (e.g. firestoreBranchRepository) through
 * this shape.
 *
 * Concrete adapter:
 *   - src/infra/repositories/firestoreBranchRepository.js
 *
 * Method semantics:
 *
 *   list(): subscribe to all branches ordered by `name.ru ASC`. Returns an
 *           unsubscribe function. The callback receives the full snapshot
 *           array on every change.
 *
 *   get(id): subscribe to a single branch document. Returns an unsubscribe.
 *
 *   create(input, actor): atomically create the branch and an audit_logs
 *                         entry of action `create`. Returns the new id.
 *
 *   update(id, input, before, actor): atomically update + audit `update`.
 *
 *   setActive(id, isActive, before, actor): atomically toggle isActive +
 *                         audit `activate` | `deactivate`.
 */

/**
 * @typedef {import('@/domain/branches.js').Branch} Branch
 * @typedef {import('@/domain/branches.js').BranchInput} BranchInput
 */

/**
 * @typedef {Object} ActorContext
 * @property {string} uid
 * @property {string} role
 */

/**
 * @typedef {Object} BranchRepository
 * @property {(onData: (branches: Branch[]) => void, onError: (err: Error) => void) => () => void} list
 * @property {(id: string, onData: (branch: Branch | null) => void, onError: (err: Error) => void) => () => void} get
 * @property {(input: BranchInput, actor: ActorContext) => Promise<string>} create
 * @property {(id: string, input: BranchInput, before: Branch, actor: ActorContext) => Promise<void>} update
 * @property {(id: string, isActive: boolean, before: Branch, actor: ActorContext) => Promise<void>} setActive
 */

export {};
