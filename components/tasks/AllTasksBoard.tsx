'use client';

import {
  AlarmClock,
  Ban,
  CalendarDays,
  ChevronDown,
  Circle,
  Columns3,
  List,
  ListTodo,
  Search,
  X
} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useEffect, useMemo, useState, useDeferredValue} from 'react';

import KanbanBoard from '@/components/kanban/KanbanBoard';
import type {TaskMemberOption} from '@/components/products/ProductTasksPanel';
import TaskBoardCard from '@/components/tasks/TaskBoardCard';
import TaskEditorModal from '@/components/tasks/TaskEditorModal';
import type {TaskEditorDefaults} from '@/components/tasks/TaskEditorDialog';
import TaskQuickAdd from '@/components/tasks/TaskQuickAdd';
import TaskRow, {type SubtaskProgress} from '@/components/tasks/TaskRow';
import {useTaskActions, useTaskOverrides} from '@/components/tasks/useTaskActions';
import type {ProductTask} from '@/lib/actions/tasks';
import {addDays} from '@/lib/dates';
import {
  DUE_BUCKETS,
  STATUS_STYLE,
  WORKFLOW_STATUSES,
  dueBucket,
  workflowOf,
  type DueBucket,
  type WorkflowStatus
} from '@/lib/task-ui';

export type AllTaskItem = ProductTask & {
  product_name: string | null;
  product_logo_url: string | null;
  product_archived_at: string | null;
  assignee_name: string | null;
  parent_title: string | null;
  completed_by_name: string | null;
};

export type TaskProductOption = {
  id: string;
  name: string;
};

type Scope = 'open' | 'all' | 'completed';
type GroupBy = 'due' | 'product' | 'assignee' | 'status' | 'none';
type View = 'list' | 'board';

type Filters = {
  scope: Scope;
  product: string; // 'all' | 'general' | product id
  assignee: string; // 'all' | 'me' | 'none' | user id
  due: 'all' | DueBucket;
  status: 'all' | Exclude<WorkflowStatus, 'done'>;
  q: string;
  group: GroupBy;
  view: View;
};

const DEFAULTS: Filters = {
  scope: 'open',
  product: 'all',
  assignee: 'all',
  due: 'all',
  status: 'all',
  q: '',
  group: 'due',
  view: 'list'
};

const SELECT_CLASS =
  'h-9 rounded-md border border-hairline bg-bg px-2.5 text-xs text-muted outline-none transition-colors focus:border-accent/50';

// Done cards stay on the board for two weeks after completion.
const BOARD_DONE_DAYS = 14;

function readFilters(mode: 'team' | 'mine'): Filters {
  if (typeof window === 'undefined') return DEFAULTS;
  const params = new URL(window.location.href).searchParams;
  const pick = <K extends keyof Filters>(key: K, allowed?: readonly string[]): Filters[K] => {
    const value = params.get(key);
    if (value === null || (allowed && !allowed.includes(value))) return DEFAULTS[key];
    return value as Filters[K];
  };
  return {
    scope: pick('scope', ['open', 'all', 'completed']),
    product: pick('product'),
    assignee: mode === 'mine' ? 'all' : pick('assignee'),
    due: pick('due', ['all', ...DUE_BUCKETS]),
    status: pick('status', ['all', 'todo', 'in_progress', 'blocked']),
    q: pick('q'),
    group: pick('group', ['due', 'product', 'assignee', 'status', 'none']),
    view: pick('view', ['list', 'board'])
  };
}

// Filters live in the address bar, so a view can be bookmarked or sent to
// someone. replaceState: changing a filter is not a navigation.
function writeFilters(filters: Filters) {
  const url = new URL(window.location.href);
  for (const key of Object.keys(DEFAULTS) as (keyof Filters)[]) {
    const value = filters[key];
    if (value === DEFAULTS[key] || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  if (url.href !== window.location.href) {
    window.history.replaceState(null, '', url);
  }
}

function compareTasks(a: AllTaskItem, b: AllTaskItem): number {
  if (a.due_date !== b.due_date) {
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  }
  return a.created_at < b.created_at ? 1 : -1;
}

export default function AllTasksBoard({
  tasks,
  products,
  members,
  currentUserId,
  locale,
  today,
  mode = 'team',
  openNew = false
}: {
  tasks: AllTaskItem[];
  products: TaskProductOption[];
  members: TaskMemberOption[];
  currentUserId: string;
  locale: string;
  today: string;
  // 'mine' is My work: the caller's tasks only, so there is no owner filter.
  mode?: 'team' | 'mine';
  // Open the full form on arrival (the command palette's "New task").
  openNew?: boolean;
}) {
  const t = useTranslations('tasks');
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const deferredQuery = useDeferredValue(filters.q);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<
    {kind: 'new'; defaults?: TaskEditorDefaults} | {kind: 'edit'; task: AllTaskItem} | null
  >(openNew ? {kind: 'new', defaults: mode === 'mine' ? {assigneeId: currentUserId} : undefined} : null);
  const [items, override] = useTaskOverrides(tasks);
  const actions = useTaskActions({onOverride: override});

  // Read the address bar after hydration, so the server and first client
  // render agree.
  useEffect(() => {
    setFilters(readFilters(mode));
    setHydrated(true);
  }, [mode]);

  useEffect(() => {
    if (hydrated) writeFilters(filters);
  }, [filters, hydrated]);

  function update(patch: Partial<Filters>) {
    setFilters((current) => ({...current, ...patch}));
  }

  const memberName = useMemo(
    () => new Map(members.map((member) => [member.userId, member.displayName])),
    [members]
  );

  // Headline counts over everything in view of this screen, not the filtered
  // slice: they are the buttons that make the slice.
  const counts = useMemo(() => {
    let open = 0, today_ = 0, overdue = 0, blocked = 0, completed = 0;
    for (const task of items) {
      if (task.status === 'completed') {
        completed += 1;
        continue;
      }
      open += 1;
      const bucket = dueBucket(task.due_date, today);
      if (bucket === 'today') today_ += 1;
      if (bucket === 'overdue') overdue += 1;
      if (workflowOf(task) === 'blocked') blocked += 1;
    }
    return {open, today: today_, overdue, blocked, completed};
  }, [items, today]);

  const subtaskProgress = useMemo(() => {
    const map = new Map<string, SubtaskProgress>();
    for (const task of items) {
      if (!task.parent_task_id) continue;
      const entry = map.get(task.parent_task_id) ?? {done: 0, total: 0};
      entry.total += 1;
      if (task.status === 'completed') entry.done += 1;
      map.set(task.parent_task_id, entry);
    }
    return map;
  }, [items]);

  const searchText = useMemo(
    () =>
      new Map(
        items.map((task) => [
          task.id,
          [task.title, task.notes ?? '', task.product_name ?? '', task.assignee_name ?? '', task.parent_title ?? '']
            .join(' ')
            .toLocaleLowerCase(locale)
        ])
      ),
    [items, locale]
  );

  // Everything except scope and status: the board shows every column.
  const matchesBase = useMemo(() => {
    const query = deferredQuery.trim().toLocaleLowerCase(locale);
    return (task: AllTaskItem) => {
      if (filters.product === 'general') {
        if (task.product_id !== null) return false;
      } else if (filters.product !== 'all' && task.product_id !== filters.product) {
        return false;
      }
      if (filters.assignee === 'me' && task.assignee_id !== currentUserId) return false;
      if (filters.assignee === 'none' && task.assignee_id !== null) return false;
      if (!['all', 'me', 'none'].includes(filters.assignee) && task.assignee_id !== filters.assignee) return false;
      if (filters.due !== 'all' && (task.status === 'completed' || dueBucket(task.due_date, today) !== filters.due)) {
        return false;
      }
      if (query && !searchText.get(task.id)?.includes(query)) return false;
      return true;
    };
  }, [currentUserId, deferredQuery, filters.assignee, filters.due, filters.product, locale, searchText, today]);

  const visible = useMemo(
    () =>
      items.filter((task) => {
        if (filters.scope === 'open' && task.status !== 'pending') return false;
        if (filters.scope === 'completed' && task.status !== 'completed') return false;
        if (filters.status !== 'all' && workflowOf(task) !== filters.status) return false;
        return matchesBase(task);
      }),
    [items, filters.scope, filters.status, matchesBase]
  );

  // Subtasks sit under their parent when both are in view; a subtask whose
  // parent is filtered out stands on its own, labelled with the parent.
  const {roots, childrenOf} = useMemo(() => {
    const ids = new Set(visible.map((task) => task.id));
    const childrenOf = new Map<string, AllTaskItem[]>();
    const roots: AllTaskItem[] = [];
    for (const task of visible) {
      if (task.parent_task_id && ids.has(task.parent_task_id)) {
        const list = childrenOf.get(task.parent_task_id) ?? [];
        list.push(task);
        childrenOf.set(task.parent_task_id, list);
      } else {
        roots.push(task);
      }
    }
    for (const list of childrenOf.values()) list.sort(compareTasks);
    return {roots: roots.sort(compareTasks), childrenOf};
  }, [visible]);

  const groups = useMemo(() => {
    type Group = {key: string; label: string; tone?: string; tasks: AllTaskItem[]};
    const map = new Map<string, Group>();
    const add = (key: string, label: string, task: AllTaskItem, tone?: string) => {
      const group = map.get(key) ?? {key, label, tone, tasks: []};
      group.tasks.push(task);
      map.set(key, group);
    };
    for (const task of roots) {
      switch (filters.group) {
        case 'due': {
          const bucket = task.status === 'completed' ? 'done' : dueBucket(task.due_date, today);
          add(
            bucket,
            bucket === 'done' ? t('status.done') : t(`groups.due.${bucket}`),
            task,
            bucket === 'overdue' ? 'text-amber' : bucket === 'today' ? 'text-accent' : undefined
          );
          break;
        }
        case 'product':
          add(task.product_id ?? '~general', task.product_name ?? t('all.general'), task);
          break;
        case 'assignee':
          add(
            task.assignee_id ?? '~none',
            task.assignee_id
              ? task.assignee_id === currentUserId
                ? t('groups.me', {name: memberName.get(task.assignee_id) ?? ''})
                : memberName.get(task.assignee_id) ?? t('task.unassigned')
              : t('task.unassigned'),
            task
          );
          break;
        case 'status': {
          const status = workflowOf(task);
          add(status, t(`status.${status}`), task);
          break;
        }
        default:
          add('all', '', task);
      }
    }
    const list = [...map.values()];
    if (filters.group === 'due') {
      const order = [...DUE_BUCKETS, 'done'];
      list.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    } else if (filters.group === 'status') {
      list.sort((a, b) => WORKFLOW_STATUSES.indexOf(a.key as WorkflowStatus) - WORKFLOW_STATUSES.indexOf(b.key as WorkflowStatus));
    } else {
      list.sort((a, b) => {
        if (a.key.startsWith('~')) return 1;
        if (b.key.startsWith('~')) return -1;
        return a.label.localeCompare(b.label, locale);
      });
    }
    return list;
  }, [roots, filters.group, today, t, currentUserId, memberName, locale]);

  const boardItems = useMemo(() => {
    const doneSince = addDays(today, -BOARD_DONE_DAYS);
    return items
      .filter((task) => {
        if (!matchesBase(task)) return false;
        if (task.status === 'completed') return (task.completed_at ?? '').slice(0, 10) >= doneSince;
        return true;
      })
      .sort(compareTasks);
  }, [items, matchesBase, today]);

  const isFiltered =
    filters.product !== 'all' ||
    filters.assignee !== 'all' ||
    filters.due !== 'all' ||
    filters.status !== 'all' ||
    filters.q !== '' ||
    filters.scope !== 'open';

  const cards = [
    {key: 'open', value: counts.open, icon: Circle, tone: 'text-ink', active: filters.scope === 'open' && filters.due === 'all' && filters.status === 'all', apply: () => update({scope: 'open', due: 'all', status: 'all'})},
    {key: 'dueToday', value: counts.today, icon: CalendarDays, tone: counts.today > 0 ? 'text-accent' : 'text-ink', active: filters.due === 'today', apply: () => update(filters.due === 'today' ? {due: 'all'} : {due: 'today', scope: 'open', status: 'all'})},
    {key: 'overdue', value: counts.overdue, icon: AlarmClock, tone: counts.overdue > 0 ? 'text-amber' : 'text-ink', active: filters.due === 'overdue', apply: () => update(filters.due === 'overdue' ? {due: 'all'} : {due: 'overdue', scope: 'open', status: 'all'})},
    {key: 'blocked', value: counts.blocked, icon: Ban, tone: counts.blocked > 0 ? 'text-danger' : 'text-ink', active: filters.status === 'blocked', apply: () => update(filters.status === 'blocked' ? {status: 'all'} : {status: 'blocked', scope: 'open', due: 'all'})}
  ] as const;

  function editTask(task: AllTaskItem) {
    setEditor({kind: 'edit', task});
  }

  function addSubtask(task: AllTaskItem) {
    setEditor({
      kind: 'new',
      defaults: {productId: task.product_id, parentTaskId: task.id, assigneeId: mode === 'mine' ? currentUserId : null}
    });
  }

  function renderRow(task: AllTaskItem, depth: 0 | 1 = 0): React.ReactNode {
    const children = depth === 0 ? childrenOf.get(task.id) ?? [] : [];
    return (
      <TaskRow
        key={task.id}
        task={task}
        depth={depth}
        today={today}
        locale={locale}
        progress={subtaskProgress.get(task.id)}
        showAssignee={mode === 'team'}
        showParent={depth === 0}
        actions={actions}
        onEdit={() => editTask(task)}
        onAddSubtask={!task.parent_task_id && !task.project_id ? () => addSubtask(task) : undefined}
      >
        {children.map((child) => renderRow(child, 1))}
      </TaskRow>
    );
  }

  return (
    <div className="space-y-4">
      {actions.dialog}
      {editor ? (
        <TaskEditorModal
          task={editor.kind === 'edit' ? editor.task : undefined}
          defaults={editor.kind === 'new' ? editor.defaults : undefined}
          lockProduct={editor.kind === 'new' && Boolean(editor.defaults?.parentTaskId)}
          products={products}
          members={members}
          onClose={(createdId) => {
            setEditor(null);
            if (createdId) actions.open(createdId);
          }}
          onError={() => {}}
        />
      ) : null}

      <TaskQuickAdd
        members={members}
        products={products}
        defaultAssigneeId={mode === 'mine' ? currentUserId : null}
        placeholder={mode === 'mine' ? t('quickAdd.placeholderMine') : undefined}
        onMoreOptions={(draft) => setEditor({kind: 'new', defaults: draft})}
      />

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {cards.map(({key, value, icon: Icon, tone, active, apply}) => (
          <button
            key={key}
            type="button"
            onClick={apply}
            aria-pressed={active}
            className={`rounded-lg border px-4 py-3 text-start transition-colors ${
              active
                ? 'border-accent/40 bg-accent/[0.06]'
                : 'border-hairline bg-panel hover:border-accent/25 hover:bg-raised/40'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted">{t(`all.stats.${key}`)}</span>
              <Icon className={`h-4 w-4 ${tone}`} strokeWidth={1.75} />
            </div>
            <div className={`mt-1.5 text-2xl font-semibold ${tone}`}>{value}</div>
          </button>
        ))}
      </div>

      <div className="space-y-2.5 rounded-lg border border-hairline bg-panel p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
              strokeWidth={1.75}
            />
            <input
              type="search"
              value={filters.q}
              onChange={(event) => update({q: event.target.value})}
              placeholder={t('all.searchPlaceholder')}
              className="h-9 w-full rounded-md border border-hairline bg-bg ps-9 pe-3 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50"
            />
          </div>

          <div className="flex items-center gap-1 rounded-md border border-hairline bg-bg p-1">
            {(
              [
                {value: 'list', icon: List},
                {value: 'board', icon: Columns3}
              ] as const
            ).map(({value, icon: Icon}) => (
              <button
                key={value}
                type="button"
                onClick={() => update({view: value})}
                aria-pressed={filters.view === value}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
                  filters.view === value ? 'bg-raised text-ink' : 'text-faint hover:text-muted'
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t(`views.${value}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {filters.view === 'list' ? (
            <div className="flex items-center gap-1 rounded-md border border-hairline bg-bg p-1">
              {(['open', 'all', 'completed'] as Scope[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => update({scope: value})}
                  aria-pressed={filters.scope === value}
                  className={`rounded px-2.5 py-1 text-xs transition-colors ${
                    filters.scope === value ? 'bg-raised text-ink' : 'text-faint hover:text-muted'
                  }`}
                >
                  {t(`all.scope.${value}`)}
                  {value === 'completed' ? <span className="ms-1 font-mono text-[10px] text-faint">{counts.completed}</span> : null}
                </button>
              ))}
            </div>
          ) : null}

          {filters.view === 'list' ? (
            <label>
              <span className="sr-only">{t('filters.status')}</span>
              <select
                value={filters.status}
                onChange={(event) => update({status: event.target.value as Filters['status']})}
                className={SELECT_CLASS}
              >
                <option value="all">{t('filters.anyStatus')}</option>
                {(['todo', 'in_progress', 'blocked'] as const).map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label>
            <span className="sr-only">{t('form.product')}</span>
            <select
              value={filters.product}
              onChange={(event) => update({product: event.target.value})}
              className={SELECT_CLASS}
            >
              <option value="all">{t('all.allProducts')}</option>
              <option value="general">{t('all.general')}</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>

          {mode === 'team' ? (
            <label>
              <span className="sr-only">{t('form.assignee')}</span>
              <select
                value={filters.assignee}
                onChange={(event) => update({assignee: event.target.value})}
                className={SELECT_CLASS}
              >
                <option value="all">{t('filters.anyone')}</option>
                <option value="me">{t('all.assignedToMe')}</option>
                <option value="none">{t('task.unassigned')}</option>
                {members
                  .filter((member) => member.userId !== currentUserId)
                  .map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.displayName}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}

          <label>
            <span className="sr-only">{t('filters.due')}</span>
            <select
              value={filters.due}
              onChange={(event) => update({due: event.target.value as Filters['due']})}
              className={SELECT_CLASS}
            >
              <option value="all">{t('filters.anyDate')}</option>
              {DUE_BUCKETS.map((bucket) => (
                <option key={bucket} value={bucket}>
                  {t(`groups.due.${bucket}`)}
                </option>
              ))}
            </select>
          </label>

          {filters.view === 'list' ? (
            <label className="flex items-center gap-1.5 text-xs text-faint">
              <span>{t('filters.groupBy')}</span>
              <select
                value={filters.group}
                onChange={(event) => update({group: event.target.value as GroupBy})}
                className={SELECT_CLASS}
              >
                <option value="due">{t('filters.groups.due')}</option>
                <option value="status">{t('filters.groups.status')}</option>
                <option value="product">{t('filters.groups.product')}</option>
                {mode === 'team' ? <option value="assignee">{t('filters.groups.assignee')}</option> : null}
                <option value="none">{t('filters.groups.none')}</option>
              </select>
            </label>
          ) : null}

          {isFiltered ? (
            <button
              type="button"
              onClick={() => setFilters({...DEFAULTS, view: filters.view, group: filters.group})}
              className="inline-flex h-9 items-center gap-1 rounded-md px-2.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('filters.clear')}
            </button>
          ) : null}
        </div>
      </div>

      {filters.view === 'board' ? (
        <KanbanBoard
          columns={WORKFLOW_STATUSES.map((status) => ({
            id: status,
            label: t(`status.${status}`),
            dot: STATUS_STYLE[status].dot,
            footer:
              status === 'done' ? (
                <span className="text-[10px] text-faint">{t('board.doneWindow', {days: BOARD_DONE_DAYS})}</span>
              ) : undefined
          }))}
          items={boardItems}
          getId={(task) => task.id}
          getColumn={(task) => workflowOf(task)}
          onMove={(task, status) => {
            if (status === 'done') actions.complete(task);
            else void actions.setStatus(task, status);
          }}
          emptyLabel={t('board.emptyColumn')}
          instructions={t('board.instructions')}
          renderCard={(task) => (
            <TaskBoardCard
              task={task}
              today={today}
              locale={locale}
              progress={subtaskProgress.get(task.id)}
              showAssignee={mode === 'team'}
              onOpen={() => actions.open(task.id)}
            />
          )}
        />
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-14 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-accent">
            <ListTodo className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h2 className="mt-3 text-sm font-medium">
            {items.length === 0 && mode === 'mine' ? t('empty.mineTitle') : t('all.emptyTitle')}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted">
            {items.length === 0 && mode === 'mine' ? t('empty.mineBody') : t('all.emptyBody')}
          </p>
          {isFiltered ? (
            <button
              type="button"
              onClick={() => setFilters({...DEFAULTS, view: filters.view, group: filters.group})}
              className="mt-4 rounded-md border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              {t('filters.clear')}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            return (
              <section key={group.key} className="overflow-hidden rounded-lg border border-hairline bg-panel">
                {filters.group !== 'none' ? (
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(group.key)) next.delete(group.key);
                        else next.add(group.key);
                        return next;
                      })
                    }
                    aria-expanded={!isCollapsed}
                    className="flex w-full items-center gap-2 border-b border-hairline bg-raised/30 px-4 py-2.5 text-start"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 text-faint transition-transform ${isCollapsed ? '-rotate-90 rtl:rotate-90' : ''}`}
                      strokeWidth={2}
                    />
                    <span className={`text-xs font-medium ${group.tone ?? 'text-ink'}`}>{group.label}</span>
                    <span className="rounded bg-raised px-1.5 font-mono text-[10px] text-faint">{group.tasks.length}</span>
                  </button>
                ) : null}
                {!isCollapsed ? <ul>{group.tasks.map((task) => renderRow(task))}</ul> : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
