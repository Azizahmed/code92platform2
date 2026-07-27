'use client';

import Image from 'next/image';
import {useMemo, useState} from 'react';
import {Package} from 'lucide-react';
import {useFormatter, useTranslations} from 'next-intl';

import HealthBadge, {type Health} from '@/components/HealthBadge';
import LifecycleBarCompact from '@/components/lifecycle/LifecycleBarCompact';
import RiskTierChip from '@/components/lifecycle/RiskTierChip';
import OverdueBadge from '@/components/OverdueBadge';
import RelativeTime from '@/components/RelativeTime';
import StageChip, {type Stage} from '@/components/StageChip';
import {Link} from '@/i18n/navigation';
import type {
  LifecyclePhase,
  LifecycleState,
  RiskTier
} from '@/lib/lifecycle';

export type ProductRow = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  stage: Stage;
  health: Health;
  ownerName: string | null;
  nextReviewAt: string | null;
  lastStatusUpdateAt: string | null;
  archivedAt: string | null;
  riskTier: RiskTier;
  lifecyclePhase: LifecyclePhase | null;
  lifecycleState: LifecycleState | null;
  lifecycleCompleteCount: number;
};

const STAGES: Stage[] = [
  'idea',
  'development',
  'beta',
  'live',
  'paused',
  'sunset'
];
const HEALTHS: Health[] = ['green', 'yellow', 'red', 'unknown'];

const SELECT_CLASS =
  'rounded-md border border-hairline bg-bg px-2.5 py-1.5 text-xs text-muted outline-none transition-colors focus:border-accent/50';

export default function ProductsTable({products}: {products: ProductRow[]}) {
  const t = useTranslations('products');
  const tCommon = useTranslations('common');
  const tLifecycle = useTranslations('lifecycle');
  const format = useFormatter();

  const [stage, setStage] = useState<'all' | Stage>('all');
  const [health, setHealth] = useState<'all' | Health>('all');
  const [showArchived, setShowArchived] = useState(false);

  const visible = useMemo(
    () =>
      products.filter(
        (p) =>
          (showArchived || !p.archivedAt) &&
          (stage === 'all' || p.stage === stage) &&
          (health === 'all' || p.health === health)
      ),
    [products, stage, health, showArchived]
  );

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-20 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-accent/20 bg-accent/10">
          <Package className="h-5 w-5 text-accent" strokeWidth={1.75} />
        </span>
        <div className="text-sm font-medium">{t('list.emptyTitle')}</div>
        <p className="max-w-md text-sm leading-relaxed text-muted">
          {t('list.emptyBody')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted">
          {t('list.stageFilter')}
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as 'all' | Stage)}
            className={SELECT_CLASS}
          >
            <option value="all">{t('list.allStages')}</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {tCommon(`stages.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          {t('list.healthFilter')}
          <select
            value={health}
            onChange={(e) => setHealth(e.target.value as 'all' | Health)}
            className={SELECT_CLASS}
          >
            <option value="all">{t('list.allHealth')}</option>
            {HEALTHS.map((h) => (
              <option key={h} value={h}>
                {tCommon(`health.${h}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="ms-auto flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-3.5 w-3.5 accent-accent"
          />
          {t('list.showArchived')}
        </label>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-12 text-center text-sm text-muted">
          {t('list.emptyFiltered')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-panel">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="border-b border-hairline text-[10px] uppercase tracking-widest text-faint">
                <th className="px-4 py-2.5 text-start font-medium">
                  {t('list.colName')}
                </th>
                <th className="px-4 py-2.5 text-start font-medium">
                  {t('list.colStage')}
                </th>
                <th className="px-4 py-2.5 text-start font-medium">
                  {t('list.colHealth')}
                </th>
                <th className="px-4 py-2.5 text-start font-medium">
                  {tLifecycle('governance.columns.phase')}
                </th>
                <th className="px-4 py-2.5 text-start font-medium">
                  {t('list.colOwner')}
                </th>
                <th className="px-4 py-2.5 text-start font-medium">
                  {t('list.colNextReview')}
                </th>
                <th className="px-4 py-2.5 text-start font-medium">
                  {t('list.colLastUpdate')}
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const overdue =
                  !p.archivedAt &&
                  p.nextReviewAt !== null &&
                  new Date(p.nextReviewAt).getTime() < Date.now();
                return (
                  <tr
                    key={p.id}
                    className="border-b border-hairline transition-colors last:border-0 hover:bg-raised/60"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/products/${p.id}`}
                        className="group flex items-center gap-3"
                      >
                        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-hairline bg-raised font-mono text-xs text-faint">
                          {p.logoUrl ? (
                            <Image
                              src={p.logoUrl}
                              alt={p.name}
                              fill
                              unoptimized
                              sizes="36px"
                              className="object-cover"
                            />
                          ) : (
                            p.name.slice(0, 1).toUpperCase()
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-medium text-ink group-hover:text-accent">
                            {p.name}
                          </span>
                          <span
                            dir="ltr"
                            className="block font-mono text-[11px] text-faint"
                          >
                            {p.slug}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StageChip stage={p.stage} />
                    </td>
                    <td className="px-4 py-3">
                      <HealthBadge health={p.health} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="min-w-32 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-muted">
                            {p.lifecyclePhase
                              ? tLifecycle(`phases.${p.lifecyclePhase}`)
                              : '—'}
                          </span>
                          <RiskTierChip riskTier={p.riskTier} />
                        </div>
                        <LifecycleBarCompact
                          phase={p.lifecyclePhase}
                          state={p.lifecycleState}
                          completeCount={p.lifecycleCompleteCount}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {p.ownerName ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        {p.nextReviewAt ? (
                          <time
                            dateTime={p.nextReviewAt}
                            className="font-mono text-xs text-muted"
                          >
                            {format.dateTime(new Date(p.nextReviewAt), {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric'
                            })}
                          </time>
                        ) : (
                          <span className="text-xs text-faint">
                            {t('list.noReview')}
                          </span>
                        )}
                        {overdue ? <OverdueBadge /> : null}
                        {p.archivedAt ? (
                          <span className="rounded border border-hairline bg-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-faint">
                            {t('list.archivedTag')}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {p.lastStatusUpdateAt ? (
                        <RelativeTime date={p.lastStatusUpdateAt} />
                      ) : (
                        <span className="text-xs text-faint">
                          {t('list.noUpdates')}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
