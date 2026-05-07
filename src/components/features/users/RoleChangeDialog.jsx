// src/components/features/users/RoleChangeDialog.jsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';

import { ROLES } from '@/domain/roles.js';
import { firestoreUsersRepository } from '@/infra/repositories/firestoreUsersRepository.js';

const ROLE_OPTIONS = [
  { value: ROLES.SUPER_ADMIN, key: 'roleSuperAdmin' },
  { value: ROLES.ASSET_ADMIN, key: 'roleAssetAdmin' },
  { value: ROLES.TECH_ADMIN, key: 'roleTechAdmin' },
  { value: ROLES.EMPLOYEE, key: 'roleEmployee' },
];

/**
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 *   targetUser: import('@/domain/repositories/UsersRepository.js').AppUser | null,
 *   activeSuperAdminCount: number,
 *   actor: { uid: string, role: string },
 * }} props
 */
export default function RoleChangeDialog({
  open,
  onOpenChange,
  targetUser,
  activeSuperAdminCount,
  actor,
}) {
  const { t } = useTranslation('users');
  const [selected, setSelected] = useState(targetUser?.role ?? ROLES.TECH_ADMIN);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setSelected(targetUser?.role ?? ROLES.TECH_ADMIN);
      setError(null);
      setBusy(false);
    }
  }, [open, targetUser]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!targetUser) return;
    if (selected === targetUser.role) {
      onOpenChange(false);
      return;
    }
    // Guard: cannot demote the last active super_admin
    const isDemotingLastSuperAdmin =
      targetUser.role === ROLES.SUPER_ADMIN &&
      targetUser.isActive === true &&
      activeSuperAdminCount <= 1 &&
      selected !== ROLES.SUPER_ADMIN;
    if (isDemotingLastSuperAdmin) {
      setError(t('errLastSuperAdmin'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await firestoreUsersRepository.updateRole(targetUser.uid, selected, targetUser, actor);
      onOpenChange(false);
    } catch (err) {
      console.error('[AMS role change]', err);
      setError(err?.message ?? 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('roleChangeDialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('roleChangeDialogDescription', { email: targetUser?.email ?? '' })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset className="flex flex-col gap-2">
            {ROLE_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="role"
                  value={opt.value}
                  checked={selected === opt.value}
                  onChange={() => setSelected(opt.value)}
                />
                <span>{t(opt.key)}</span>
              </label>
            ))}
          </fieldset>

          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('btnCancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : null}
              {busy ? t('btnSaving') : t('btnSave')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
