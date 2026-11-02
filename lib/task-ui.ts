// Pure helpers shared by every task screen: the one status model, due-date
// buckets and relative labels. No React here, so they are unit-tested.

import {addDays, daysBetween, weekRange} from '@/lib/dates';
import {WORKFLOW_STATUSES, type WorkflowStatus} from '@/lib/my-work';

export {WORKFLOW_STATUSES, type WorkflowStatus};

// One status, everywhere. The database keeps status (pending | completed) and
// workflow_status (todo | in_progress | blocked | done) in step with a trigger
// (migrations/20261026120000), so screens only ever need to show and set
// workflow_status. Rows read before that column existed fall back on status.
export function workflowOf(task: {
  status: 'pending' | 'completed';
  workflow_status?: WorkflowStatus | null;
}): WorkflowStatus {
  if (task.workflow_status) return task.workflow_status;
  return task.status === 'completed' ? 'done' : 'todo';
}

// Dot and chip classes per status. Accent = moving, danger = stuck, muted =
// finished, faint = not started. Every chip also carries its text label, so
// colour never carries the meaning alone.
export const STATUS_STYLE: Record<WorkflowStatus, {dot: string; chip: string}> = {
  todo: {dot: 'bg-faint', chip: 'border-hairline bg-raised text-muted'},
  in_progress: {dot: 'bg-accent', chip: 'border-accent/30 bg-accent/10 text-accent'},
  blocked: {dot: 'bg-danger', chip: 'border-danger/30 bg-danger/10 text-danger'},
  done: {dot: 'bg-muted', chip: 'border-hairline bg-raised/60 text-faint'}
};

export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none';
export const DUE_BUCKETS: DueBucket[] = ['overdue', 'today', 'week', 'later', 'none'];

// "This week" is the next six days after today, not the calendar week, so a
// task due tomorrow is always "this week" even on the last working day.
export function dueBucket(dueDate: string | null, today: string): DueBucket {
  if (!dueDate) return 'none';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  if (dueDate <= addDays(today, 6)) return 'week';
  return 'later';
}

export type RelativeDue =
  | {kind: 'none'}
  | {kind: 'overdue'; days: number}
  | {kind: 'today'}
  | {kind: 'tomorrow'}
  | {kind: 'inDays'; days: number}
  | {kind: 'date'; date: string};

// The words a person would use: "Today", "Tomorrow", "In 3 days",
// "2 days overdue". Past a week the calendar date reads better.
export function relativeDue(dueDate: string | null, today: string): RelativeDue {
  if (!dueDate) return {kind: 'none'};
  const days = daysBetween(today, dueDate.slice(0, 10));
  if (days < 0) return {kind: 'overdue', days: -days};
  if (days === 0) return {kind: 'today'};
  if (days === 1) return {kind: 'tomorrow'};
  if (days <= 6) return {kind: 'inDays', days};
  return {kind: 'date', date: dueDate.slice(0, 10)};
}

// Short calendar date; the year only when it is not the current one.
export function shortDay(date: string, today: string, locale: string): string {
  const day = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return date;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(date.slice(0, 4) === today.slice(0, 4) ? {} : {year: 'numeric'}),
    timeZone: 'UTC'
  }).format(day);
}

// Initials for an avatar: first letters of the first two words.
export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => Array.from(part)[0] ?? '');
  return letters.join('').toLocaleUpperCase() || '?';
}

// The Sunday–Saturday week of `date`, re-exported for the dashboard.
export {weekRange};
