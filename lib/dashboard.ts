// Pure figures for the dashboard, computed from plain task rows so they are
// unit-tested (tests/unit/dashboard.test.ts). Dates are business dates
// (Asia/Kuwait, see lib/dates.ts) so a week means the same thing everywhere.

import {addDays, businessDate, weekRange} from '@/lib/dates';
import {dueBucket, workflowOf, type WorkflowStatus} from '@/lib/task-ui';

export type DashboardTask = {
  id: string;
  title: string;
  product_id: string | null;
  parent_task_id: string | null;
  status: 'pending' | 'completed';
  workflow_status: WorkflowStatus | null;
  due_date: string | null;
  assignee_id: string | null;
  created_at: string;
  completed_at: string | null;
  completed_by: string | null;
  completion_note: string | null;
};

export type WeekPoint = {
  start: string; // YYYY-MM-DD, Sunday
  created: number;
  completed: number;
  openAtEnd: number;
};

export type WorkloadRow = {
  userId: string | null;
  onTrack: number;
  overdue: number;
};

export type DashboardFigures = {
  weeks: WeekPoint[];
  open: number;
  overdue: number;
  dueThisWeek: number;
  completedThisWeek: number;
  completedLastWeek: number;
  byStatus: Record<Exclude<WorkflowStatus, 'done'>, number>;
  workload: WorkloadRow[];
  dueSoon: DashboardTask[];
  recentlyCompleted: DashboardTask[];
};

const day = (timestamp: string) => businessDate(new Date(timestamp));

export function computeDashboard(
  tasks: DashboardTask[],
  today: string,
  weekCount = 12
): DashboardFigures {
  const thisWeek = weekRange(today);
  const weeks: WeekPoint[] = [];
  for (let index = weekCount - 1; index >= 0; index -= 1) {
    const start = addDays(thisWeek.start, -7 * index);
    weeks.push({start, created: 0, completed: 0, openAtEnd: 0});
  }
  const firstStart = weeks[0].start;
  const weekIndex = (date: string) => {
    if (date < firstStart || date > thisWeek.end) return -1;
    return Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${firstStart}T00:00:00Z`)) / (7 * 86_400_000));
  };

  let open = 0;
  let overdue = 0;
  let dueThisWeek = 0;
  const byStatus = {todo: 0, in_progress: 0, blocked: 0};
  const workload = new Map<string, WorkloadRow>();
  const lastWeekStart = addDays(thisWeek.start, -7);

  let completedThisWeek = 0;
  let completedLastWeek = 0;

  for (const task of tasks) {
    const created = day(task.created_at);
    const completed = task.completed_at ? day(task.completed_at) : null;

    const createdAt = weekIndex(created);
    if (createdAt >= 0) weeks[createdAt].created += 1;
    if (completed) {
      const completedAt = weekIndex(completed);
      if (completedAt >= 0) weeks[completedAt].completed += 1;
      if (completed >= thisWeek.start && completed <= thisWeek.end) completedThisWeek += 1;
      else if (completed >= lastWeekStart && completed < thisWeek.start) completedLastWeek += 1;
    }

    // Open at the end of each week: created by then, not yet completed by then.
    // A reopened task has lost its completed_at, so it counts as open all
    // along; close enough for a trend line.
    for (const week of weeks) {
      const end = addDays(week.start, 6);
      if (created <= end && (!completed || completed > end)) week.openAtEnd += 1;
    }

    if (task.status !== 'pending') continue;
    open += 1;
    const status = workflowOf(task);
    if (status !== 'done') byStatus[status] += 1;
    const bucket = dueBucket(task.due_date, today);
    if (bucket === 'overdue') overdue += 1;
    if (bucket === 'today' || bucket === 'week') dueThisWeek += 1;

    const key = task.assignee_id ?? '';
    const row = workload.get(key) ?? {userId: task.assignee_id, onTrack: 0, overdue: 0};
    if (bucket === 'overdue') row.overdue += 1;
    else row.onTrack += 1;
    workload.set(key, row);
  }

  const soonLimit = addDays(today, 6);
  const dueSoon = tasks
    .filter((task) => task.status === 'pending' && task.due_date && task.due_date <= soonLimit)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : 0))
    .slice(0, 6);

  const recentlyCompleted = tasks
    .filter((task) => task.status === 'completed' && task.completed_at)
    .sort((a, b) => (a.completed_at! < b.completed_at! ? 1 : -1))
    .slice(0, 5);

  return {
    weeks,
    open,
    overdue,
    dueThisWeek,
    completedThisWeek,
    completedLastWeek,
    byStatus,
    // Busiest first; unassigned work last, where it reads as a to-do.
    workload: [...workload.values()].sort((a, b) => {
      if (a.userId === null) return 1;
      if (b.userId === null) return -1;
      return b.onTrack + b.overdue - (a.onTrack + a.overdue);
    }),
    dueSoon,
    recentlyCompleted
  };
}

// Morning / afternoon / evening on the business clock.
export function partOfDay(at: Date = new Date()): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {hour: 'numeric', hour12: false, timeZone: 'Asia/Kuwait'}).format(at)
  );
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

// Clean axis maximum and ticks: 0 and three steps up to a round number.
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= rough) ?? rough;
  const ticks: number[] = [];
  for (let value = 0; value < max + step; value += step) ticks.push(Math.round(value * 100) / 100);
  return ticks;
}
