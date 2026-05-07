import { useTranslation } from 'react-i18next';

import { Spinner } from '@/components/ui/spinner.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table.jsx';

import { useAuditLogs } from '@/hooks/useAuditLogs.js';
import { actionLabelKey, changedFieldLabels } from '@/domain/audit.js';

/**
 * Reusable audit-history timeline (Wave 1.5, decision 2A).
 *
 * Used by EmployeeDetailPage today; will be reused on Asset/Branch detail
 * pages in later waves. Single responsibility: render the audit_logs entries
 * for one entity, ordered by `at` desc. Pure presentation — data fetching
 * lives in `useAuditLogs`.
 *
 * Visibility: read access to `audit_logs` is restricted to admin roles by
 * Firestore rules. The component itself does not gate on role; the parent
 * page is expected to live behind a `<RoleGate>`.
 *
 * @param {Object} props
 * @param {import('@/domain/audit.js').AuditEntityType} props.entityType
 * @param {string} props.entityId
 * @param {number} [props.limit=50]
 */
export default function HistoryTab({ entityType, entityId, limit = 50 }) {
  const { t } = useTranslation(['common', 'employees']);
  const { data: rawData, loading, error } = useAuditLogs(entityType, entityId, { limit });
  // The "create" entry is presented as structured fields ("Created at" /
  // "Created by") in the parent detail page's Details card, so it would
  // duplicate that information if it also appeared in the timeline. Hide
  // it here. Update / activate / deactivate / reactivate rows still show.
  const data = rawData?.filter((entry) => entry.action !== 'create');

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground">
        <Spinner size={16} />
        <span className="text-sm">{t('common:loading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{error.message ?? String(error)}</AlertDescription>
      </Alert>
    );
  }

  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t('common:audit.historyEmpty')}</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[180px]">{t('common:audit.at')}</TableHead>
          <TableHead className="w-[140px]">{t('common:audit.action')}</TableHead>
          <TableHead>{t('common:audit.changedFields')}</TableHead>
          <TableHead className="w-[160px]">{t('common:audit.actor')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((entry) => {
          const fields = changedFieldLabels(entry);
          const actionKey = actionLabelKey(entry.action);
          // Action key is namespaced under common:audit.* — fall back to the
          // raw action token if a Phase-2 action lacks a translation yet.
          const actionLabel =
            actionKey.startsWith('audit.')
              ? t(`common:${actionKey}`, { defaultValue: entry.action })
              : entry.action;
          return (
            <TableRow key={entry.auditId}>
              <TableCell className="text-muted-foreground text-xs">
                {formatAt(entry.at)}
              </TableCell>
              <TableCell>
                <Badge variant="muted">{actionLabel}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {fields.length === 0 ? '—' : fields.join(', ')}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {entry.actorRole ?? entry.actorUid ?? '—'}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * Format a Firestore `Timestamp` (or millis number, or `Date`) as
 * `YYYY-MM-DD HH:mm`. Returns "—" when the value is missing or unparseable.
 *
 * @param {unknown} value
 * @returns {string}
 */
function formatAt(value) {
  if (value == null) return '—';
  let d;
  if (typeof value === 'number') d = new Date(value);
  else if (value instanceof Date) d = value;
  else if (typeof value.toDate === 'function') d = value.toDate();
  else if (typeof value.toMillis === 'function') d = new Date(value.toMillis());
  else return '—';
  if (Number.isNaN(d.getTime())) return '—';
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yy}-${mm}-${dd} ${hh}:${mi}`;
}
