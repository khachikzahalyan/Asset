import { localize } from '@/lib/localize.js';

/**
 * Compose the displayed title for an asset.
 *
 * - When `asset.name` is a multi-lang map (Furniture): `localize(asset.name, locale)`.
 * - Otherwise (Device, License): joins `[subtype, brand, model]` with " · ",
 *   each part also `localize`d when it is a multi-lang map. Empty parts skipped.
 *
 * Pure: no React, no Firestore.
 *
 * @param {{ name: any, categoryId?: string } | null | undefined} asset
 * @param {{ subtype?: any, brand?: any, model?: any }} refs
 * @param {string} [locale]
 * @returns {string}
 */
export function formatAssetTitle(asset, refs, locale) {
  if (!asset) return '';

  // Multi-lang name (Furniture path).
  if (asset.name && typeof asset.name === 'object') {
    return localize(asset.name, locale);
  }
  if (typeof asset.name === 'string' && asset.name.length > 0) {
    return asset.name;
  }

  // Composed-title path: subtype · brand · model.
  const parts = [];
  const sub = refs?.subtype;
  if (sub?.name) parts.push(typeof sub.name === 'object' ? localize(sub.name, locale) : String(sub.name));
  const br = refs?.brand;
  if (br?.name) parts.push(typeof br.name === 'object' ? localize(br.name, locale) : String(br.name));
  const md = refs?.model;
  if (md?.name) parts.push(typeof md.name === 'object' ? localize(md.name, locale) : String(md.name));

  return parts.filter(Boolean).join(' · ');
}
