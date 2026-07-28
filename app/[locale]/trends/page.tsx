import {PowerOff} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import {requireActiveMember} from '@/lib/auth';

// The market-intelligence feed is switched off.
//
// The route is kept so a saved link or bookmark explains itself instead of
// 404ing, but it deliberately runs NO queries: a disabled feature should not
// read the database any more than it should call a model. The feed components
// (TrendCard, TrendsFilter, ProductTrendsPanel) and every trend table are left
// untouched, so restoring this page means restoring the query above it and
// flipping PIPELINE_ENABLED in functions/trend-scan.ts.
export default async function TrendsPage() {
  await requireActiveMember();
  const t = await getTranslations('trends');

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </header>

      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-24 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-hairline bg-raised">
          <PowerOff className="h-5 w-5 text-faint" strokeWidth={1.5} />
        </span>
        <div className="text-sm font-medium">{t('disabled.title')}</div>
        <p className="max-w-md text-sm leading-relaxed text-muted">
          {t('disabled.body')}
        </p>
      </div>
    </section>
  );
}
