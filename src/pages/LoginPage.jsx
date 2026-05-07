import { useState } from 'react';
import { Navigate, useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Boxes, ShieldCheck, UserRound, Mail, CheckCircle2, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card.jsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';
import LanguageSwitcher from '@/components/common/LanguageSwitcher.jsx';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { ROLES } from '@/domain/roles.js';

const EMPLOYEE_LINK_REDIRECT = `${window.location.origin}/auth/email-link`;

function mapAuthError(err, t) {
  // Always surface in DevTools so the user/dev can read the real Firebase error
  // even when our friendly translation hides the details.
  console.error('[AMS auth]', err);

  const code = err?.code ?? '';
  let msg;
  if (code === 'auth/popup-blocked') msg = t('popupBlocked');
  else if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request')
    msg = t('popupClosed');
  else if (code === 'auth/admin-restricted-operation' || code === 'auth/unauthorized-domain')
    msg = t('domainNotAllowed');
  else if (code === 'auth/user-disabled' || code === 'auth/user-not-found')
    msg = t('emailNotRegistered');
  else if (code === 'auth/operation-not-allowed') msg = t('providerNotEnabled');
  else if (code === 'auth/account-exists-with-different-credential')
    msg = t('accountExistsDifferentCred');
  else if (code === 'auth/network-request-failed') msg = t('networkError');
  else if (code === 'auth/too-many-requests') msg = t('tooManyRequests');
  else if (code === 'auth/invalid-email') msg = t('invalidEmail');
  else if (code === 'auth/invalid-action-code' || code === 'auth/expired-action-code')
    msg = t('invalidLink');
  else if (code === 'auth/missing-or-invalid-nonce' || code === 'auth/internal-error')
    msg = t('genericError');
  else msg = t('genericError');

  // Append the raw code so end-users (and the dev console) always see it,
  // never blocked by a translation gap.
  return code ? `${msg} (${code})` : msg;
}

export default function LoginPage() {
  const { t } = useTranslation('auth');
  const { t: tc } = useTranslation('common');
  const { user, role, loading, accountDisabled, signInWithGoogle, sendEmployeeSignInLink } = useAuth();
  const location = useLocation();

  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState(null);

  const [email, setEmail] = useState('');
  const [empBusy, setEmpBusy] = useState(false);
  const [empError, setEmpError] = useState(null);
  const [empSent, setEmpSent] = useState(null);

  if (!loading && user && role) {
    const dest =
      location.state?.from?.pathname ?? (role === ROLES.EMPLOYEE ? '/me' : '/dashboard');
    return <Navigate to={dest} replace />;
  }

  async function handleGoogle() {
    setAdminBusy(true);
    setAdminError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAdminError(mapAuthError(err, t));
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleSendLink(e) {
    e.preventDefault();
    if (!email) return;
    setEmpBusy(true);
    setEmpError(null);
    try {
      await sendEmployeeSignInLink(email, EMPLOYEE_LINK_REDIRECT);
      setEmpSent(email);
    } catch (err) {
      setEmpError(mapAuthError(err, t));
    } finally {
      setEmpBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_-10%,rgba(59,130,246,0.18),transparent_45%),radial-gradient(circle_at_85%_110%,rgba(16,185,129,0.16),transparent_40%)]"
      />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="flex items-center gap-2 text-foreground">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground shadow">
            <Boxes className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold tracking-tight">{tc('appName')}</span>
        </div>
        <LanguageSwitcher />
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 pb-16 pt-8 sm:pt-12">
        <Card className="w-full border-border/60 backdrop-blur">
          <CardHeader className="items-center text-center">
            <CardTitle className="text-2xl">{t('loginTitle')}</CardTitle>
            <CardDescription>{t('loginSubtitle')}</CardDescription>
          </CardHeader>

          <CardContent>
            {accountDisabled ? (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription>{t('accountDisabled')}</AlertDescription>
              </Alert>
            ) : null}
            <Tabs defaultValue="admin">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="admin" className="gap-2">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  {t('tabAdmin')}
                </TabsTrigger>
                <TabsTrigger value="employee" className="gap-2">
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                  {t('tabEmployee')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="admin" className="space-y-4">
                <p className="text-sm text-muted-foreground">{t('adminHelp')}</p>

                {adminError ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    <AlertDescription>{adminError}</AlertDescription>
                  </Alert>
                ) : null}

                <Button
                  type="button"
                  className="w-full"
                  size="lg"
                  onClick={handleGoogle}
                  disabled={adminBusy}
                >
                  {adminBusy ? (
                    <>
                      <Spinner />
                      {t('signingIn')}
                    </>
                  ) : (
                    <>
                      <GoogleGlyph />
                      {t('signInWithGoogle')}
                    </>
                  )}
                </Button>
              </TabsContent>

              <TabsContent value="employee" className="space-y-4">
                {empSent ? (
                  <Alert variant="success">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    <AlertTitle>{t('linkSent')}</AlertTitle>
                    <AlertDescription>
                      {t('linkSentBody', { email: empSent })}
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => {
                            setEmpSent(null);
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
                  <>
                    <p className="text-sm text-muted-foreground">{t('employeeHelp')}</p>

                    {empError ? (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" aria-hidden="true" />
                        <AlertDescription>{empError}</AlertDescription>
                      </Alert>
                    ) : null}

                    <form onSubmit={handleSendLink} className="space-y-3" noValidate>
                      <div className="space-y-2">
                        <Label htmlFor="employee-email">{t('emailLabel')}</Label>
                        <div className="relative">
                          <Mail
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <Input
                            id="employee-email"
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

                      <Button
                        type="submit"
                        className="w-full"
                        size="lg"
                        disabled={empBusy || !email}
                      >
                        {empBusy ? (
                          <>
                            <Spinner />
                            {t('sendingLink')}
                          </>
                        ) : (
                          t('sendLink')
                        )}
                      </Button>
                    </form>
                  </>
                )}

                <p className="text-center text-xs text-muted-foreground">
                  <Link
                    to="/login/employee"
                    className="underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {t('employeeLink')}
                  </Link>
                </p>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <p className="mt-6 text-xs text-muted-foreground">
          {t('footerCopy', { year: new Date().getFullYear() })}
        </p>
      </main>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg
      viewBox="0 0 18 18"
      width="18"
      height="18"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        fill="#FFC107"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.88 2.68-6.63z"
      />
      <path
        fill="#FF3D00"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A8.99 8.99 0 0 0 9 18z"
      />
      <path
        fill="#4CAF50"
        d="M3.97 10.71A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.27-1.71V4.96H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.33z"
      />
      <path
        fill="#1976D2"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.99 8.99 0 0 0 9 0 8.99 8.99 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
