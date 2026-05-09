/**
 * Strip license-key-bearing fields from an audit diff snapshot.
 *
 * Behaviour:
 *   - Removes a top-level `licenseKey` property.
 *   - Removes `secrets.key` if `secrets` is a plain object.
 *   - Preserves all other keys unchanged.
 *   - Returns a shallow-cloned object (never mutates the caller's value).
 *   - Returns `null` / `undefined` unchanged.
 *
 * Pure: no I/O, no logging.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function sanitizeLicenseKeyDiff(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object' || Array.isArray(value)) return value;

  const out = { ...value };
  if ('licenseKey' in out) delete out.licenseKey;
  if (out.secrets && typeof out.secrets === 'object' && !Array.isArray(out.secrets)) {
    const { key: _stripped, ...rest } = out.secrets;
    out.secrets = rest;
  }
  return /** @type {T} */ (out);
}
