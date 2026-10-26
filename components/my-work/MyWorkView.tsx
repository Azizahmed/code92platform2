'use client';

import {
  AlarmClock,
  CalendarDays,
  CheckCircle2,
  Circle,
  CircleDot,
  Columns3,
  Hourglass,
  List
} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useEffect, useMemo, useState} from 'react';

import KanbanBoard from '@/components/kanban/KanbanBoard';
import QuickCapture from '@/components/my-work/QuickCapture';
import TaskCard from '@/components/my-work/TaskCard';
import TaskEditorDialog from '@/components/tasks/TaskEditorDialog';
import TaskListView from '@/components/my-work/TaskListView';
import WaitingList from '@/components/my-work/WaitingList';
import {setTaskWorkflowStatusAction} from '@/lib/actions/my-work';
import type {ProductTask} from '@/lib/actions/tasks';
import {useRouter} from '@/i18n/navigation';
import {dueState} from '@/lib/dates';
import {
  WORKFLOW_STATUSES,
  applyWorkflowMove,
  type MyTask,
  type WorkflowStatus
} from '@/lib/my-work';
import {useServerAction} from '@/lib/use-server-action';

export type WaitingSource =
  | 'gate_ready'
  | 'proposal_pending'
  | 'review_overdue'
  | 'mention_unreplied'
  | 'deal_stale'
  | 'deal_closing';

// Row of public.my_waiting_on().
export type WaitingItem = {
  source: WaitingSource;
  record_id: string;
  context_id: string | null;
  title: string;
  subtitle: string | null;
  due_on: string | null;
};

// A task row with everything the shared TaskEditorDialog needs, plus the
// workflow column and display names.
export type MyWorkTask = MyTask & ProductTask;

export type Option = {id: string; name: string};
export type MemberOption = {userId: string; displayName: string};

type Tab = 'assigned' | 'waiting';
type View = 'list' | 'kanban';

const VIEW_STORAGE_KEY = 'code92-my-work-view';

const COLUMN_DOTS: Record<WorkflowStatus, string> = {
  todo: 'bg-faint',
  in_progress: 'bg-accent',
  blocked: 'bg-danger',
  done: 'bg-muted'
};

export default function MyWorkView({
  initialTab,
  tasks,
  waiting,
  products,
  members,
  today,
  locale
}: {
  initialTab: Tab;
  tasks: MyWorkTask[];
  waiting: WaitingItem[];
  products: Option[];
  members: MemberOption[];
  today: string;
  locale: string;
}) {
  const t = useTranslations('myWork');
  const tTasks = useTranslations('tasks');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [view, setView] = useState<View>('list');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MyWorkTask | null>(null);
  const router = useRouter();
  const [, run] = useServerAction();
  // Optimistic kanban moves, kept until the server's fresh render arrives.
  const [moves, setMoves] = useState<Record<string, WorkflowStatus>>({});
  useEffect(() => setMoves({}), [tasks]);
  const optimisticTasks = useMemo(
    () =>
      Object.entries(moves).reduce(
        (list, [taskId, status]) => applyWorkflowMove(list, {taskId, status}),
        tasks
      ),
    [tasks, moves]
  );

  // Remembered per browser; storage can be unavailable (private mode).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      if (saved === 'list' || saved === 'kanban') setView(saved);
    } catch {}
  }, []);

  function chooseView(next: View) {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {}
  }

  function chooseTab(next: Tab) {
    setTab(next);
    // Keep the tab shareable without a server round trip.
    const url = new URL(window.location.href);
    if (next === 'assigned') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  }

  function closeEditor() {
    setEditing(null);
    // The shared task actions revalidate product and task pages, not this one.
    // Deferred a tick: the editor calls onDone from inside its own async
    // transition, and a refresh started there is entangled with it and can
    // be dropped (see lib/use-server-action.ts).
    setTimeout(() => router.refresh(), 0);
  }

  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditing(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  function move(task: MyWorkTask, status: WorkflowStatus) {
    setError(null);
    setMoves((current) => ({...current, [task.id]: status}));
    void run(async () => {
      const result = await setTaskWorkflowStatusAction(task.id, status);
      if (!result.ok) {
        setError(result.error);
        setMoves((current) => {
          const next = {...current};
          delete next[task.id];
          return next;
        });
      }
    });
  }

  const open = optimisticTasks.filter((task) => task.status === 'pending');
  const overdue = open.filter((task) => dueState(task.due_date, today) === 'overdue').length;
  const dueToday = open.filter((task) => dueState(task.due_date, today) === 'today').length;
  const doneRecently = optimisticTasks.length - open.length;

  const counters = [
    {key: 'overdue', value: overdue, icon: AlarmClock, tone: overdue > 0 ? 'text-amber' : 'text-ink'},
    {key: 'dueToday', value: dueToday, icon: CalendarDays, tone: dueToday > 0 ? 'text-accent' : 'text-ink'},
    {key: 'open', value: open.length, icon: Circle, tone: 'text-ink'},
    {key: 'waiting', value: waiting.length, icon: Hourglass, tone: waiting.length > 0 ? 'text-amber' : 'text-ink'}
  ] as const;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {counters.map(({key, value, icon: Icon, tone}) => (
          <div key={key} className="rounded-lg border border-hairline bg-panel px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] uppercase tracking-widest text-faint">
                {t(`counters.${key}`)}
              </span>
              <Icon className={`h-4 w-4 ${tone}`} strokeWidth={1.75} />
            </div>
            <div className={`mt-2 font-mono text-2xl font-medium ${tone}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline">
        <div role="tablist" aria-label={t('title')} className="-mb-px flex gap-1">
          {(['assigned', 'waiting'] as Tab[]).map((value) => {
            const count = value === 'assigned' ? open.length : waiting.length;
            const selected = tab === value;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => chooseTab(value)}
                className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors ${
                  selected
                    ? 'border-accent text-ink'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {t(`tabs.${value}`)}
                <span
                  className={`rounded px-1.5 font-mono text-[10px] ${
                    value === 'waiting' && count > 0
                      ? 'bg-amber/10 text-amber'
                      : 'bg-raised text-faint'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {tab === 'assigned' ? (
          <div className="mb-2 flex items-center gap-1 rounded-md border border-hairline bg-bg p-1">
            {(
              [
                {value: 'list', icon: List},
                {value: 'kanban', icon: Columns3}
              ] as const
            ).map(({value, icon: Icon}) => (
              <button
                key={value}
                type="button"
                onClick={() => chooseView(value)}
                aria-pressed={view === value}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
                  view === value ? 'bg-raised text-ink' : 'text-faint hover:text-muted'
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t(`views.${value}`)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      {dialogError ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {tTasks(`errors.${dialogError}`)}
        </p>
      ) : null}

      {tab === 'waiting' ? (
        <WaitingList items={waiting} today={today} locale={locale} />
      ) : (
        <div className="space-y-4">
          <QuickCapture products={products} />

          {optimisticTasks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-14 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-accent">
                <CheckCircle2 className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <h2 className="mt-3 text-sm font-medium">{t('empty.assignedTitle')}</h2>
              <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted">
                {t('empty.assignedBody')}
              </p>
            </div>
          ) : view === 'kanban' ? (
            <KanbanBoard
              columns={WORKFLOW_STATUSES.map((status) => ({
                id: status,
                label: t(`status.${status}`),
                dot: COLUMN_DOTS[status],
                footer:
                  status === 'done' && doneRecently > 0 ? (
                    <span className="text-[10px] text-faint">{t('kanban.doneWindow')}</span>
                  ) : undefined
              }))}
              items={optimisticTasks}
              getId={(task) => task.id}
              getColumn={(task) => task.workflow_status}
              onMove={move}
              emptyLabel={t('empty.column')}
              instructions={t('kanban.instructions')}
              renderCard={(task) => (
                <TaskCard task={task} today={today} locale={locale} onEdit={() => setEditing(task)} />
              )}
            />
          ) : (
            <TaskListView
              tasks={optimisticTasks}
              today={today}
              locale={locale}
              onToggle={(task) => move(task, task.status === 'completed' ? 'todo' : 'done')}
              onEdit={setEditing}
            />
          )}

          <p className="flex items-center gap-1.5 text-[11px] text-faint">
            <CircleDot className="h-3 w-3" strokeWidth={1.75} />
            {t('assignedHint')}
          </p>
        </div>
      )}

      {editing ? (
        // The shared editor is an inline form on the task pages; here it is
        // opened from a card anywhere on a long page, so it sits in a modal.
        <div
          role="dialog"
          aria-modal="true"
          aria-label={tTasks('form.editTitle')}
          className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center"
        >
          <button
            type="button"
            aria-label={tTasks('form.cancel')}
            onClick={closeEditor}
            className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
          />
          <div className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-panel shadow-2xl">
            <TaskEditorDialog
              key={editing.id}
              task={editing}
              products={products}
              members={members}
              onDone={closeEditor}
              onError={(key) => setDialogError(key || null)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
