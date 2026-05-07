// src/components/features/users/InviteAdminDialog.jsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, AlertCircle } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';

import {
  emptyInviteInput,
  validateInviteInput,
  sanitizeInviteInput,
  INVITE_ROLE_LIST,
} from '@/domain/userInvitations.js';
import { firestoreUserInvitationsRepository } from '@/infra/repositories/firestoreUserInvitationsRepository.js';

const ROLE_KEY = {
  super_admin: 'roleSuperAdmin',
  asset_admin: 'roleAssetAdmin',
  tech_admin: 'roleTechAdmin',
};

export default function InviteAdminDialog({ open, onOpenChange, actor }) {
  const { t } = useTranslation('users');
  const [input, setInput] = useState(emptyInviteInput);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setInput(emptyInviteInput());
    setErrors({});
    setSubmitError(null);
    setBusy(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const validation = validateInviteInput(input);
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }
    setErrors({});
    setSubmitError(null);
    setBusy(true);
    try {
      const sanitized = sanitizeInviteInput(input);
      await firestoreUserInvitationsRepository.create(sanitized, actor);
      reset();
      onOpenChange(false);
    } catch (err) {
      console.error('[AMS invite]', err);
      const code = err?.code ?? '';
      if (/already exists/i.test(err?.message ?? '') || code === 'permission-denied') {
        setSubmitError(t('errInviteExists'));
      } else {
        setSubmitError(err?.message ?? t('errInviteExists'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('inviteDialogTitle')}</DialogTitle>
          <DialogDescription>{t('inviteDialogDescription')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="invite-email">{t('formEmailLabel')}</Label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="invite-email"
                type="email"
                autoComplete="off"
                inputMode="email"
                placeholder={t('formEmailPlaceholder')}
                value={input.email}
                onChange={(e) => setInput((prev) => ({ ...prev, email: e.target.value }))}
                className="pl-9"
                aria-invalid={Boolean(errors.email)}
              />
            </div>
            {errors.email ? (
              <p className="text-sm text-destructive">{t(errors.email)}</p>
            ) : null}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('formRoleLabel')}</legend>
            <div className="flex flex-col gap-2">
              {INVITE_ROLE_LIST.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="invite-role"
                    value={r}
                    checked={input.role === r}
                    onChange={() => setInput((prev) => ({ ...prev, role: r }))}
                  />
                  <span>{t(ROLE_KEY[r])}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {submitError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('btnCancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : null}
              {busy ? t('btnInviting') : t('btnInvite')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
