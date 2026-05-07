import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Pencil, PowerOff, Power } from 'lucide-react';

import PageHeader from '@/components/common/PageHeader.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Dialog } from '@/components/ui/dialog.jsx';
import EmployeeFormDialog from '@/components/features/employees/EmployeeFormDialog.jsx';
import HistoryTab from '@/components/features/audit/HistoryTab.jsx';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { useEmployee } from '@/hooks/useEmployee.js';
import { useBranches } from '@/hooks/useBranches.js';
import { useUsers } from '@/hooks/useUsers.js';
import { firestoreEmployeeRepository } from '@/infra/repositories/firestoreEmployeeRepository.js';
import { ROLES } from '@/domain/roles.js';
import {
  formatEmployeeName,
  EmployeeHasActiveAssignmentsError,
} from '@/domain/employees.js';
import { localize } from '@/lib/localize.js';

/**
 * Employee detail page.
 *
 * - Visible to all three admin roles. Tech Admin sees no write affordances.
 * - Edit button: super_admin + asset_admin.
 * - Deactivate button: super_admin + asset_admin.
 * - Reactivate button: super_admin only (rules also enforce this).
 * - Stub tabs for assigned assets (Wave 3) and audit history (later wave).
 */
export default function EmployeeDetailPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation(['employees', 'common']);
  const { user, role } = useAuth();
  const { data: employee, loading, error } = useEmployee(id);
  const { data: branches } = useBranches();
  // useUsers is gated by Firestore rules (super_admin only). For the other
  // admin roles the hook resolves to an empty array — we degrade gracefully
  // to showing the raw uid in the "Created by" row.
  const { data: users } = useUsers();

  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [acting, setActing] = useState(false);

  const canEdit = role === ROLES.SUPER_ADMIN || role === ROLES.ASSET_ADMIN;
  const canDeactivate = role === ROLES.SUPER_ADMIN || role === ROLES.ASSET_ADMIN;
  const canReactivate = role === ROLES.SUPER_ADMIN;

  const lng = i18n.resolvedLanguage ?? 'ru';

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Spinner size={18} />
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

  if (!employee) {
    return (
      <div className="rounded-md border bg-background p-10 text-center text-sm text-muted-foreground">
        {t('notFound')}
        <div className="mt-3">
          <Link
            to="/employees"
            className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> {t('backToList')}
          </Link>
        </div>
      </div>
    );
  }

  // Decide which toggle to show:
  // - active employee → "Deactivate" (gated by canDeactivate).
  // - inactive employee → "Reactivate" (gated by canReactivate).
  const showToggle = employee.isActive ? canDeactivate : canReactivate;

  async function handleUpdate(input) {
    if (!user) throw new Error('not-authenticated');
    setActionError(null);
    await firestoreEmployeeRepository.update(employee.employeeId, input, employee, {
      uid: user.uid,
      role,
    });
  }

  async function handleToggleActive() {
    if (!user) return;
    setActing(true);
    setActionError(null);
    try {
      // Wave 1: assignments collection does not exist yet, so
      // activeAssignmentCount is always 0. Wave 3 will inject a real count.
      await firestoreEmployeeRepository.setActive(
        employee.employeeId,
        !employee.isActive,
        employee,
        { uid: user.uid, role },
        { activeAssignmentCount: 0 }
      );
      setConfirmOpen(false);
    } catch (err) {
      if (err instanceof EmployeeHasActiveAssignmentsError) {
        setActionError(t('errorHasAssignments'));
      } else {
        setActionError(err?.message ?? String(err));
      }
    } finally {
      setActing(false);
    }
  }

  return (
    <>
      <PageHeader
        title={formatEmployeeName(employee, lng)}
        description={employee.department || ''}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/employees"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              {t('backToList')}
            </Link>
            {canEdit ? (
              <Button size="sm" className="gap-2" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                {t('common:edit')}
              </Button>
            ) : null}
            {showToggle ? (
              <Button
                variant={employee.isActive ? 'outline' : 'secondary'}
                size="sm"
                className="gap-2"
                onClick={() => setConfirmOpen(true)}
              >
                {employee.isActive ? (
                  <PowerOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Power className="h-4 w-4" aria-hidden="true" />
                )}
                {employee.isActive ? t('deactivate') : t('reactivate')}
              </Button>
            ) : null}
          </div>
        }
      />

      {actionError ? (
        <Alert variant="destructive" className="mb-4" role="alert">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">{t('details')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Field label={t('fullName')}>
              <span>{formatEmployeeName(employee, lng)}</span>
            </Field>
            <Field label={t('email')}>
              <span className="text-muted-foreground">{employee.email}</span>
            </Field>
            <Field label={t('phone')}>
              <span className="text-muted-foreground">{employee.phone || '—'}</span>
            </Field>
            <Field label={t('branch')}>
              {(() => {
                if (!employee.branchId) {
                  // Pre-Wave-1.5 row: branch was never collected. Surface a
                  // CTA that opens the edit dialog so the admin can fill it
                  // in. Tech Admin sees only the muted "—" because canEdit
                  // is false for that role.
                  return (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground">{t('branchMissing')}</span>
                      {canEdit ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setEditOpen(true)}
                        >
                          {t('fillInBranch')}
                        </Button>
                      ) : null}
                    </div>
                  );
                }
                const b = branches.find((x) => x.branchId === employee.branchId);
                return (
                  <span className="text-muted-foreground">
                    {b ? localize(b.name, lng) : '—'}
                  </span>
                );
              })()}
            </Field>
            <Field label={t('department')}>
              <span className="text-muted-foreground">{employee.department || '—'}</span>
            </Field>
            <Field label={t('status')}>
              {employee.isActive ? (
                <Badge variant="success">{t('active')}</Badge>
              ) : (
                <Badge variant="muted">{t('terminated')}</Badge>
              )}
            </Field>
            <Field label={t('createdAt')}>
              <span className="text-muted-foreground">
                {formatDateTime(employee.createdAt)}
              </span>
            </Field>
            <Field label={t('createdBy')}>
              <span className="text-muted-foreground">
                {resolveActor(users, employee.createdBy)}
              </span>
            </Field>
            {employee.terminatedAt ? (
              <Field label={t('terminatedAt')}>
                <span className="text-muted-foreground">
                  {formatTimestamp(employee.terminatedAt)}
                </span>
              </Field>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">
              {t('currentlyAssignedAssets')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t('currentlyAssignedAssetsComingWave3')}
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">{t('historyTab')}</CardTitle>
          </CardHeader>
          <CardContent>
            <HistoryTab entityType="employee" entityId={employee.employeeId} />
          </CardContent>
        </Card>
      </div>

      {canEdit ? (
        <EmployeeFormDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          employee={employee}
          onSubmit={handleUpdate}
        />
      ) : null}

      {showToggle ? (
        <Dialog
          open={confirmOpen}
          onClose={() => (acting ? null : setConfirmOpen(false))}
          title={
            employee.isActive
              ? t('confirmDeactivateTitle')
              : t('confirmReactivateTitle')
          }
          description={
            employee.isActive
              ? t('confirmDeactivateBody')
              : t('confirmReactivateBody')
          }
          closeLabel={t('common:cancel')}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                disabled={acting}
              >
                {t('common:cancel')}
              </Button>
              <Button
                variant={employee.isActive ? 'destructive' : 'default'}
                onClick={handleToggleActive}
                disabled={acting}
                className="gap-2"
              >
                {acting ? <Spinner size={14} /> : null}
                {employee.isActive ? t('deactivate') : t('reactivate')}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">
            {formatEmployeeName(employee, lng)}
          </p>
        </Dialog>
      ) : null}
    </>
  );
}

function Field({ label, children }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[140px,1fr] sm:items-start">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}

/**
 * Format a Firestore Timestamp (or null) as `YYYY-MM-DD`. Same convention
 * as the form's `<input type="date">` for visual consistency. Returns "—"
 * when the timestamp is missing.
 */
function formatTimestamp(value) {
  if (!value) return '—';
  const d = typeof value.toDate === 'function' ? value.toDate() : value;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format a Firestore Timestamp (or null) as `YYYY-MM-DD HH:mm` for the
 * "Created at" row. Returns "—" when the timestamp is missing.
 */
function formatDateTime(value) {
  if (!value) return '—';
  const d = typeof value.toDate === 'function' ? value.toDate() : value;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hh}:${mi}`;
}

/**
 * Resolve a uid to a human-readable label using the users catalog.
 * Falls back to the raw uid when the lookup misses (e.g., the current
 * role can't read the users collection, or the actor was deleted).
 */
function resolveActor(users, uid) {
  if (!uid) return '—';
  const u = users?.find((x) => x.uid === uid);
  if (!u) return uid;
  return u.displayName || u.email || uid;
}
