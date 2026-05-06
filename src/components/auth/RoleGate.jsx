import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext.jsx';
import { Spinner } from '@/components/ui/spinner.jsx';

export default function RoleGate({ roles = [], children, fallback = null }) {
  const { role, loading } = useAuth();
  const { t } = useTranslation('common');

  if (loading) {
    return (
      fallback ?? (
        <div className="flex items-center gap-3 p-6 text-muted-foreground">
          <Spinner size={18} />
          <span className="text-sm">{t('loading')}</span>
        </div>
      )
    );
  }

  if (!role || !roles.includes(role)) {
    return <Navigate to="/403" replace />;
  }

  return children;
}
