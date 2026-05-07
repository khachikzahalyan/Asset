// src/domain/repositories/UsersRepository.js
/**
 * UsersRepository — domain-level port (interface).
 *
 * JSDoc-only by design.
 *
 * Concrete adapter:
 *   - src/infra/repositories/firestoreUsersRepository.js
 *
 * Method semantics:
 *   list(onData, onError):
 *     subscribe to all users ordered by email ASC. Unsubscribe returned.
 *
 *   updateRole(uid, newRole, before, actor):
 *     atomically update users/{uid}.role and write a 'roleChanged' audit.
 *
 *   setActive(uid, isActive, before, actor):
 *     atomically toggle users/{uid}.isActive and write
 *     'deactivated' | 'reactivated' audit.
 */

/**
 * @typedef {Object} AppUser
 * @property {string} uid
 * @property {string} email
 * @property {string|null} displayName
 * @property {string|null} photoURL
 * @property {'super_admin'|'asset_admin'|'tech_admin'|'employee'} role
 * @property {string|null} branchId
 * @property {string|null} departmentId
 * @property {string|null} employeeId
 * @property {'ru'|'en'|'hy'} preferredLocale
 * @property {boolean} isActive
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {import('firebase/firestore').Timestamp} updatedAt
 */

/**
 * @typedef {Object} ActorContext
 * @property {string} uid
 * @property {string} role
 */

/**
 * @typedef {Object} UsersRepository
 * @property {(onData: (users: AppUser[]) => void, onError: (err: Error) => void) => () => void} list
 * @property {(uid: string, newRole: AppUser['role'], before: AppUser, actor: ActorContext) => Promise<void>} updateRole
 * @property {(uid: string, isActive: boolean, before: AppUser, actor: ActorContext) => Promise<void>} setActive
 */

export {};
