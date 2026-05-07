// src/pages/UsersPage.jsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button.jsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { useUsers } from '@/hooks/useUsers.js';
import { useUserInvitations } from '@/hooks/useUserInvitations.js';
import { firestoreUsersRepository } from '@/infra/repositories/firestoreUsersRepository.js';
import { firestoreUserInvitationsRepository } from '@/infra/repositories/firestoreUserInvitationsRepository.js';
import { ROLES } from '@/domain/roles.js';

import InviteAdminDialog from '@/components/features/users/InviteAdminDialog.jsx';
import RoleChangeDialog from '@/components/features/users/RoleChangeDialog.jsx';
import ConfirmActionDialog from '@/components/features/users/ConfirmActionDialog.jsx';

const ROLE_KEY = {
  super_admin: 'roleSuperAdmin',
  asset_admin: 'roleAssetAdmin',
  tech_admin: 'roleTechAdmin',
  employee: 'roleEmployee',
};

export default function UsersPage() {
  const { t } = useTranslation('users');
  const { user, role: actorRole } = useAuth();
  const actor = user ? { uid: user.uid, role: actorRole } : null;

  const { data: users, loading: usersLoading, error: usersError } = useUsers();
  const { data: invitations, loading: invitesLoading, error: invitesError } = useUserInvitations();

  const [inviteOpen, setInviteOpen] = useState(false);

  const [roleTarget, setRoleTarget] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  // confirmAction shape: { kind: 'deactivate'|'reactivate'|'revoke', payload: ... }
  const [actionError, setActionError] = useState(null);

  const activeSuperAdminCount = useMemo(
    () => users.filter((u) => u.role === ROLES.SUPER_ADMIN && u.isActive === true).length,
    [users]
  );

  function isSelf(u) {
    return u.uid === user?.uid;
  }

  function startToggleActive(target) {
    setConfirmAction({
      kind: target.isActive ? 'deactivate' : 'reactivate',
      payload: target,
    });
  }

  function startRevoke(invitation) {
    setConfirmAction({ kind: 'revoke', payload: invitation });
  }

  async function runConfirmedAction() {
    if (!confirmAction || !actor) return;
    const { kind, payload } = confirmAction;
    try {
      if (kind === 'deactivate') {
        await firestoreUsersRepository.setActive(payload.uid, false, payload, actor);
      } else if (kind === 'reactivate') {
        await firestoreUsersRepository.setActive(payload.uid, true, payload, actor);
      } else if (kind === 'revoke') {
        await firestoreUserInvitationsRepository.revoke(payload.email, payload, actor);
      }
      setActionError(null);
      setConfirmAction(null);
    } catch (err) {
      console.error('[AMS confirmed action]', err);
      setActionError(t('genericError'));
      throw err;
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('usersTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('usersSubtitle')}</p>
        </div>
      </header>

      {actionError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      {/* Active users */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>{t('sectionActive')}</CardTitle>
            <CardDescription>{users.length}</CardDescription>
          </div>
          <Button onClick={() => setInviteOpen(true)} className="gap-2">
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            {t('inviteCta')}
          </Button>
        </CardHeader>
        <CardContent>
          {usersError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{usersError.message}</AlertDescription>
            </Alert>
          ) : null}
          {usersLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> {t('users:loading', { defaultValue: '' })}
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('emptyActiveUsers')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="px-3 py-2">{t('colEmail')}</th>
                    <th className="px-3 py-2">{t('colRole')}</th>
                    <th className="px-3 py-2">{t('colStatus')}</th>
                    <th className="px-3 py-2 text-right">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.uid} className="border-t">
                      <td className="px-3 py-2 font-medium">{u.email}</td>
                      <td className="px-3 py-2">{t(ROLE_KEY[u.role] ?? 'roleEmployee')}</td>
                      <td className="px-3 py-2">
                        <Badge variant={u.isActive ? 'default' : 'secondary'}>
                          {u.isActive ? t('statusActive') : t('statusInactive')}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setRoleTarget(u)}
                          >
                            {t('actionsChangeRole')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={u.isActive ? 'outline' : 'default'}
                            disabled={isSelf(u)}
                            title={isSelf(u) ? t('errCannotDeactivateSelf') : undefined}
                            onClick={() => startToggleActive(u)}
                          >
                            {u.isActive ? t('actionsDeactivate') : t('actionsActivate')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending invitations */}
      <Card>
        <CardHeader>
          <CardTitle>{t('sectionPending')}</CardTitle>
          <CardDescription>{invitations.length}</CardDescription>
        </CardHeader>
        <CardContent>
          {invitesError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{invitesError.message}</AlertDescription>
            </Alert>
          ) : null}
          {invitesLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
            </div>
          ) : invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('emptyPendingInvitations')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="px-3 py-2">{t('colEmail')}</th>
                    <th className="px-3 py-2">{t('colRole')}</th>
                    <th className="px-3 py-2">{t('colInvitedAt')}</th>
                    <th className="px-3 py-2 text-right">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((inv) => (
                    <tr key={inv.email} className="border-t">
                      <td className="px-3 py-2 font-medium">{inv.email}</td>
                      <td className="px-3 py-2">{t(ROLE_KEY[inv.role] ?? 'roleEmployee')}</td>
                      <td className="px-3 py-2">
                        {inv.invitedAt?.toDate?.()?.toLocaleString?.() ?? ''}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {inv.email !== user?.email?.toLowerCase() ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => startRevoke(inv)}
                          >
                            {t('actionsRevoke')}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <InviteAdminDialog open={inviteOpen} onOpenChange={setInviteOpen} actor={actor} />

      <RoleChangeDialog
        open={Boolean(roleTarget)}
        onOpenChange={(open) => {
          if (!open) setRoleTarget(null);
        }}
        targetUser={roleTarget}
        activeSuperAdminCount={activeSuperAdminCount}
        actor={actor}
      />

      <ConfirmActionDialog
        open={Boolean(confirmAction)}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmAction(null);
            setActionError(null);
          }
        }}
        title={
          confirmAction?.kind === 'deactivate'
            ? t('confirmDeactivateTitle')
            : confirmAction?.kind === 'reactivate'
            ? t('confirmActivateTitle')
            : confirmAction?.kind === 'revoke'
            ? t('confirmRevokeTitle')
            : ''
        }
        description={
          confirmAction?.kind === 'deactivate'
            ? t('confirmDeactivateBody', { email: confirmAction.payload.email })
            : confirmAction?.kind === 'reactivate'
            ? t('confirmActivateBody', { email: confirmAction.payload.email })
            : confirmAction?.kind === 'revoke'
            ? t('confirmRevokeBody', { email: confirmAction.payload.email })
            : ''
        }
        confirmLabel={
          confirmAction?.kind === 'deactivate'
            ? t('actionsDeactivate')
            : confirmAction?.kind === 'reactivate'
            ? t('actionsActivate')
            : confirmAction?.kind === 'revoke'
            ? t('actionsRevoke')
            : ''
        }
        destructive={confirmAction?.kind === 'deactivate' || confirmAction?.kind === 'revoke'}
        onConfirm={runConfirmedAction}
      />
    </div>
  );
}
