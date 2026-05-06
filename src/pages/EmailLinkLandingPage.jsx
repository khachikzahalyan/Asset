import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail, AlertCircle, ArrowLeft } from 'lucide-react';

import AuthShell from '@/components/common/AuthShell.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';

import { useAuth } from '@/contexts/AuthContext.jsx';

function mapAuthError(err, t) {
  const code = err?.code ?? '';
  if (code === 'auth/invalid-action-code' || code === 'auth/expired-action-code')
    return t('invalidLink');
  if (code === 'auth/invalid-email') return t('genericError');
  if (err?.message === 'email-required') return t('needEmailBody');
  return t('genericError');
}

export default function EmailLinkLandingPage() {
  const { t } = useTranslation('auth');
  const { user, role, loading, isEmailLink, completeEmailLinkSignIn } = useAuth();

  const [status, setStatus] = useState('working');
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isEmailLink()) {
      setStatus('invalid');
      return;
    }
    completeEmailLinkSignIn(null).catch((err) => {
      if (err?.message === 'email-required') {
        setStatus('needEmail');
      } else {
        setStatus('error');
        setError(mapAuthError(err, t));
      }
    });
  }, [isEmailLink, completeEmailLinkSignIn, t]);

  if (!loading && user && role) {
    return <Navigate to={role === 'employee' ? '/me' : '/dashboard'} replace />;
  }

  async function handleConfirmEmail(e) {
    e.preventDefault();
    if (!email) return;
    setStatus('working');
    setError(null);
    try {
      await completeEmailLinkSignIn(email);
    } catch (err) {
      setStatus('error');
      setError(mapAuthError(err, t));
    }
  }

  if (status === 'working') {
    return (
      <AuthShell title={t('completing')}>
        <div className="flex flex-col items-center gap-3 py-6 text-muted-foreground">
          <Spinner size={32} />
        </div>
      </AuthShell>
    );
  }

  if (status === 'needEmail') {
    return (
      <AuthShell
        title={t('needEmail')}
        description={t('needEmailBody')}
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
        <form onSubmit={handleConfirmEmail} className="space-y-4" noValidate>
          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="confirm-email">{t('emailLabel')}</Label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="confirm-email"
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

          <Button type="submit" className="w-full" size="lg" disabled={!email}>
            {t('sendLink')}
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('invalidLink')}
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
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        <AlertDescription>{error ?? t('invalidLink')}</AlertDescription>
      </Alert>
    </AuthShell>
  );
}
