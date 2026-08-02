'use client';

import {useState} from 'react';
import {CalendarDays, ListChecks, Plus, Rocket} from 'lucide-react';
import {useTranslations} from 'next-intl';

import ReleaseForm, {
  type ReleaseMemberOption
} from '@/components/releases/ReleaseForm';
import ReleaseStatusChip from '@/components/releases/ReleaseStatusChip';
import {Link} from '@/i18n/navigation';
import type {ReleaseOverview} from '@/lib/releases';

// The product's own cycles, compact. The full picture — checklist, scope,
// history — lives on /releases/[id]; this is the "what is in flight here"
// summary and the place you start a new one from.
export default function ProductReleasesPanel({
  productId,
  releases,
  members,
  locale,
  canManage
}: {
  productId: string;
  releases: ReleaseOverview[];
  members: ReleaseMemberOption[];
  locale: string;
  canManage: boolean;
}) {
  const t = useTranslations('releases');
  const [creating, setCreating] = useState(false);

  const dateFormat = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  return (
    <section id="releases" className="scroll-mt-8 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Rocket className="h-4 w-4 text-accent" strokeWidth={1.75} />
            <h2 className="text-sm font-medium">{t('panel.title')}</h2>
          </div>
          <p className="mt-1 text-xs text-muted">{t('panel.subtitle')}</p>
        </div>
        {canManage && !creating ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            {t('newRelease')}
          </button>
        ) : null}
      </header>

      {creating ? (
        <ReleaseForm
          productId={productId}
          members={members}
          onDone={() => setCreating(false)}
        />
      ) : null}

      {releases.length === 0 && !creating ? (
        <p className="rounded-lg border border-dashed border-hairline bg-panel/50 px-4 py-6 text-center text-xs text-muted">
          {t('panel.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-panel">
          {releases.map((release) => {
            const target = release.target_date
              ? dateFormat.format(new Date(`${release.target_date}T00:00:00`))
              : null;
            return (
              <li key={release.id}>
                <Link
                  href={`/releases/${release.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-raised/35"
                >
                  <span
                    dir="ltr"
                    className="font-mono text-sm font-medium text-ink"
                  >
                    {release.version}
                  </span>
                  {release.name ? (
                    <span className="min-w-0 flex-1 truncate text-xs text-muted">
                      {release.name}
                    </span>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] text-faint">
                    <ListChecks className="h-3 w-3" strokeWidth={1.75} />
                    {release.checks_done}/{release.checks_required}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 font-mono text-[11px] ${
                      release.is_overdue ? 'text-amber' : 'text-faint'
                    }`}
                  >
                    <CalendarDays className="h-3 w-3" strokeWidth={1.75} />
                    {target ?? t('noTargetDate')}
                  </span>
                  <ReleaseStatusChip status={release.status} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
