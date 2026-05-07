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
import BranchFormDialog from '@/components/features/branches/BranchFormDialog.jsx';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { useBranch } from '@/hooks/useBranch.js';
import { firestoreBranchRepository } from '@/infra/repositories/firestoreBranchRepository.js';
import { localize } from '@/lib/localize.js';
import { ROLES } from '@/domain/roles.js';

export default function BranchDetailPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation(['branches', 'common']);
  const { user, role } = useAuth();
  const { data: branch, loading, error } = useBranch(id);

  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [acting, setActing] = useState(false);

  const canWrite = role === ROLES.SUPER_ADMIN;
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

  if (!branch) {
    return (
      <div className="rounded-md border bg-background p-10 text-center text-sm text-muted-foreground">
        {t('notFound')}
        <div className="mt-3">
          <Link
            to="/branches"
            className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> {t('backToList')}
          </Link>
        </div>
      </div>
    );
  }

  async function handleUpdate(input) {
    if (!user) throw new Error('not-authenticated');
    setActionError(null);
    await firestoreBranchRepository.update(branch.branchId, input, branch, {
      uid: user.uid,
      role,
    });
  }

  async function handleToggleActive() {
    if (!user) return;
    setActing(true);
    setActionError(null);
    try {
      await firestoreBranchRepository.setActive(
        branch.branchId,
        !branch.isActive,
        branch,
        { uid: user.uid, role }
      );
      setConfirmOpen(false);
    } catch (err) {
      setActionError(err?.message ?? String(err));
    } finally {
      setActing(false);
    }
  }

  return (
    <>
      <PageHeader
        title={localize(branch.name, lng)}
        description={branch.address || null}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/branches"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              {t('backToList')}
            </Link>
            {canWrite ? (
              <>
                <Button size="sm" className="gap-2" onClick={() => setEditOpen(true)}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  {t('common:edit')}
                </Button>
                <Button
                  variant={branch.isActive ? 'outline' : 'secondary'}
                  size="sm"
                  className="gap-2"
                  onClick={() => setConfirmOpen(true)}
                >
                  {branch.isActive ? (
                    <PowerOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Power className="h-4 w-4" aria-hidden="true" />
                  )}
                  {branch.isActive ? t('deactivate') : t('activate')}
                </Button>
              </>
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
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t('details')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Field label={t('formNameLabel')}>
              <ul className="space-y-1">
                {['ru', 'en', 'hy'].map((l) => (
                  <li key={l} className="flex gap-3">
                    <span className="w-6 uppercase text-muted-foreground">{l}</span>
                    <span>{branch.name?.[l] || '—'}</span>
                  </li>
                ))}
              </ul>
            </Field>

            <Field label={t('formAddressLabel')}>
              <span className="text-muted-foreground">{branch.address || '—'}</span>
            </Field>

            <Field label={t('formPhoneLabel')}>
              {branch.phone ? (
                <a
                  href={`tel:${branch.phone}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {branch.phone}
                </a>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Field>

            <Field label={t('headOffice')}>
              {branch.isPrimary ? (
                <Badge variant="success">{t('headOfficeBadge')}</Badge>
              ) : (
                <span className="text-muted-foreground">{t('none')}</span>
              )}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('status')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('status')}</span>
              {branch.isActive ? (
                <Badge variant="success">{t('active')}</Badge>
              ) : (
                <Badge variant="muted">{t('closed')}</Badge>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('responsible')}</span>
              <span>{branch.responsibleEmployeeId ?? t('none')}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {canWrite ? (
        <BranchFormDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          branch={branch}
          onSubmit={handleUpdate}
        />
      ) : null}

      {canWrite ? (
        <Dialog
          open={confirmOpen}
          onClose={() => (acting ? null : setConfirmOpen(false))}
          title={branch.isActive ? t('deactivateConfirmTitle') : t('activateConfirmTitle')}
          description={
            branch.isActive ? t('deactivateConfirmBody') : t('activateConfirmBody')
          }
          closeLabel={t('common:cancel')}
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={acting}>
                {t('common:cancel')}
              </Button>
              <Button
                variant={branch.isActive ? 'destructive' : 'default'}
                onClick={handleToggleActive}
                disabled={acting}
                className="gap-2"
              >
                {acting ? <Spinner size={14} /> : null}
                {branch.isActive ? t('deactivate') : t('activate')}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">
            {localize(branch.name, lng)}
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
