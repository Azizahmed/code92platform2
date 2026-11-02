import {notFound} from 'next/navigation';
import {ChevronLeft, TriangleAlert} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import ReleaseChecklist from '@/components/releases/ReleaseChecklist';
import ReleaseEditButton from '@/components/releases/ReleaseEditButton';
import ReleaseScopePanel, {type ScopeTask} from '@/components/releases/ReleaseScopePanel';
import ReleaseStagePanel from '@/components/releases/ReleaseStagePanel';
import ReleaseStatusChip from '@/components/releases/ReleaseStatusChip';
import ReleaseStatusControl from '@/components/releases/ReleaseStatusControl';
import StageArtifacts from '@/components/releases/StageArtifacts';
import {SpecApproval, TestResult} from '@/components/releases/ApprovalAndTest';
import RelativeTime from '@/components/RelativeTime';
import RiskTierChip from '@/components/risk/RiskTierChip';
import {Link} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {
  ARTIFACT_KEYS,
  ARTIFACT_STAGE,
  canManageRelease,
  gapLabelKey,
  releaseKind,
  RELEASE_STAGES,
  type ArtifactKey,
  type ReleaseArtifact,
  type ReleaseCheck,
  type ReleaseOverview,
  type ReleaseStage,
  type ReleaseTransition
} from '@/lib/releases';
import {isWaivableGap} from '@/lib/releases';

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

  const [{data: artifacts}, {data: requirements}, {data: checks}, {data: transitions}, {data: tasks}, {data: members}, {data: gaps}] =
    await Promise.all([
      insforge.database.from('release_artifacts').select('*').eq('release_id', id).order('created_at', {ascending: true}),
      insforge.database.from('release_artifact_requirements').select('artifact_key, is_required').eq('release_id', id),
      insforge.database
        .from('release_checks')
        .select('id, release_id, check_key, is_required, completed_at, completed_by, note')
        .eq('release_id', id)
        .order('check_key'),
      insforge.database.from('release_transitions').select('*').eq('release_id', id).order('created_at', {ascending: false}).limit(80),
      insforge.database
        .from('product_tasks')
        .select('id, title, status, assignee_id, due_date, release_id')
        .eq('product_id', release.product_id)
        .order('created_at', {ascending: true}),
      insforge.database.from('team_members').select('user_id, display_name').eq('is_active', true).order('display_name'),
      insforge.database.rpc('release_stage_gaps', {p_release_id: id})
    ]);

  const memberNames = new Map((members ?? []).map((row) => [row.user_id as string, row.display_name as string]));
  const memberOptions = (members ?? []).map((row) => ({
    userId: row.user_id as string,
    displayName: row.display_name as string
  }));

  const allArtifacts = (artifacts ?? []) as unknown as ReleaseArtifact[];
  const required = new Set(
    ((requirements ?? []) as {artifact_key: ArtifactKey; is_required: boolean}[])
      .filter((row) => row.is_required)
      .map((row) => row.artifact_key)
  );
  const filed: Record<ReleaseStage, {filed: number; required: number}> = Object.fromEntries(
    RELEASE_STAGES.map((stage) => {
      const keys = ARTIFACT_KEYS.filter((key) => ARTIFACT_STAGE[key] === stage && required.has(key));
      const done = keys.filter((key) => allArtifacts.some((a) => a.artifact_key === key)).length;
      return [stage, {filed: done, required: keys.length}];
    })
  ) as Record<ReleaseStage, {filed: number; required: number}>;

  const isAdmin = member.role === 'admin';
  const canManage = canManageRelease({
    riskTier: release.risk_tier,
    isOwner: release.owner_id === user.id,
    isAdmin,
    isArchived: release.product_archived_at !== null
  });
  const stageGaps = ((gaps ?? []) as string[]).filter(Boolean);
  const requiredHere = ARTIFACT_KEYS.filter(
    (key) => ARTIFACT_STAGE[key] === release.stage && required.has(key)
  ) as ArtifactKey[];
  const optionalHere = ARTIFACT_KEYS.filter(
    (key) => ARTIFACT_STAGE[key] === release.stage && !required.has(key)
  ) as ArtifactKey[];

  const toScopeTask = (row: Record<string, unknown>): ScopeTask => ({
    id: row.id as string,
    title: row.title as string,
    status: row.status as ScopeTask['status'],
    assignee_name: row.assignee_id ? memberNames.get(row.assignee_id as string) ?? null : null,
    due_date: (row.due_date as string | null) ?? null
  });
  const allTasks = (tasks ?? []) as unknown as Record<string, unknown>[];
  const scoped = allTasks.filter((row) => row.release_id === id).map(toScopeTask);
  const available = allTasks
    .filter((row) => row.release_id === null && row.status !== 'completed')
    .map(toScopeTask);

  const dateFormat = new Intl.DateTimeFormat(locale, {year: 'numeric', month: 'short', day: 'numeric'});
  const kind = releaseKind(release.release_number);
  const checkRows = (checks ?? []) as unknown as ReleaseCheck[];
  const log = (transitions ?? []) as unknown as ReleaseTransition[];
  const edited = {
    version: release.version,
    name: release.name ?? '',
    goal: release.goal ?? '',
    successCriteria: release.success_criteria ?? '',
    notes: release.notes ?? '',
    targetDate: release.target_date ?? '',
    ownerId: release.owner_id ?? '',
    riskTier: release.risk_tier
  };

  return (
    <section className="space-y-6">
      <Link href="/releases" className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-ink">
        <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={1.75} />
        {t('backToReleases')}
      </Link>

      <header className="space-y-4 rounded-lg border border-hairline bg-panel p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 dir="ltr" className="font-mono text-xl font-semibold">{release.version}</h1>
              <span className="rounded border border-hairline bg-raised px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted">
                {t(`kind.${kind}`)}
              </span>
              <ReleaseStatusChip status={release.status} />
              <RiskTierChip riskTier={release.risk_tier} />
              {release.is_overdue ? (
                <span className="inline-flex items-center gap-1 rounded border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-danger">
                  <TriangleAlert className="h-3 w-3" strokeWidth={2} />
                  {t('overdue')}
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted">
              <Link href={`/products/${release.product_id}`} className="hover:text-accent">{release.product_name}</Link>
              {release.name ? <span> · {release.name}</span> : null}
            </p>
            {release.goal ? <p className="text-sm text-ink">{release.goal}</p> : <p className="text-xs text-faint">{t('panel.noGoal')}</p>}
          </div>
          {canManage ? (
            <ReleaseEditButton releaseId={id} initial={edited} members={memberOptions} isAdmin={isAdmin} />
          ) : null}
        </div>

        {release.success_criteria ? (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-faint">{t('form.successCriteria')}</p>
            <p className="mt-1 whitespace-pre-line text-sm text-muted">{release.success_criteria}</p>
          </div>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-hairline pt-5 sm:grid-cols-4">
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">{t('form.owner')}</dt>
            <dd className="mt-1 text-sm">{release.owner_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">{t('form.targetDate')}</dt>
            <dd className="mt-1 text-sm">
              {release.target_date ? dateFormat.format(new Date(`${release.target_date}T00:00:00`)) : t('noTargetDate')}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">{t('releasedAt')}</dt>
            <dd className="mt-1 text-sm">{release.released_at ? <RelativeTime date={release.released_at} /> : '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">{t('stageLabel')}</dt>
            <dd className="mt-1 text-sm">{t(`stage.${release.stage}`)}</dd>
          </div>
        </dl>
      </header>

      <ReleaseStagePanel
        releaseId={id}
        version={release.version}
        stage={release.stage}
        riskTier={release.risk_tier}
        isAdmin={isAdmin}
        canManage={canManage}
        gaps={stageGaps}
        filed={filed}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="space-y-3 rounded-lg border border-hairline bg-panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium">{t('evidence.title', {stage: t(`stage.${release.stage}`)})}</h2>
              <p className="text-[11px] text-faint">
                {t('evidence.required', {keys: requiredHere.map((key) => t(`artifacts.${key}`)).join(', ') || t('evidence.none')})}
              </p>
            </div>
            <StageArtifacts
              releaseId={id}
              currentStage={release.stage}
              stage={release.stage}
              artifacts={allArtifacts.filter((a) => a.stage === release.stage)}
              required={[...requiredHere, ...optionalHere]}
              canManage={canManage}
            />
          </section>

          {release.stage === 'design' ? (
            <SpecApproval
              releaseId={id}
              approvedAt={release.spec_approved_at}
              selfApproved={release.spec_self_approved}
              canManage={canManage}
            />
          ) : null}

          {release.stage === 'test' ? (
            <TestResult
              releaseId={id}
              result={release.test_result}
              findingsOpen={release.findings_open}
              findingsClosed={release.findings_closed}
              canManage={canManage}
            />
          ) : null}

          {release.stage === 'deploy' || release.stage === 'maintain' ? (
            <ReleaseChecklist releaseId={id} checks={checkRows} status={release.status} canManage={canManage} />
          ) : null}

          <ReleaseScopePanel
            releaseId={id}
            productId={release.product_id}
            scoped={scoped}
            available={available}
            canManage={canManage}
          />

          <section className="space-y-3">
            <h2 className="text-sm font-medium">{t('evidence.earlier')}</h2>
            {RELEASE_STAGES.filter((stage) => stage !== release.stage).map((stage) => {
              const items = allArtifacts.filter((a) => a.stage === stage);
              return (
                <details key={stage} className="rounded-lg border border-hairline bg-panel">
                  <summary className="cursor-pointer px-4 py-3 text-xs">
                    {t(`stage.${stage}`)} · {t('evidence.count', {count: items.length})}
                  </summary>
                  <div className="border-t border-hairline p-4">
                    <StageArtifacts
                      releaseId={id}
                      currentStage={release.stage}
                      stage={stage}
                      artifacts={items}
                      required={[]}
                      canManage={false}
                    />
                  </div>
                </details>
              );
            })}
          </section>
        </div>

        <div className="space-y-6">
          <ReleaseStatusControl releaseId={id} status={release.status} canManage={canManage} />

          {stageGaps.some((gap) => isWaivableGap(gap)) && release.stage === 'deploy' ? (
            <p className="rounded-lg border border-amber/25 bg-amber/5 p-3 text-[11px] text-amber">
              {t('gap.waivableNote')}
            </p>
          ) : null}

          <section className="space-y-3 rounded-lg border border-hairline bg-panel p-4">
            <h2 className="text-sm font-medium">{t('history.title')}</h2>
            {log.length === 0 ? (
              <p className="text-xs text-faint">{t('history.empty')}</p>
            ) : (
              <ol className="space-y-3">
                {log.map((entry) => (
                  <li key={entry.id} className="space-y-0.5 border-s-2 border-hairline ps-3 text-xs">
                    <p className="text-ink">{describeTransition(entry, t)}</p>
                    <p className="text-faint">
                      {memberNames.get(entry.actor_id) ?? '—'} · <RelativeTime date={entry.created_at} />
                    </p>
                    {entry.note ? <p className="whitespace-pre-line text-muted">{entry.note}</p> : null}
                    {entry.waiver_reason ? (
                      <p className="text-amber">{t('history.waiver', {reason: entry.waiver_reason})}</p>
                    ) : null}
                    {entry.missing_checks.length > 0 || entry.missing_artifacts.length > 0 ? (
                      <p className="text-[10px] text-faint">
                        {t('history.missing', {
                          items: [...entry.missing_artifacts, ...entry.missing_checks]
                            .map((gap) => t(`gap.${gapLabelKey(gap)}`))
                            .join(', ')
                        })}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}

function describeTransition(
  entry: ReleaseTransition,
  t: (key: string, values?: Record<string, string>) => string
): string {
  if (entry.from_stage && entry.to_stage && entry.from_stage === entry.to_stage) {
    return t('history.approval');
  }
  if (entry.from_stage && entry.to_stage) {
    return t('history.stage', {
      from: t(`stage.${entry.from_stage}`),
      to: t(`stage.${entry.to_stage}`)
    });
  }
  return t('history.status', {
    from: entry.from_status ? t(`status.${entry.from_status}`) : '—',
    to: t(`status.${entry.to_status}`)
  });
}
