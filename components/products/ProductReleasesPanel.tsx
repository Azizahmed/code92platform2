import {ChevronRight, Rocket} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import NewCycleButton from '@/components/releases/NewCycleButton';
import ReleaseStatusChip from '@/components/releases/ReleaseStatusChip';
import RiskTierChip from '@/components/risk/RiskTierChip';
import {Link} from '@/i18n/navigation';
import type {ReleaseOverview} from '@/lib/releases';

// Every release of a product, the MVP first, with the stage it is in and how much
// of the evidence for that stage has been filed.
export default async function ProductReleasesPanel({
  productId,
  releases,
  canCreate,
  canCreateReason,
  locale
}: {
  productId: string;
  releases: ReleaseOverview[];
  canCreate: boolean;
  canCreateReason: 'gate' | null;
  locale: string;
}) {
  const t = await getTranslations('releases');
  const dateFormat = new Intl.DateTimeFormat(locale, {year: 'numeric', month: 'short', day: 'numeric'});
  const ordered = [...releases].sort((a, b) => a.release_number - b.release_number);
  const defaultTarget = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{t('panel.title')}</h2>
        {canCreate ? (
          <NewCycleButton productId={productId} defaultTargetDate={defaultTarget} />
        ) : canCreateReason === 'gate' ? (
          <p className="text-[11px] text-faint">{t('panel.needsGate')}</p>
        ) : null}
      </div>

      {ordered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-10 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-accent/30 bg-accent/10">
            <Rocket className="h-4 w-4 text-accent" strokeWidth={1.5} />
          </span>
          <div className="text-sm font-medium">{t('panel.emptyTitle')}</div>
          <p className="max-w-sm text-sm leading-relaxed text-muted">{t('panel.emptyBody')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {ordered.map((release) => (
            <li key={release.id}>
              <Link
                href={`/releases/${release.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-hairline bg-panel px-4 py-3 transition-colors hover:border-accent/30"
              >
                <span className="font-mono text-xs text-faint">
                  {release.is_mvp ? t('panel.mvp') : `#${release.release_number}`}
                </span>
                <span dir="ltr" className="font-mono text-sm font-semibold">{release.version}</span>
                <ReleaseStatusChip status={release.status} />
                <span className="rounded border border-hairline bg-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted">
                  {t(`stage.${release.stage}`)}
                </span>
                <RiskTierChip riskTier={release.risk_tier} />
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{release.goal ?? t('panel.noGoal')}</span>
                <span className="font-mono text-[11px] text-faint">
                  {t('panel.filed', {filed: release.artifacts_filed, required: release.artifacts_required})}
                </span>
                {release.target_date ? (
                  <span className="text-[11px] text-faint">
                    {dateFormat.format(new Date(`${release.target_date}T00:00:00`))}
                  </span>
                ) : null}
                <ChevronRight className="h-3.5 w-3.5 text-faint rtl:rotate-180" strokeWidth={2} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
