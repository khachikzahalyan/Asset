import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';

export default function RequireAuth({ children, fallback = null }) {
  const { user, loading } = useAuth();
  const { t } = useTranslation('common');
  const location = useLocation();

  if (loading) {
    return (
      fallback ?? (
        <div className="grid min-h-screen place-items-center bg-muted/30">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Spinner size={20} />
            <span className="text-sm">{t('loadingApp')}</span>
          </div>
        </div>
      )
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
