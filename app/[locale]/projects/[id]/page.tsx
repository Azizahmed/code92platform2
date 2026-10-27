import {notFound} from 'next/navigation';
import {ChevronLeft} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import ProjectDeliverables, {type Deliverable} from '@/components/projects/ProjectDeliverables';
import ProjectForm from '@/components/projects/ProjectForm';
import ProjectIdeas, {type IdeaRow} from '@/components/projects/ProjectIdeas';
import ProjectLog, {type ProjectLogEntry} from '@/components/projects/ProjectLog';
import ProjectPhaseChip from '@/components/projects/ProjectPhaseChip';
import ProjectPhaseStepper from '@/components/projects/ProjectPhaseStepper';
import ProjectTasks, {type ProjectTaskRow} from '@/components/projects/ProjectTasks';
import ProjectTeam, {type TeamOption} from '@/components/projects/ProjectTeam';
import RelativeTime from '@/components/RelativeTime';
import WatchButton from '@/components/watch/WatchButton';
import {Link} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';
import {setProjectWatchingAction} from '@/lib/actions/projects';
import {businessDate} from '@/lib/dates';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {isProjectPhase, PROJECT_STALE_DAYS, type ProjectOverview} from '@/lib/projects';

export default async function ProjectDetailPage({
  params
}: {
  params: Promise<{locale: string; id: string}>;
}) {
  const {locale, id} = await params;
  const {user, member} = await requireActiveMember();
  const t = await getTranslations('projects');
  const insforge = await createInsForgeServerClient();

  const {data: overviewRow} = await insforge.database
    .from('project_overview')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!overviewRow) notFound();
  const project = overviewRow as unknown as ProjectOverview;

  const [
    {data: activities},
    {data: memberRows},
    {data: members},
    {data: watching},
    {data: tasks},
    {data: deliverables},
    {data: knowledge},
    {data: ideas}
  ] = await Promise.all([
    insforge.database
      .from('project_activities')
      .select('id, kind, from_phase, to_phase, body, meta, actor_id, created_at')
      .eq('project_id', id)
      .order('created_at', {ascending: false})
      .limit(100),
    insforge.database.from('project_members').select('user_id').eq('project_id', id),
    insforge.database.from('team_members').select('user_id, display_name').eq('is_active', true).order('display_name'),
    insforge.database.from('project_watchers').select('user_id').eq('project_id', id).eq('user_id', user.id),
    insforge.database
      .from('product_tasks')
      .select('id, title, status, due_date, assignee_id')
      .eq('project_id', id)
      .order('created_at', {ascending: true}),
    insforge.database
      .from('knowledge_item_projects')
      .select('knowledge_items(id, title, archived_at)')
      .eq('project_id', id),
    insforge.database.from('knowledge_items').select('id, title').is('archived_at', null).order('title').limit(300),
    insforge.database
      .from('project_products')
      .select('products(id, name, business_stage)')
      .eq('project_id', id)
  ]);

  const {data: notesRow} = await insforge.database
    .from('projects')
    .select('notes')
    .eq('id', id)
    .maybeSingle();

  const names = new Map((members ?? []).map((m) => [m.user_id as string, m.display_name as string]));
  const teamOptions: TeamOption[] = (members ?? []).map((m) => ({id: m.user_id as string, name: m.display_name as string}));
  const isOwner = project.owner_id === user.id;
  const canEdit = isOwner || member.role === 'admin' || (memberRows ?? []).some((row) => row.user_id === user.id);
  const isOpen = project.is_open;
  const phase = isProjectPhase(project.phase) ? project.phase : 'kickoff';

  const log: ProjectLogEntry[] = ((activities ?? []) as unknown as {
    id: string;
    kind: ProjectLogEntry['kind'];
    from_phase: string | null;
    to_phase: string | null;
    body: string | null;
    meta: Record<string, unknown> | null;
    actor_id: string | null;
    created_at: string;
  }[]).map((row) => ({
    id: row.id,
    kind: row.kind,
    from_phase: row.from_phase,
    to_phase: row.to_phase,
    body: row.body,
    meta: row.meta,
    actor_name: row.actor_id ? names.get(row.actor_id) ?? null : null,
    created_at: row.created_at
  }));

  const linked: Deliverable[] = ((deliverables ?? []) as unknown as {
    knowledge_items: {id: string; title: string; archived_at: string | null} | null;
  }[])
    .map((row) => row.knowledge_items)
    .filter((item): item is {id: string; title: string; archived_at: string | null} => item !== null && item.archived_at === null)
    .map((item) => ({id: item.id, title: item.title}));

  const taskRows: ProjectTaskRow[] = ((tasks ?? []) as unknown as {
    id: string;
    title: string;
    status: 'pending' | 'completed';
    due_date: string | null;
    assignee_id: string | null;
  }[]).map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    due_date: row.due_date,
    assignee_name: row.assignee_id ? names.get(row.assignee_id) ?? null : null
  }));

  const ideaRows: IdeaRow[] = ((ideas ?? []) as unknown as {
    products: {id: string; name: string; business_stage: string} | null;
  }[])
    .map((row) => row.products)
    .filter((item): item is {id: string; name: string; business_stage: string} => item !== null)
    .map((item) => ({id: item.id, name: item.name, business_stage: item.business_stage}));

  const memberRowsOut: TeamOption[] = (memberRows ?? []).map((row) => ({
    id: row.user_id as string,
    name: names.get(row.user_id as string) ?? '—'
  }));

  const dateFormat = new Intl.DateTimeFormat(locale, {year: 'numeric', month: 'short', day: 'numeric'});
  const today = businessDate();

  return (
    <section className="space-y-6">
      <Link href="/projects" className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-ink">
        <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2} />
        {t('detail.back')}
      </Link>

      <header className="space-y-5 rounded-lg border border-hairline bg-panel p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold">{project.name}</h1>
              <ProjectPhaseChip phase={phase} />
              {project.is_stale ? (
                <span className="rounded border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber">
                  {t('list.stale')}
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted">
              <Link href={`/sales/accounts/${project.account_id}`} className="hover:text-accent">
                {project.account_name}
              </Link>
              {project.deal_id ? (
                <>
                  {' · '}
                  <Link href={`/sales/deals/${project.deal_id}`} className="hover:text-accent">
                    {t('detail.fromDeal')}
                  </Link>
                </>
              ) : null}
              {project.channel_id ? (
                <>
                  {' · '}
                  <Link href={`/channels/${project.channel_id}`} className="hover:text-accent">
                    {t('detail.room')}
                  </Link>
                </>
              ) : null}
            </p>
          </div>
          <WatchButton
            watching={(watching ?? []).length > 0}
            action={setProjectWatchingAction.bind(null, project.id)}
            labels={{watch: t('watch.watch'), watching: t('watch.watching')}}
          />
        </div>

        <ProjectPhaseStepper projectId={project.id} phase={phase} canManage={canEdit} />

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-hairline pt-5 sm:grid-cols-4">
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">{t('detail.owner')}</dt>
            <dd className="mt-1 text-sm">{project.owner_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">{t('detail.start')}</dt>
            <dd className="mt-1 text-sm">{dateFormat.format(new Date(`${project.start_date}T00:00:00`))}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">{t('detail.target')}</dt>
            <dd className="mt-1 text-sm">
              {project.target_end_date ? dateFormat.format(new Date(`${project.target_end_date}T00:00:00`)) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">{t('detail.activity')}</dt>
            <dd className="mt-1 text-sm">
              <RelativeTime date={project.last_activity_at} />
              <span className="block text-[10px] text-faint">{t('detail.staleAfter', {days: PROJECT_STALE_DAYS})}</span>
            </dd>
          </div>
        </dl>

        {project.outcome_note && !isOpen ? (
          <div className="rounded-md border border-hairline bg-raised/40 p-3">
            <p className="text-[10px] uppercase tracking-widest text-faint">{t('detail.outcome')}</p>
            <p className="mt-1 whitespace-pre-line text-sm text-muted">{project.outcome_note}</p>
          </div>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="space-y-3 rounded-lg border border-hairline bg-panel p-4">
            <h2 className="text-sm font-medium">{t('deliverables.title')}</h2>
            <ProjectDeliverables
              projectId={project.id}
              linked={linked}
              options={(knowledge ?? []).map((row) => ({id: row.id as string, title: row.title as string}))}
              canEdit={canEdit && isOpen}
            />
          </section>

          <section className="space-y-3 rounded-lg border border-hairline bg-panel p-4">
            <h2 className="text-sm font-medium">{t('tasks.title')}</h2>
            <ProjectTasks projectId={project.id} tasks={taskRows} canEdit={canEdit && isOpen} />
          </section>

          <section className="space-y-3 rounded-lg border border-hairline bg-panel p-4">
            <h2 className="text-sm font-medium">{t('ideas.title')}</h2>
            <ProjectIdeas projectId={project.id} ideas={ideaRows} canCapture={canEdit && isOpen} />
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-3 rounded-lg border border-hairline bg-panel p-4">
            <h2 className="text-sm font-medium">{t('team.title')}</h2>
            <ProjectTeam projectId={project.id} members={memberRowsOut} options={teamOptions} canEdit={canEdit} />
          </section>

          <section className="space-y-3 rounded-lg border border-hairline bg-panel p-4">
            <h2 className="text-sm font-medium">{t('log.title')}</h2>
            <ProjectLog projectId={project.id} entries={log} canWrite={canEdit} />
          </section>
        </div>
      </div>

      {canEdit ? (
        <details className="rounded-lg border border-hairline bg-panel p-4">
          <summary className="cursor-pointer text-sm font-medium">{t('detail.edit')}</summary>
          <div className="mt-4">
            <ProjectForm
              mode="edit"
              projectId={project.id}
              members={teamOptions}
              initial={{
                name: project.name,
                ownerId: project.owner_id,
                startDate: project.start_date,
                targetEndDate: project.target_end_date ?? '',
                ownership: project.ownership ?? '',
                notes: (notesRow?.notes as string | null) ?? ''
              }}
              today={today}
            />
          </div>
        </details>
      ) : null}
    </section>
  );
}
