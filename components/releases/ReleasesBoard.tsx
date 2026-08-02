'use client';

import {useMemo, useState} from 'react';
import Image from 'next/image';
import {CalendarDays, ListChecks, ListTodo, Plus, Search} from 'lucide-react';
import {useTranslations} from 'next-intl';

import ReleaseForm, {
  type ReleaseMemberOption,
  type ReleaseProductOption
} from '@/components/releases/ReleaseForm';
import ReleaseStatusChip from '@/components/releases/ReleaseStatusChip';
import {Link} from '@/i18n/navigation';
import {
  ACTIVE_RELEASE_STATUSES,
  type ReleaseOverview,
  type ReleaseStatus
} from '@/lib/releases';

type Scope = 'active' | 'all' | 'released';

const SCOPES: Scope[] = ['active', 'all', 'released'];

function matchesScope(release: ReleaseOverview, scope: Scope): boolean {
  if (scope === 'all') return true;
  if (scope === 'released') {
    return release.status === 'released' || release.status === 'rolled_back';
  }
  return (ACTIVE_RELEASE_STATUSES as readonly string[]).includes(
    release.status
  );
}

export default function ReleasesBoard({
  releases,
  products,
  members,
  locale,
  canCreate
}: {
  releases: ReleaseOverview[];
  products: ReleaseProductOption[];
  members: ReleaseMemberOption[];
  locale: string;
  canCreate: boolean;
}) {
  const t = useTranslations('releases');
  const [scope, setScope] = useState<Scope>('active');
  const [productId, setProductId] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return releases.filter((release) => {
      if (!matchesScope(release, scope)) return false;
      if (productId && release.product_id !== productId) return false;
      if (!needle) return true;
      return [
        release.version,
        release.name ?? '',
        release.product_name,
        release.owner_name ?? ''
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [releases, scope, productId, query]);

  const stats = useMemo(() => {
    const active = releases.filter((r) =>
      (ACTIVE_RELEASE_STATUSES as readonly string[]).includes(r.status)
    );
    return {
      active: active.length,
      overdue: releases.filter((r) => r.is_overdue).length,
      released: releases.filter((r) => r.status === 'released').length,
      // Work still open inside releases that have not shipped — the number
      // that says whether the next cycle is actually close.
      openWork: active.reduce((sum, r) => sum + r.open_task_count, 0)
    };
  }, [releases]);

  const dateFormat = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            ['active', stats.active],
            ['overdue', stats.overdue],
            ['openWork', stats.openWork],
            ['released', stats.released]
          ] as const
        ).map(([key, value]) => (
          <div
            key={key}
            className="rounded-lg border border-hairline bg-panel px-4 py-3"
          >
            <dt className="text-[10px] uppercase tracking-widest text-faint">
              {t(`stats.${key}`)}
            </dt>
            <dd
              className={`mt-1 font-mono text-xl ${
                key === 'overdue' && value > 0 ? 'text-amber' : 'text-ink'
              }`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-full rounded-md border border-hairline bg-bg py-2 pe-3 ps-9 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50"
          />
        </div>

        <select
          value={productId}
          onChange={(event) => setProductId(event.target.value)}
          className="rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none focus:border-accent/50"
        >
          <option value="">{t('allProducts')}</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>

        <div className="flex rounded-md border border-hairline p-0.5">
          {SCOPES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setScope(option)}
              className={`rounded px-2.5 py-1.5 text-xs transition-colors ${
                scope === option
                  ? 'bg-accent/10 text-accent'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {t(`scope.${option}`)}
            </button>
          ))}
        </div>

        {canCreate && products.length > 0 ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            {t('newRelease')}
          </button>
        ) : null}
      </div>

      {creating ? (
        <ReleaseForm
          products={products}
          members={members}
          onDone={() => setCreating(false)}
        />
      ) : null}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-12 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-accent">
            <ListChecks className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h3 className="mt-3 text-sm font-medium">{t('emptyTitle')}</h3>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted">
            {t('emptyBody')}
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-hairline bg-panel">
          {filtered.map((release) => {
            const target = release.target_date
              ? dateFormat.format(new Date(`${release.target_date}T00:00:00`))
              : null;

            return (
              <li
                key={release.id}
                className="border-b border-hairline last:border-0"
              >
                <Link
                  href={`/releases/${release.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-raised/35"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-hairline bg-raised font-mono text-[9px]">
                      {release.product_logo_url ? (
                        <Image
                          src={release.product_logo_url}
                          alt={release.product_name}
                          fill
                          unoptimized
                          sizes="28px"
                          className="object-cover"
                        />
                      ) : (
                        release.product_name.slice(0, 1).toUpperCase()
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-baseline gap-2">
                        <span
                          dir="ltr"
                          className="truncate font-mono text-sm font-medium text-ink"
                        >
                          {release.version}
                        </span>
                        {release.name ? (
                          <span className="truncate text-xs text-muted">
                            {release.name}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
                        <span className="truncate">{release.product_name}</span>
                        <span className="inline-flex items-center gap-1">
                          <ListChecks className="h-3 w-3" strokeWidth={1.75} />
                          {release.checks_done}/{release.checks_required}
                        </span>
                        {release.task_count > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <ListTodo className="h-3 w-3" strokeWidth={1.75} />
                            {t('openOfTotal', {
                              open: release.open_task_count,
                              total: release.task_count
                            })}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </span>

                  <span
                    className={`inline-flex items-center gap-1 font-mono text-[11px] ${
                      release.is_overdue ? 'text-amber' : 'text-muted'
                    }`}
                  >
                    <CalendarDays className="h-3 w-3" strokeWidth={1.75} />
                    {target ?? t('noTargetDate')}
                  </span>

                  <ReleaseStatusChip status={release.status as ReleaseStatus} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
