import { useMemo } from 'react';
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

import { useAssignmentEvents } from '@/hooks/useAssignmentEvents.js';
import { useEmployees } from '@/hooks/useEmployees.js';
import { useBranches } from '@/hooks/useBranches.js';
import { ASSIGNMENT_KINDS } from '@/domain/assets.js';
import { formatEmployeeName } from '@/domain/employees.js';
import { localize } from '@/lib/localize.js';

/**
 * Renders the assignment-events history for one asset, newest first.
 *
 * Pure presentation: data fetching is delegated to `useAssignmentEvents`.
 * Holder names (employees, branches) are resolved via the existing data
 * hooks; departments fall back to their stored id (Wave-1 has no
 * `/departments` collection yet).
 *
 * @param {Object} props
 * @param {string} props.assetId
 */
export default function AssignmentHistoryList({ assetId }) {
  const { t, i18n } = useTranslation(['assets', 'common']);
  const lng = i18n.resolvedLanguage ?? 'ru';
  const { data: events, loading, error } = useAssignmentEvents(assetId);
  const { data: employees } = useEmployees();
  const { data: branches } = useBranches();

  const employeeById = useMemo(() => {
    const m = new Map();
    for (const e of employees) m.set(e.employeeId, e);
    return m;
  }, [employees]);

  const branchById = useMemo(() => {
    const m = new Map();
    for (const b of branches) m.set(b.branchId, b);
    return m;
  }, [branches]);

  function describeAssigned(a) {
    if (!a) return '—';
    if (a.kind === ASSIGNMENT_KINDS.WAREHOUSE) return t('holderWarehouse');
    if (a.kind === ASSIGNMENT_KINDS.EMPLOYEE) {
      const e = a.id ? employeeById.get(a.id) : null;
      return e ? formatEmployeeName(e, lng) : (a.id ?? '—');
    }
    if (a.kind === ASSIGNMENT_KINDS.BRANCH) {
      const b = a.id ? branchById.get(a.id) : null;
      return b ? localize(b.name, lng) : (a.id ?? '—');
    }
    if (a.kind === ASSIGNMENT_KINDS.DEPARTMENT) {
      return a.id ?? '—';
    }
    return '—';
  }

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

  if (!events || events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t('assignmentHistoryEmpty')}</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[170px]">{t('occurredAt')}</TableHead>
          <TableHead className="w-[110px]">{t('eventTypeColumn')}</TableHead>
          <TableHead>{t('eventFromTo')}</TableHead>
          <TableHead className="w-[140px]">{t('common:audit.actor')}</TableHead>
          <TableHead>{t('notes')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((e) => (
          <TableRow key={e.eventId}>
            <TableCell className="text-xs text-muted-foreground">
              {formatTs(e.occurredAt)}
            </TableCell>
            <TableCell>
              <Badge variant="muted">{t(`event_${e.eventType}`)}</Badge>
            </TableCell>
            <TableCell className="text-xs">
              <span className="text-muted-foreground">
                {describeAssigned(e.fromAssignment)}
              </span>
              <span className="mx-2 text-muted-foreground">→</span>
              <span>{describeAssigned(e.toAssignment)}</span>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {e.actorRole ?? e.actorUid ?? '—'}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground whitespace-pre-line">
              {e.notes || '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Format a Firestore Timestamp / Date / millis as `YYYY-MM-DD HH:mm`.
 */
function formatTs(value) {
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
