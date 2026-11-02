import {describe, expect, it} from 'vitest';

import {computeDashboard, niceTicks, type DashboardTask} from '@/lib/dashboard';

const base: DashboardTask = {
  id: 't',
  title: 'Task',
  product_id: null,
  parent_task_id: null,
  status: 'pending',
  workflow_status: 'todo',
  due_date: null,
  assignee_id: null,
  created_at: '2026-10-01T08:00:00Z',
  completed_at: null,
  completed_by: null,
  completion_note: null
};

// 2026-11-02 is a Monday; its Sunday–Saturday week starts 2026-11-01.
const TODAY = '2026-11-02';

describe('computeDashboard', () => {
  it('counts open, overdue, due-this-week and status of open work', () => {
    const figures = computeDashboard(
      [
        {...base, id: 'a', due_date: '2026-10-30', assignee_id: 'u1'},
        {...base, id: 'b', due_date: '2026-11-04', workflow_status: 'in_progress', assignee_id: 'u1'},
        {...base, id: 'c', workflow_status: 'blocked'},
        {...base, id: 'd', status: 'completed', workflow_status: 'done', completed_at: '2026-11-01T10:00:00Z'}
      ],
      TODAY
    );
    expect(figures.open).toBe(3);
    expect(figures.overdue).toBe(1);
    expect(figures.dueThisWeek).toBe(1);
    expect(figures.byStatus).toEqual({todo: 1, in_progress: 1, blocked: 1});
    expect(figures.completedThisWeek).toBe(1);
    expect(figures.completedLastWeek).toBe(0);
  });

  it('builds twelve weekly points ending this week', () => {
    const figures = computeDashboard(
      [
        {...base, id: 'a', created_at: '2026-11-01T06:00:00Z'},
        {...base, id: 'b', created_at: '2026-10-26T06:00:00Z', status: 'completed', workflow_status: 'done', completed_at: '2026-11-02T06:00:00Z'}
      ],
      TODAY
    );
    expect(figures.weeks).toHaveLength(12);
    const last = figures.weeks.at(-1)!;
    expect(last.start).toBe('2026-11-01');
    expect(last.created).toBe(1);
    expect(last.completed).toBe(1);
    // b was open at the end of the previous week, completed in this one.
    expect(figures.weeks.at(-2)!.openAtEnd).toBe(1);
    expect(last.openAtEnd).toBe(1);
  });

  it('orders workload busiest first with unassigned last', () => {
    const figures = computeDashboard(
      [
        {...base, id: 'a'},
        {...base, id: 'b', assignee_id: 'u1'},
        {...base, id: 'c', assignee_id: 'u2'},
        {...base, id: 'd', assignee_id: 'u2', due_date: '2026-10-01'}
      ],
      TODAY
    );
    expect(figures.workload.map((row) => row.userId)).toEqual(['u2', 'u1', null]);
    expect(figures.workload[0]).toMatchObject({onTrack: 1, overdue: 1});
  });
});

describe('niceTicks', () => {
  it('rounds the axis to clean steps', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(7)).toEqual([0, 2.5, 5, 7.5]);
    expect(niceTicks(10)).toEqual([0, 5, 10]);
  });
});
