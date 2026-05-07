/**
 * EmployeeRepository — domain-level port (interface).
 *
 * This file documents the contract every Employee repository adapter must
 * implement. JSDoc-only by design: importing this file at runtime only pulls
 * in typedef metadata, never a Firestore client. Components and hooks talk
 * to a concrete adapter (e.g. firestoreEmployeeRepository) through this shape.
 *
 * Concrete adapter:
 *   - src/infra/repositories/firestoreEmployeeRepository.js
 *
 * Method semantics:
 *
 *   list(): subscribe to all employees ordered by `lastName ASC`. Returns an
 *           unsubscribe function. The callback receives the full snapshot
 *           array on every change.
 *
 *   get(id): subscribe to a single employee document. Returns an unsubscribe.
 *
 *   create(input, actor): atomically create the employee, the
 *           `email_index/{emailKey}` sentinel, and an `audit_logs` row of
 *           action `create`. Returns the new id. Throws
 *           EmployeeEmailTakenError if the email is already indexed.
 *
 *   update(id, input, before, actor): atomically update + audit `update`.
 *           If the email changed, also moves the sentinel doc (delete old
 *           index, create new) inside the same transaction. Throws
 *           EmployeeEmailTakenError on collision.
 *
 *   setActive(id, isActive, before, actor, opts): atomically toggle
 *           isActive + audit `activate` | `deactivate` | `reactivate`.
 *           When deactivating, refuses if `opts.activeAssignmentCount > 0`
 *           and throws EmployeeHasActiveAssignmentsError. The Wave-1 caller
 *           always passes 0; Wave 3 wires the real counter.
 */

/**
 * @typedef {import('@/domain/employees.js').Employee} Employee
 * @typedef {import('@/domain/employees.js').EmployeeInput} EmployeeInput
 * @typedef {import('@/domain/repositories/BranchRepository.js').ActorContext} ActorContext
 */

/**
 * @typedef {Object} SetActiveOptions
 * @property {number} [activeAssignmentCount]   Wave-1: caller passes 0.
 */

/**
 * @typedef {Object} EmployeeRepository
 * @property {(onData: (employees: Employee[]) => void, onError: (err: Error) => void) => () => void} list
 * @property {(id: string, onData: (e: Employee | null) => void, onError: (err: Error) => void) => () => void} get
 * @property {(input: EmployeeInput, actor: ActorContext) => Promise<string>} create
 * @property {(id: string, input: EmployeeInput, before: Employee, actor: ActorContext) => Promise<void>} update
 * @property {(id: string, isActive: boolean, before: Employee, actor: ActorContext, opts?: SetActiveOptions) => Promise<void>} setActive
 */

export {};
