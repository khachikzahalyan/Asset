import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass, ArrowLeft } from 'lucide-react';

import AuthShell from '@/components/common/AuthShell.jsx';

export default function NotFoundPage() {
  const { t } = useTranslation('errors');
  return (
    <AuthShell title="404" description={t('notFound')}>
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-muted text-muted-foreground">
          <Compass className="h-6 w-6" aria-hidden="true" />
        </span>
        <p className="text-sm text-muted-foreground">{t('notFoundBody')}</p>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('goHome')}
        </Link>
      </div>
    </AuthShell>
  );
}
