import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Boxes } from 'lucide-react';

import LanguageSwitcher from '@/components/common/LanguageSwitcher.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';

export default function AuthShell({ title, description, children, footer }) {
  const { t } = useTranslation('common');
  const { t: tAuth } = useTranslation('auth');

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_-10%,rgba(59,130,246,0.18),transparent_45%),radial-gradient(circle_at_85%_110%,rgba(16,185,129,0.16),transparent_40%)]"
      />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <Link
          to="/login"
          className="flex items-center gap-2 text-foreground transition-opacity hover:opacity-90"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground shadow">
            <Boxes className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold tracking-tight">{t('appName')}</span>
        </Link>
        <LanguageSwitcher />
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-md flex-col items-center justify-center px-6 pb-16 pt-8 sm:pt-12">
        <Card className="w-full border-border/60 backdrop-blur">
          <CardHeader className="items-center text-center">
            <CardTitle className="text-2xl">{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>

        {footer ? <div className="mt-6 text-center text-sm">{footer}</div> : null}

        <p className="mt-6 text-xs text-muted-foreground">
          {tAuth('footerCopy', { year: new Date().getFullYear() })}
        </p>
      </main>
    </div>
  );
}
