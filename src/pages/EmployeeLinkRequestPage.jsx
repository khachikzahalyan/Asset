import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail, AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react';

import AuthShell from '@/components/common/AuthShell.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';

import { useAuth } from '@/contexts/AuthContext.jsx';

const EMPLOYEE_LINK_REDIRECT = `${window.location.origin}/auth/email-link`;

function mapAuthError(err, t) {
  const code = err?.code ?? '';
  if (code === 'auth/user-disabled' || code === 'auth/user-not-found')
    return t('emailNotRegistered');
  if (code === 'auth/admin-restricted-operation') return t('domainNotAllowed');
  return t('genericError');
}

export default function EmployeeLinkRequestPage() {
  const { t } = useTranslation('auth');
  const { t: tc } = useTranslation('common');
  const { sendEmployeeSignInLink } = useAuth();

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sentTo, setSentTo] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email) return;
    setBusy(true);
    setError(null);
    try {
      await sendEmployeeSignInLink(email, EMPLOYEE_LINK_REDIRECT);
      setSentTo(email);
    } catch (err) {
      setError(mapAuthError(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={t('tabEmployee')}
      description={t('employeeHelp')}
      footer={
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('backToLogin')}
        </Link>
      }
    >
      {sentTo ? (
        <Alert variant="success">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>{t('linkSent')}</AlertTitle>
          <AlertDescription>
            {t('linkSentBody', { email: sentTo })}
            <div className="mt-3">
              <button
                type="button"
                onClick={() => {
                  setSentTo(null);
                  setEmail('');
                }}
                className="text-sm font-medium underline underline-offset-4"
              >
                {t('tryAnotherEmail')}
              </button>
            </div>
          </AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="employee-email-page">{t('emailLabel')}</Label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="employee-email-page"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                placeholder={t('enterEmail')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <Button type="submit" className="w-full" size="lg" disabled={busy || !email}>
            {busy ? (
              <>
                <Spinner />
                {t('sendingLink')}
              </>
            ) : (
              t('sendLink')
            )}
          </Button>

          <p className="text-center text-xs text-muted-foreground">{tc('appName')}</p>
        </form>
      )}
    </AuthShell>
  );
}
