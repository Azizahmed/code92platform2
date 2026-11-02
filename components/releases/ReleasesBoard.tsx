'use client';

import {useMemo, useState} from 'react';
import {AlertTriangle} from 'lucide-react';
import {useTranslations} from 'next-intl';

import NewCycleButton from '@/components/releases/NewCycleButton';
import ReleaseStatusChip from '@/components/releases/ReleaseStatusChip';
import RiskTierChip from '@/components/risk/RiskTierChip';
import {Link} from '@/i18n/navigation';
import {releaseKind, RELEASE_STAGES, type ReleaseOverview, type ReleaseStage} from '@/lib/releases';

type Scope = 'active' | 'shipped' | 'all';

const ACTIVE = ['planned', 'in_progress', 'ready'];
const SHIPPED = ['released', 'rolled_back'];

// Every release across every product, by the stage it is in. The question people
// ask is "what is in design, and what is going out", and a column answers it.
export default function ReleasesBoard({
  releases,
  products,
  locale,
  canCreate,
  defaultTargetDate
}: {
  releases: ReleaseOverview[];
  products: {id: string; name: string}[];
  locale: string;
  canCreate: boolean;
  defaultTargetDate: string;
}) {
  const t = useTranslations('releases');
  const [scope, setScope] = useState<Scope>('active');
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, {month: 'short', day: 'numeric'}),
    [locale]
  );

  const visible = releases.filter((release) => {
    if (scope === 'active') return ACTIVE.includes(release.status);
    if (scope === 'shipped') return SHIPPED.includes(release.status);
    return true;
  });

  const overdue = visible.filter((release) => release.is_overdue).length;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {(['active', 'shipped', 'all'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setScope(option)}
              className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                scope === option ? 'border-accent/40 bg-accent/10 text-accent' : 'border-hairline text-muted hover:bg-raised hover:text-ink'
              }`}
            >
              {t(`scope.${option}`)}
            </button>
          ))}
          {overdue > 0 ? (
            <span className="ms-2 inline-flex items-center gap-1 self-center text-xs text-danger">
              <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
              {t('stats.overdue', {count: overdue})}
            </span>
          ) : null}
        </div>
        {canCreate && products.length > 0 ? (
          <NewCycleButton products={products} defaultTargetDate={defaultTargetDate} />
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-hairline px-4 py-10 text-center text-xs text-faint">{t('emptyBody')}</p>
      ) : (
        <div className="grid gap-3 overflow-x-auto pb-2 lg:grid-cols-6">
          {RELEASE_STAGES.map((stage) => {
            const items = visible.filter((release) => release.stage === stage);
            return (
              <div key={stage} className="min-w-[200px] space-y-2 rounded-lg border border-hairline bg-panel/60 p-2.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted">{t(`stage.${stage}`)}</span>
                  <span className="font-mono text-[10px] text-faint">{items.length}</span>
                </div>
                {items.length === 0 ? <p className="px-1 py-3 text-[11px] text-faint">{t('board.none')}</p> : null}
                {items.map((release) => (
                  <BoardCard key={release.id} release={release} stage={stage} dateFormat={dateFormat} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function BoardCard({
  release,
  stage,
  dateFormat
}: {
  release: ReleaseOverview;
  stage: ReleaseStage;
  dateFormat: Intl.DateTimeFormat;
}) {
  const t = useTranslations('releases');
  return (
    <Link
      href={`/releases/${release.id}`}
      className="block space-y-2 rounded-md border border-hairline bg-bg p-2.5 transition-colors hover:border-accent/30"
      aria-label={`${release.product_name} ${release.version} ${t(`stage.${stage}`)}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span dir="ltr" className="font-mono text-xs font-semibold">{release.version}</span>
        <span className="text-[9px] uppercase tracking-wider text-faint">{t(`kind.${releaseKind(release.release_number)}`)}</span>
      </div>
      <p className="truncate text-xs text-muted">{release.product_name}</p>
      <p className="line-clamp-2 min-h-[2.25rem] text-[11px] text-faint">{release.goal ?? t('panel.noGoal')}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <ReleaseStatusChip status={release.status} />
        <RiskTierChip riskTier={release.risk_tier} />
      </div>
      <div className="flex items-center justify-between font-mono text-[10px] text-faint">
        <span>{t('panel.filed', {filed: release.artifacts_filed, required: release.artifacts_required})}</span>
        {release.target_date ? (
          <span className={release.is_overdue ? 'text-danger' : ''}>
            {dateFormat.format(new Date(`${release.target_date}T00:00:00`))}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
