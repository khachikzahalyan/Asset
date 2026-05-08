/**
 * AssetSubtypeRepository — port (interface).
 *
 * Adapters live in `src/infra/repositories/`. UI / hooks consume the
 * adapter exclusively; no `firebase/*` imports below this boundary.
 *
 * @typedef {Object} AssetSubtypeRepository
 * @property {(callback: (items: import('../assetSubtypes.js').AssetSubtype[]) => void, onError?: (e: Error) => void) => () => void} list
 * @property {(id: string, callback: (item: import('../assetSubtypes.js').AssetSubtype | null) => void, onError?: (e: Error) => void) => () => void} get
 * @property {(input: import('../assetSubtypes.js').AssetSubtypeInput, actor: { uid: string, role: string }, opts?: { id?: string }) => Promise<string>} create
 * @property {(id: string, patch: import('../assetSubtypes.js').AssetSubtypeInput, before: import('../assetSubtypes.js').AssetSubtype, actor: { uid: string, role: string }) => Promise<void>} update
 * @property {(id: string, isActive: boolean, before: import('../assetSubtypes.js').AssetSubtype, actor: { uid: string, role: string }) => Promise<void>} setActive
 */

export {};
