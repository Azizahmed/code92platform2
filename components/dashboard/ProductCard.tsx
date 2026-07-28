import {CalendarClock} from 'lucide-react';
import Image from 'next/image';
import {useLocale, useTranslations} from 'next-intl';

import HealthBadge from '@/components/HealthBadge';
import LifecycleBarCompact from '@/components/lifecycle/LifecycleBarCompact';
import RiskTierChip from '@/components/lifecycle/RiskTierChip';
import OverdueBadge from '@/components/OverdueBadge';
import StageChip from '@/components/StageChip';
import {Link} from '@/i18n/navigation';
import type {ProductOverview} from './types';

function MetaCell({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-widest text-faint">
        {label}
      </dt>
      <dd className="mt-1 flex min-h-[22px] flex-wrap items-center gap-1.5 text-xs text-ink">
        {children}
      </dd>
    </div>
  );
}

export default function ProductCard({product}: {product: ProductOverview}) {
  const t = useTranslations('dashboard.card');
  const tLifecycle = useTranslations('lifecycle');
  const locale = useLocale();

  const nextReview = product.next_review_at
    ? new Intl.DateTimeFormat(locale, {dateStyle: 'medium'}).format(
        new Date(product.next_review_at)
      )
    : null;


  return (
    <article className="group flex h-full flex-col rounded-lg border border-hairline bg-panel p-4 transition-colors hover:border-accent/30 hover:bg-raised/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-hairline bg-raised font-mono text-xs text-faint">
            {product.logo_url ? (
              <Image
                src={product.logo_url}
                alt={product.name}
                fill
                unoptimized
                sizes="40px"
                className="object-cover"
              />
            ) : (
              product.name.slice(0, 1).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <Link
              href={`/products/${product.id}`}
              title={t('viewProduct')}
              className="block truncate text-sm font-medium text-ink transition-colors group-hover:text-accent"
            >
              {product.name}
            </Link>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <HealthBadge health={product.health} />
              {product.owner_name ? (
                <span className="text-faint">· {product.owner_name}</span>
              ) : null}
              {product.category ? (
                <span className="text-faint">· {product.category}</span>
              ) : null}
            </div>
          </div>
        </div>
        <StageChip stage={product.stage} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 rounded-md border border-hairline bg-raised/50 px-3 py-2.5">
        <MetaCell label={t('updated')}>
          {product.staleness_days === null ? (
            <span className="text-faint">{t('noUpdates')}</span>
          ) : (
            t.rich('daysSinceUpdate', {
              count: product.staleness_days,
              num: (chunks) => <span className="font-mono">{chunks}</span>
            })
          )}
        </MetaCell>

        <MetaCell label={t('nextReview')}>
          {nextReview ? (
            <>
              <CalendarClock
                className={`h-3.5 w-3.5 shrink-0 ${
                  product.is_overdue ? 'text-amber' : 'text-faint'
                }`}
                strokeWidth={1.75}
              />
              <span
                className={`font-mono ${
                  product.is_overdue ? 'text-amber' : 'text-muted'
                }`}
              >
                {nextReview}
              </span>
              {product.is_overdue ? <OverdueBadge /> : null}
            </>
          ) : (
            <span className="text-faint">{t('noReview')}</span>
          )}
        </MetaCell>
      </dl>

      <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted">
        {product.last_update_summary ?? (
          <span className="text-faint">{t('noSummary')}</span>
        )}
      </p>

      <div className="mt-auto space-y-1.5 pt-3">
        <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-faint">
          <span>
            {product.lifecycle_phase
              ? tLifecycle(`phases.${product.lifecycle_phase}`)
              : tLifecycle('title')}
          </span>
          <RiskTierChip riskTier={product.risk_tier} />
        </div>
        <LifecycleBarCompact
          phase={product.lifecycle_phase}
          state={product.lifecycle_state}
          completeCount={product.lifecycle_complete_count ?? 0}
        />
      </div>
    </article>
  );
}
