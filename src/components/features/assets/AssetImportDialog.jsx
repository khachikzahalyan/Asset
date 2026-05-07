import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table.jsx';

import { useCategories } from '@/hooks/useCategories.js';
import { useAssetStatuses } from '@/hooks/useAssetStatuses.js';
import { useBranches } from '@/hooks/useBranches.js';
import { useEmployees } from '@/hooks/useEmployees.js';
import { useAssets } from '@/hooks/useAssets.js';
import { firestoreAssetRepository } from '@/infra/repositories/firestoreAssetRepository.js';

import { COLUMN_KEYS, COLUMN_LABEL_KEYS } from '@/lib/excel/columns.js';
import {
  rowsToWorkbook,
  workbookToBlob,
} from '@/lib/excel/assetExportService.js';
import {
  workbookFromArrayBuffer,
  workbookToRows,
  validateRow,
  buildFailureReport,
} from '@/lib/excel/assetImportService.js';
import { localize } from '@/lib/localize.js';

const MAX_ROWS = 5000;

/**
 * Read a File as an ArrayBuffer. Prefers `file.arrayBuffer()` when available
 * (modern browsers, real DOM); falls back to `FileReader` so tests under
 * jsdom — which ship a minimal File polyfill without `.arrayBuffer()` — can
 * exercise the upload path.
 */
function readFileAsArrayBuffer(file) {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Three-stage Excel import dialog for assets:
 *   1. upload   — file picker + "download template" link.
 *   2. preview  — green/yellow/red row classification with filter pills.
 *   3. commit   — sequential calls to firestoreAssetRepository.create with
 *                 progress bar; on completion shows summary + optional
 *                 failure-report download.
 *
 * Pure-JS validation lives in `assetImportService` so this component stays
 * thin: it only orchestrates state machine + side effects.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {{ uid: string, role: string }} props.actor
 */
export default function AssetImportDialog({ open, onClose, actor }) {
  const { t, i18n } = useTranslation(['assets', 'common']);
  const lng = i18n.resolvedLanguage ?? 'ru';

  const { data: categories } = useCategories();
  const { data: statuses } = useAssetStatuses();
  const { data: branches } = useBranches();
  const { data: employees } = useEmployees();
  const { data: existingAssets } = useAssets();

  const [stage, setStage] = useState('upload');
  const [readError, setReadError] = useState(null);
  const [results, setResults] = useState([]);
  const [filter, setFilter] = useState('all');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [outcome, setOutcome] = useState(null);

  // Reset internal state whenever the dialog reopens. Mirrors AssetFormDialog.
  useEffect(() => {
    if (!open) return;
    setStage('upload');
    setReadError(null);
    setResults([]);
    setFilter('all');
    setProgress({ done: 0, total: 0 });
    setOutcome(null);
  }, [open]);

  const ctx = useMemo(
    () => ({
      categories,
      statuses,
      branches,
      employees,
      existingInventoryCodes: new Set(
        (existingAssets ?? []).map((a) => a.inventoryCode).filter(Boolean),
      ),
    }),
    [categories, statuses, branches, employees, existingAssets],
  );

  const categoriesById = useMemo(() => {
    const m = new Map();
    for (const c of categories ?? []) m.set(c.categoryId, c);
    return m;
  }, [categories]);

  const counts = useMemo(() => {
    let g = 0;
    let y = 0;
    let r = 0;
    for (const v of results) {
      if (v.status === 'green') g += 1;
      else if (v.status === 'yellow') y += 1;
      else r += 1;
    }
    return { green: g, yellow: y, red: r };
  }, [results]);

  // ----- Stage 1: Upload ------------------------------------------------------

  function downloadTemplate() {
    const labels = Object.fromEntries(
      COLUMN_KEYS.map((k) => [k, t(`assets:${COLUMN_LABEL_KEYS[k]}`)]),
    );
    const wb = rowsToWorkbook([], {
      categoriesById: new Map(),
      statusesById: new Map(),
      branchesById: new Map(),
      employeesById: new Map(),
      locale: lng,
      labels,
    });
    const blob = workbookToBlob(wb);
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = 'assets_import_template.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setReadError(null);
    try {
      const buf = await readFileAsArrayBuffer(file);
      const wb = await workbookFromArrayBuffer(buf);
      const { rows: parsed, errors } = workbookToRows(wb);
      if (errors && errors.length > 0) {
        setReadError(errors[0]);
        return;
      }
      if (parsed.length === 0) {
        setReadError('errorImportEmptyFile');
        return;
      }
      if (parsed.length > MAX_ROWS) {
        setReadError('errorImportTooManyRows');
        return;
      }
      const validated = parsed.map((r, i) => ({
        rowIndex: i + 1,
        raw: r,
        result: validateRow(r, i + 1, ctx),
      }));
      setResults(validated.map((v) => ({ ...v.result, rowIndex: v.rowIndex, raw: v.raw })));
      setStage('preview');
    } catch (err) {
      setReadError(err?.message ?? String(err));
    }
  }

  // ----- Stage 3: Commit ------------------------------------------------------

  const startCommit = useCallback(async () => {
    const queue = results.filter((r) => r.status !== 'red');
    setStage('commit');
    setProgress({ done: 0, total: queue.length });

    const failures = [];
    let created = 0;
    for (const r of queue) {
      const cat = categoriesById.get(r.normalized?.categoryId) ?? null;
      try {
        await firestoreAssetRepository.create(r.normalized, actor, { category: cat });
        created += 1;
      } catch (err) {
        failures.push({
          rowIndex: r.rowIndex,
          raw: r.raw,
          errors: [{ rule: 'errorImportRepositoryFailed', detail: err?.message }],
        });
      }
      setProgress((p) => ({ done: p.done + 1, total: p.total }));
    }

    let failureBlob = null;
    if (failures.length > 0) {
      const wb = buildFailureReport(failures);
      failureBlob = workbookToBlob(wb);
    }
    setOutcome({ created, failed: failures.length, failureBlob });
    setStage('done');
  }, [results, categoriesById, actor]);

  function downloadFailureReportFile() {
    if (!outcome?.failureBlob) return;
    const url = URL.createObjectURL(outcome.failureBlob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = 'assets_import_failures.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ----- Render ---------------------------------------------------------------

  const filteredResults = useMemo(() => {
    if (filter === 'all') return results;
    return results.filter((r) => r.status === filter);
  }, [results, filter]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('assets:importDialogTitle')}
      closeLabel={t('common:close', { defaultValue: 'Close' })}
    >
      {stage === 'upload' ? (
        <UploadStage
          t={t}
          readError={readError}
          onPickFile={handleFile}
          onDownloadTemplate={downloadTemplate}
        />
      ) : null}

      {stage === 'preview' ? (
        <PreviewStage
          t={t}
          lng={lng}
          counts={counts}
          filter={filter}
          setFilter={setFilter}
          results={filteredResults}
          categoriesById={categoriesById}
          onBack={() => setStage('upload')}
          onProceed={startCommit}
        />
      ) : null}

      {stage === 'commit' ? (
        <CommitStage t={t} progress={progress} />
      ) : null}

      {stage === 'done' && outcome ? (
        <DoneStage
          t={t}
          outcome={outcome}
          onDownloadFailures={downloadFailureReportFile}
          onClose={onClose}
        />
      ) : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Stage components
// ---------------------------------------------------------------------------

function UploadStage({ t, readError, onPickFile, onDownloadTemplate }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('assets:uploadHint')}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDownloadTemplate}
        >
          {t('assets:downloadTemplate')}
        </Button>
        <label className="flex flex-col gap-1 text-sm">
          <span className="sr-only">{t('assets:uploadHint')}</span>
          <input
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={onPickFile}
            aria-label={t('assets:uploadHint')}
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
          />
        </label>
      </div>
      {readError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {t(`assets:${readError}`, { defaultValue: readError })}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function PreviewStage({
  t,
  lng,
  counts,
  filter,
  setFilter,
  results,
  categoriesById,
  onBack,
  onProceed,
}) {
  const FILTER_PILLS = [
    { key: 'all', label: t('assets:filterAll') },
    { key: 'green', label: t('assets:filterGreen') },
    { key: 'yellow', label: t('assets:filterYellow') },
    { key: 'red', label: t('assets:filterRed') },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">{t('assets:previewHeading')}</h3>

      <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-md bg-emerald-100 px-2 py-1 text-emerald-900">
          {t('assets:countGreen', { count: counts.green })}
        </span>
        <span className="rounded-md bg-amber-100 px-2 py-1 text-amber-900">
          {t('assets:countYellow', { count: counts.yellow })}
        </span>
        <span className="rounded-md bg-rose-100 px-2 py-1 text-rose-900">
          {t('assets:countRed', { count: counts.red })}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTER_PILLS.map((p) => (
          <Button
            key={p.key}
            type="button"
            size="sm"
            variant={filter === p.key ? 'default' : 'outline'}
            onClick={() => setFilter(p.key)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <div className="max-h-80 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead className="w-24">{t('assets:status')}</TableHead>
              <TableHead>{t('assets:category')}</TableHead>
              <TableHead>{t('assets:name')}</TableHead>
              <TableHead>{t('assets:assignedToKindHeader')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((r) => {
              const cat = r.normalized?.categoryId
                ? categoriesById.get(r.normalized.categoryId)
                : null;
              const dot =
                r.status === 'green'
                  ? 'bg-emerald-500'
                  : r.status === 'yellow'
                    ? 'bg-amber-500'
                    : 'bg-rose-500';
              const issues = [
                ...(r.errors ?? []),
                ...(r.warnings ?? []),
              ];
              return (
                <TableRow key={r.rowIndex}>
                  <TableCell className="text-muted-foreground">{r.rowIndex}</TableCell>
                  <TableCell>
                    <span
                      aria-label={r.status}
                      className={`inline-block h-3 w-3 rounded-full ${dot}`}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {cat ? localize(cat.name, lng) : (r.raw?.categoryId ?? r.raw?.categoryName ?? '—')}
                  </TableCell>
                  <TableCell className="text-foreground">
                    {typeof r.normalized?.name === 'string'
                      ? r.normalized.name
                      : r.normalized?.name
                        ? localize(r.normalized.name, lng)
                        : (r.raw?.nameRu || '—')}
                    {issues.length > 0 ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {issues
                          .map((i) =>
                            i.field
                              ? `${t(`assets:${i.rule}`)} (${i.field})`
                              : t(`assets:${i.rule}`),
                          )
                          .join('; ')}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.normalized?.assignedTo?.kind ?? r.raw?.assignedToKind ?? '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          {t('assets:back')}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onProceed}
          disabled={counts.red > 0 || counts.green + counts.yellow === 0}
        >
          {t('assets:proceed')}
        </Button>
      </div>
    </div>
  );
}

function CommitStage({ t, progress }) {
  const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <Spinner size={18} />
        <span>{t('assets:importInProgress', { done: progress.done, total: progress.total })}</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function DoneStage({ t, outcome, onDownloadFailures, onClose }) {
  return (
    <div className="space-y-4">
      <Alert role="status">
        <AlertDescription>
          {t('assets:importDoneSuccess', {
            created: outcome.created,
            failed: outcome.failed,
          })}
        </AlertDescription>
      </Alert>
      {outcome.failed > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDownloadFailures}
        >
          {t('assets:downloadFailureReport')}
        </Button>
      ) : null}
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={onClose}>
          {t('assets:close')}
        </Button>
      </div>
    </div>
  );
}
