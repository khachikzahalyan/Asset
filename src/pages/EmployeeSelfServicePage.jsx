import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';

import PageHeader from '@/components/common/PageHeader.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { useAuth } from '@/contexts/AuthContext.jsx';

export default function EmployeeSelfServicePage() {
  const { t } = useTranslation('me');
  const { user } = useAuth();
  const name = user?.displayName || user?.email || '';
  return (
    <>
      <PageHeader title={t('title')} description={t('greeting', { name })} />

      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
          <Package className="h-10 w-10" aria-hidden="true" />
          <p className="text-sm">{t('noAssignments')}</p>
        </CardContent>
      </Card>
    </>
  );
}
