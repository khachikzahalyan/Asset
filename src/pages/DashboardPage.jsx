import { useTranslation } from 'react-i18next';
import { Package, Boxes, HandHelping, Wrench, Users, Building2, Plus } from 'lucide-react';

import PageHeader from '@/components/common/PageHeader.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';

const TILES = [
  { key: 'totalAssets', icon: Package, tone: 'bg-sky-100 text-sky-700' },
  { key: 'inStock', icon: Boxes, tone: 'bg-emerald-100 text-emerald-700' },
  { key: 'issued', icon: HandHelping, tone: 'bg-violet-100 text-violet-700' },
  { key: 'underRepair', icon: Wrench, tone: 'bg-amber-100 text-amber-700' },
  { key: 'activeEmployees', icon: Users, tone: 'bg-rose-100 text-rose-700' },
  { key: 'branches', icon: Building2, tone: 'bg-slate-100 text-slate-700' },
];

export default function DashboardPage() {
  const { t } = useTranslation('dashboard');
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('addAsset')}
          </Button>
        }
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map(({ key, icon: Icon, tone }) => (
          <Card key={key} className="overflow-hidden">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t(key)}</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight">—</p>
              </div>
              <span
                className={`grid h-11 w-11 place-items-center rounded-lg ${tone}`}
                aria-hidden="true"
              >
                <Icon className="h-5 w-5" />
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('recentActivity')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('comingSoon')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('quickActions')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-2">
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('addAsset')}
            </Button>
            <Button variant="outline" size="sm" className="gap-2">
              <HandHelping className="h-4 w-4" aria-hidden="true" />
              {t('issueAsset')}
            </Button>
            <Button variant="outline" size="sm" className="gap-2">
              <Users className="h-4 w-4" aria-hidden="true" />
              {t('addEmployee')}
            </Button>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
