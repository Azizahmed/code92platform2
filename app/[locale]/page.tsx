import {
  AlarmClock,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  Hourglass,
  Inbox,
  Plus
} from 'lucide-react';
import {getLocale, getTranslations} from 'next-intl/server';

import AttentionList, {type AttentionRow} from '@/components/dashboard/AttentionList';
import {Sparkline, StageBars, StatusSplit, TrendChart, WorkloadChart, type StageRow} from '@/components/dashboard/charts';
import DashboardTaskList from '@/components/dashboard/DashboardTaskList';
import Reveal from '@/components/dashboard/Reveal';
import HelpTip, {type GlossaryTerm} from '@/components/ui/HelpTip';
import {Link} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';
import {BUSINESS_STAGES} from '@/lib/business-track';
import {computeDashboard, partOfDay, type DashboardTask} from '@/lib/dashboard';
import {businessDate} from '@/lib/dates';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {PROJECT_PHASES} from '@/lib/projects';
import {RELEASE_STAGES} from '@/lib/releases';

type Strips = {
  products: Record<string, number> & {gate1Pending: number; gate2Pending: number};
  releases: Record<string, number> & {overdue: number};
  projects: Record<string, number> & {stale: number};
  sales: Record<string, number> & {openValueKwd: number; closingThisMonth: number; stale: number};
};

function Card({
  title,
  help,
  action,
  className = '',
  index = 0,
  children
}: {
  title: string;
  help?: GlossaryTerm;
  action?: React.ReactNode;
  className?: string;
  index?: number;
  children: React.ReactNode;
}) {
  return (
    // min-w-0: a grid item otherwise refuses to shrink below its longest row.
    <Reveal index={index} className={`min-w-0 ${className}`}>
      <section className="flex h-full flex-col rounded-xl border border-hairline bg-panel p-4 sm:p-5">
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-1 text-sm font-medium text-ink">
            {title}
            {help ? <HelpTip term={help} /> : null}
          </h2>
          {action}
        </header>
        <div className="flex-1">{children}</div>
      </section>
    </Reveal>
  );
}

// The dashboard: how the team's work is moving, who is carrying it, what is due,
// and where every product, release, project and deal stands — as pictures first,
// with every number a link to the list behind it. Read-only.
export default async function DashboardPage() {
  const insforge = await createInsForgeServerClient();
  const [locale, {user, member}, t, {data: strips}, {data: attention}, {data: taskRows}, {data: members}, {data: products}, {data: waiting}] =
    await Promise.all([
      getLocale(),
      requireActiveMember(),
      getTranslations('dashboard'),
      insforge.database.rpc('dashboard_strips'),
      insforge.database.rpc('dashboard_attention'),
      insforge.database
        .from('product_tasks')
        .select(
          'id, title, product_id, parent_task_id, status, workflow_status, due_date, assignee_id, created_at, completed_at, completed_by, completion_note'
        )
        .order('created_at', {ascending: false})
        .limit(5000),
      insforge.database.from('team_members').select('user_id, display_name'),
      insforge.database.from('products').select('id, name'),
      insforge.database.rpc('my_waiting_on')
    ]);

  const s = (strips ?? {}) as unknown as Strips;
  const attentionRows = (attention ?? []) as unknown as AttentionRow[];
  const today = businessDate();
  const figures = computeDashboard((taskRows ?? []) as unknown as DashboardTask[], today);
  const names = Object.fromEntries(
    (members ?? []).map((row) => [row.user_id as string, row.display_name as string])
  );
  const productNames = Object.fromEntries((products ?? []).map((row) => [row.id as string, row.name as string]));
  const waitingCount = (waiting ?? []).length;
  const firstName = (member.display_name ?? '').trim().split(/\s+/)[0] ?? '';
  const dateLine = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Kuwait'
  }).format(new Date());
  const delta = figures.completedThisWeek - figures.completedLastWeek;

  const productRows: StageRow[] = BUSINESS_STAGES.map((stage) => ({
    key: stage,
    label: t(`strips.stage.${stage}`),
    value: s.products?.[stage] ?? 0,
    href: `/products?business_stage=${stage}`
  }));
  const releaseRows: StageRow[] = RELEASE_STAGES.map((stage) => ({
    key: stage,
    label: t(`strips.releaseStage.${stage}`),
    value: s.releases?.[stage] ?? 0,
    href: '/releases'
  }));
  const projectRows: StageRow[] = PROJECT_PHASES.filter((phase) => phase !== 'closed').map((phase) => ({
    key: phase,
    label: t(`strips.phase.${phase}`),
    value: s.projects?.[phase] ?? 0,
    href: `/projects?phase=${phase}`
  }));
  const salesRows: StageRow[] = (['lead', 'meeting', 'discovery_demo', 'proposal', 'negotiation'] as const).map((stage) => ({
    key: stage,
    label: t(`strips.deals.${stage}`),
    value: s.sales?.[stage] ?? 0,
    href: '/sales'
  }));

  const kpis = [
    {
      key: 'open',
      value: figures.open,
      icon: CircleDot,
      href: '/tasks',
      tone: 'text-ink',
      extra: (
        <Sparkline
          values={figures.weeks.map((week) => week.openAtEnd)}
          label={t('kpis.openTrend')}
        />
      ),
      note: t('kpis.dueThisWeek', {count: figures.dueThisWeek})
    },
    {
      key: 'completed',
      value: figures.completedThisWeek,
      icon: CheckCircle2,
      href: '/tasks?scope=completed',
      tone: 'text-ink',
      extra: null,
      note:
        delta === 0 ? (
          t('kpis.sameAsLastWeek')
        ) : (
          <span className={`inline-flex items-center gap-0.5 ${delta > 0 ? 'text-accent' : 'text-muted'}`}>
            {delta > 0 ? (
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            {t('kpis.vsLastWeek', {delta: Math.abs(delta), direction: delta > 0 ? 'up' : 'down'})}
          </span>
        )
    },
    {
      key: 'overdue',
      value: figures.overdue,
      icon: AlarmClock,
      href: '/tasks?due=overdue',
      tone: figures.overdue > 0 ? 'text-amber' : 'text-ink',
      extra: null,
      note: figures.overdue > 0 ? t('kpis.overdueNote') : t('kpis.allOnTime')
    },
    {
      key: 'waiting',
      value: waitingCount,
      icon: Hourglass,
      href: '/my-work?tab=waiting',
      tone: waitingCount > 0 ? 'text-amber' : 'text-ink',
      extra: null,
      note: waitingCount > 0 ? t('kpis.waitingNote') : t('kpis.nothingWaiting')
    }
  ] as const;

  return (
    <section className="space-y-5">
      <Reveal>
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs text-faint">{dateLine}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {t(`greeting.${partOfDay()}`, {name: firstName})}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {figures.overdue > 0
                ? t('summary.withOverdue', {open: figures.open, overdue: figures.overdue, waiting: waitingCount})
                : t('summary.calm', {open: figures.open, waiting: waitingCount})}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/my-work"
              className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-3.5 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <Inbox className="h-4 w-4" strokeWidth={1.75} />
              {t('actions.myWork')}
            </Link>
            <Link
              href="/tasks?new=1"
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              {t('actions.newTask')}
            </Link>
          </div>
        </header>
      </Reveal>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(({key, value, icon: Icon, href, tone, extra, note}, index) => (
          <Reveal key={key} index={index + 1}>
            <Link
              href={href}
              className="flex h-full flex-col justify-between gap-3 rounded-xl border border-hairline bg-panel p-4 transition-colors hover:border-accent/30"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">{t(`kpis.${key}`)}</span>
                <Icon className={`h-4 w-4 ${tone}`} strokeWidth={1.75} />
              </div>
              <div className="flex items-end justify-between gap-2">
                <span className={`text-3xl font-semibold leading-none ${tone}`}>{value}</span>
                {extra}
              </div>
              <span className="text-[11px] text-faint">{note}</span>
            </Link>
          </Reveal>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('charts.trend.title')} className="lg:col-span-2" index={5}>
          <TrendChart weeks={figures.weeks} />
        </Card>
        <Card title={t('charts.status.title')} help="taskStatus" index={6}>
          <StatusSplit byStatus={figures.byStatus} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title={t('charts.workload.title')}
          index={7}
          action={
            <Link href="/tasks?group=assignee" className="text-xs text-faint hover:text-accent">
              {t('actions.viewAll')}
            </Link>
          }
        >
          <WorkloadChart rows={figures.workload} names={names} currentUserId={user.id} />
        </Card>
        <Card
          title={t('lists.dueSoon')}
          index={8}
          action={
            <Link href="/tasks?group=due" className="text-xs text-faint hover:text-accent">
              {t('actions.viewAll')}
            </Link>
          }
        >
          <DashboardTaskList
            mode="due"
            tasks={figures.dueSoon.map((task) => ({
              ...task,
              product_name: task.product_id ? productNames[task.product_id] ?? null : null,
              person: task.assignee_id ? names[task.assignee_id] ?? null : null
            }))}
            today={today}
            empty={t('lists.nothingDue')}
          />
        </Card>
      </div>

      <div className="space-y-3">
        <h2 className="text-[11px] font-medium uppercase tracking-widest text-faint">{t('pipeline.title')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card title={t('strips.productsTitle')} help="businessStage" index={9}>
            <StageBars
              rows={productRows}
              attention={{
                label: t('strips.gatesPending'),
                value: (s.products?.gate1Pending ?? 0) + (s.products?.gate2Pending ?? 0),
                href: '/governance'
              }}
            />
          </Card>
          <Card title={t('strips.releasesTitle')} help="releaseStage" index={10}>
            <StageBars rows={releaseRows} attention={{label: t('strips.overdue'), value: s.releases?.overdue ?? 0, href: '/releases'}} />
          </Card>
          <Card title={t('strips.projectsTitle')} help="projectPhase" index={11}>
            <StageBars rows={projectRows} attention={{label: t('strips.stale'), value: s.projects?.stale ?? 0, href: '/projects?stale=1'}} />
          </Card>
          <Card title={t('strips.salesTitle')} index={12}>
            <StageBars rows={salesRows} attention={{label: t('strips.deals.stale'), value: s.sales?.stale ?? 0, href: '/sales'}} />
            <p className="mt-2 text-[11px] text-faint">
              {t('strips.salesFootnote', {
                value: Math.round(Number(s.sales?.openValueKwd ?? 0)).toLocaleString(),
                closing: s.sales?.closingThisMonth ?? 0
              })}
            </p>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('attention.title')} index={13}>
          <AttentionList rows={attentionRows} />
        </Card>
        <Card
          title={t('lists.recentlyCompleted')}
          index={14}
          action={<ClipboardCheck className="h-4 w-4 text-faint" strokeWidth={1.75} />}
        >
          <DashboardTaskList
            mode="done"
            tasks={figures.recentlyCompleted.map((task) => ({
              ...task,
              product_name: task.product_id ? productNames[task.product_id] ?? null : null,
              person: task.completed_by ? names[task.completed_by] ?? null : null
            }))}
            today={today}
            empty={t('lists.nothingCompleted')}
          />
        </Card>
      </div>
    </section>
  );
}
