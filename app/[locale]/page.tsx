import {Radar} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import {requireActiveMember} from '@/lib/auth';

export default async function DashboardPage() {
  await requireActiveMember();
  const t = await getTranslations('common');

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">{t('dashboard.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('dashboard.subtitle')}</p>
      </header>

      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-24 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full border border-accent/20 bg-accent/10">
          <Radar className="h-5 w-5 text-accent" strokeWidth={1.5} />
        </span>
        <div className="text-sm font-medium">{t('dashboard.emptyTitle')}</div>
        <p className="max-w-md text-sm leading-relaxed text-muted">
          {t('dashboard.emptyBody')}
        </p>
      </div>
    </section>
  );
}
