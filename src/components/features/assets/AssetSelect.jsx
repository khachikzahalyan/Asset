import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAssets } from '@/hooks/useAssets.js';
import { useCategories } from '@/hooks/useCategories.js';
import { nameForDisplay } from '@/domain/assets.js';
import { localize } from '@/lib/localize.js';

/**
 * Single-asset picker, scoped to active devices (categoryId === 'device'
 * by default). Used by AssetFormDialog when assigning a license to a
 * device, and by AssignDialog for the "asset" target kind.
 *
 * Each option label is `${inventoryCode} — ${name} (${categoryName})`.
 *
 * @param {{
 *   value?: string,
 *   onChange: (assetId: string) => void,
 *   excludeAssetId?: string,
 *   restrictToCategoryIds?: string[],
 *   requireCanHostLicense?: boolean,
 *   disabled?: boolean,
 *   placeholder?: string,
 *   id?: string,
 *   name?: string,
 *   className?: string,
 *   'data-testid'?: string,
 * }} props
 */
export default function AssetSelect({
  value,
  onChange,
  excludeAssetId = '',
  restrictToCategoryIds = ['device'],
  requireCanHostLicense = false,
  disabled = false,
  placeholder,
  id,
  name,
  className,
  ...rest
}) {
  const { t, i18n } = useTranslation('assets');
  const { data: assets } = useAssets();
  const { data: categories } = useCategories();

  const categoryById = useMemo(() => {
    const m = new Map();
    for (const c of categories || []) m.set(c.categoryId ?? c.id, c);
    return m;
  }, [categories]);

  const options = useMemo(() => {
    return (assets || [])
      .filter((a) => a && a.isActive !== false)
      .filter((a) => restrictToCategoryIds.includes(a.categoryId))
      .filter((a) => a.assetId !== excludeAssetId)
      .filter((a) => {
        if (!requireCanHostLicense) return true;
        const cat = categoryById.get(a.categoryId);
        return Boolean(cat?.canHostLicense);
      });
  }, [assets, restrictToCategoryIds, excludeAssetId, requireCanHostLicense, categoryById]);

  return (
    <select
      id={id}
      name={name}
      data-testid={rest['data-testid']}
      className={
        className ??
        'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50'
      }
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    >
      <option value="">{placeholder ?? t('assetTargetPlaceholder')}</option>
      {options.map((a) => {
        const cat = categoryById.get(a.categoryId);
        const catName = cat ? localize(cat.name, i18n.language) : a.categoryId;
        const display = nameForDisplay(a, i18n.language) || a.inventoryCode;
        return (
          <option key={a.assetId} value={a.assetId}>
            {`${a.inventoryCode} — ${display} (${catName})`}
          </option>
        );
      })}
    </select>
  );
}
