import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldOff, ArrowLeft } from 'lucide-react';

import AuthShell from '@/components/common/AuthShell.jsx';

export default function ForbiddenPage() {
  const { t } = useTranslation('errors');
  return (
    <AuthShell title="403" description={t('forbidden')}>
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-destructive/10 text-destructive">
          <ShieldOff className="h-6 w-6" aria-hidden="true" />
        </span>
        <p className="text-sm text-muted-foreground">{t('forbiddenBody')}</p>
        <Link
          to="/"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('goHome')}
        </Link>
      </div>
    </AuthShell>
  );
}
