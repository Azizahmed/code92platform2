import {notFound} from 'next/navigation';
import {CalendarDays, ChevronLeft, TriangleAlert, UserRound} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import ReleaseChecklist from '@/components/releases/ReleaseChecklist';
import ReleaseHeaderActions from '@/components/releases/ReleaseHeaderActions';
import ReleaseScopePanel, {
  type ScopeTask
} from '@/components/releases/ReleaseScopePanel';
import ReleaseStatusChip from '@/components/releases/ReleaseStatusChip';
import ReleaseStatusControl from '@/components/releases/ReleaseStatusControl';
import RelativeTime from '@/components/RelativeTime';
import RiskTierChip from '@/components/lifecycle/RiskTierChip';
import {Link} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {
  canManageRelease,
  OPEN_TASKS_GAP,
  type ReleaseCheck,
  type ReleaseOverview,
  type ReleaseTransition
} from '@/lib/releases';

export default async function ReleaseDetailPage({
  params
}: {
  params: Promise<{locale: string; id: string}>;
}) {
  const {locale, id} = await params;
  const {user, member} = await requireActiveMember();
  const t = await getTranslations('releases');
  const insforge = await createInsForgeServerClient();

  const {data: releaseRow} = await insforge.database
    .from('release_overview')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!releaseRow) notFound();
  const release = releaseRow as unknown as ReleaseOverview;

  const [{data: checks}, {data: transitions}, {data: tasks}, {data: members}] =
    await Promise.all([
      insforge.database
        .from('release_checks')
        .select(
          'id, release_id, check_key, is_required, completed_at, completed_by, note'
        )
        .eq('release_id', id)
        .order('check_key'),
      insforge.database
        .from('release_transitions')
        .select('*')
        .eq('release_id', id)
        .order('created_at', {ascending: false}),
      // Every task on the product, split below into "in this release" and
      // "could be". One query rather than two, since the page needs both.
      insforge.database
        .from('product_tasks')
        .select('id, title, status, assignee_id, due_date, release_id')
        .eq('product_id', release.product_id)
        .order('created_at', {ascending: true}),
      insforge.database
        .from('team_members')
        .select('user_id, display_name')
        .eq('is_active', true)
        .order('display_name')
    ]);

  const memberNames = new Map(
    (members ?? []).map((row) => [
      row.user_id as string,
      row.display_name as string
    ])
  );

  const toScopeTask = (row: Record<string, unknown>): ScopeTask => ({
    id: row.id as string,
    title: row.title as string,
    status: row.status as ScopeTask['status'],
    assignee_name: row.assignee_id
      ? memberNames.get(row.assignee_id as string) ?? null
      : null,
    due_date: (row.due_date as string | null) ?? null
  });

  const allTasks = (tasks ?? []) as unknown as Record<string, unknown>[];
  const scoped = allTasks
    .filter((row) => row.release_id === id)
    .map(toScopeTask);
  // Only unscoped work is offered: a task belongs to one release at a time, and
  // silently stealing it from another release's scope would break that one's
  // gate without telling anybody.
  const available = allTasks
    .filter((row) => row.release_id === null && row.status !== 'completed')
    .map(toScopeTask);

  const isAdmin = member.role === 'admin';
  const canManage = canManageRelease({
    riskTier: release.risk_tier,
    isOwner: release.owner_id === user.id,
    isAdmin,
    isArchived: release.product_archived_at !== null
  });

  const dateFormat = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  const targetDate = release.target_date
    ? dateFormat.format(new Date(`${release.target_date}T00:00:00`))
    : null;

  const memberOptions = (members ?? []).map((row) => ({
    userId: row.user_id as string,
    displayName: row.display_name as string
  }));

  return (
    <section className="space-y-6">
      <Link
        href="/releases"
        className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-accent"
      >
        <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={1.75} />
        {t('backToReleases')}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 dir="ltr" className="font-mono text-xl font-semibold">
              {release.version}
            </h1>
            <ReleaseStatusChip status={release.status} />
            <RiskTierChip riskTier={release.risk_tier} />
          </div>
          {release.name ? (
            <p className="mt-1 text-sm text-muted">{release.name}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-faint">
            <Link
              href={`/products/${release.product_id}`}
              className="transition-colors hover:text-accent"
            >
              {release.product_name}
            </Link>
            <span
              className={`inline-flex items-center gap-1 ${
                release.is_overdue ? 'text-amber' : ''
              }`}
            >
              <CalendarDays className="h-3 w-3" strokeWidth={1.75} />
              {targetDate ?? t('noTargetDate')}
              {release.is_overdue ? (
                <span className="rounded border border-amber/30 bg-amber/10 px-1 py-0.5 text-[9px] uppercase tracking-wider">
                  {t('overdue')}
                </span>
              ) : null}
            </span>
            <span className="inline-flex items-center gap-1">
              <UserRound className="h-3 w-3" strokeWidth={1.75} />
              {release.owner_name ?? t('form.noOwner')}
            </span>
            {release.released_at ? (
              <span className="inline-flex items-center gap-1">
                {t('releasedAt')}
                <RelativeTime date={release.released_at} />
              </span>
            ) : null}
          </div>
        </div>

        {canManage ? (
          <ReleaseHeaderActions release={release} members={memberOptions} />
        ) : null}
      </header>

      {release.notes ? (
        <p className="whitespace-pre-wrap rounded-lg border border-hairline bg-panel p-4 text-sm leading-relaxed text-muted">
          {release.notes}
        </p>
      ) : null}

      <ReleaseStatusControl
        releaseId={release.id}
        status={release.status}
        riskTier={release.risk_tier}
        checks={(checks ?? []) as unknown as ReleaseCheck[]}
        openTaskCount={release.open_task_count}
        canManage={canManage}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <ReleaseChecklist
          releaseId={release.id}
          checks={(checks ?? []) as unknown as ReleaseCheck[]}
          status={release.status}
          canManage={canManage}
        />

        <ReleaseScopePanel
          releaseId={release.id}
          productId={release.product_id}
          scoped={scoped}
          available={available}
          canManage={canManage}
        />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t('history.title')}</h2>
        {(transitions ?? []).length === 0 ? (
          <p className="rounded-lg border border-dashed border-hairline bg-panel/50 px-4 py-6 text-center text-xs text-muted">
            {t('history.empty')}
          </p>
        ) : (
          <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-panel">
            {((transitions ?? []) as unknown as ReleaseTransition[]).map(
              (entry) => (
                <li key={entry.id} className="space-y-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="text-ink">
                      {entry.from_status
                        ? t('history.moved', {
                            from: t(`status.${entry.from_status}`),
                            to: t(`status.${entry.to_status}`)
                          })
                        : t(`status.${entry.to_status}`)}
                    </span>
                    <span className="text-faint">
                      {memberNames.get(entry.actor_id) ?? t('history.someone')}
                    </span>
                    <RelativeTime date={entry.created_at} />
                    {entry.self_approved ? (
                      <span className="rounded border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber">
                        {t('history.selfApproved')}
                      </span>
                    ) : null}
                  </div>

                  {entry.missing_checks.length > 0 ? (
                    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-amber">
                      <TriangleAlert className="h-3 w-3" strokeWidth={1.75} />
                      {t('history.gaps', {
                        gaps: entry.missing_checks
                          .map((key) =>
                            key === OPEN_TASKS_GAP
                              ? t('history.openTasksGap')
                              : t(`checks.${key}.label`)
                          )
                          .join(', ')
                      })}
                    </p>
                  ) : null}

                  {entry.waiver_reason ? (
                    <p className="rounded-md border border-hairline bg-bg/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
                      <span className="font-medium text-ink">
                        {t('history.waiver')}
                      </span>{' '}
                      {entry.waiver_reason}
                    </p>
                  ) : null}
                </li>
              )
            )}
          </ul>
        )}
      </section>
    </section>
  );
}
