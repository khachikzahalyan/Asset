import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button.jsx';
import { COLUMN_KEYS, COLUMN_LABEL_KEYS } from '@/lib/excel/columns.js';
import {
  rowsToWorkbook,
  workbookToBlob,
  downloadFilename,
} from '@/lib/excel/assetExportService.js';

/**
 * One-click Excel export of the assets currently visible in the table
 * (i.e. after the page's filter state has been applied — caller passes the
 * already-filtered list as `assets`).
 *
 * Header row 1 is the canonical machine-readable column keys; row 2 is the
 * localized label band — populated here via i18next so the user reads the
 * current UI-locale words above the data.
 *
 * Disabled when:
 *   - the page itself is loading (caller passes `disabled={loading}`), OR
 *   - there are no assets to export.
 */
export default function AssetExportButton({
  assets,
  categoriesById,
  statusesById,
  branchesById,
  employeesById,
  disabled = false,
}) {
  const { i18n, t } = useTranslation('assets');

  const isEmpty = !assets || assets.length === 0;

  function handleExport() {
    if (isEmpty) return;
    // Resolve the row-2 label band in the current UI locale.
    const labels = Object.fromEntries(
      COLUMN_KEYS.map((k) => [k, t(COLUMN_LABEL_KEYS[k])]),
    );
    const wb = rowsToWorkbook(assets, {
      categoriesById,
      statusesById,
      branchesById,
      employeesById,
      locale: i18n.resolvedLanguage ?? 'ru',
      labels,
    });
    const blob = workbookToBlob(wb);
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-2"
      onClick={handleExport}
      disabled={disabled || isEmpty}
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      {t('export')}
    </Button>
  );
}
