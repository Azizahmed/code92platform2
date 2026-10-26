import {describe, expect, it} from 'vitest';

import {
  addDays,
  businessDate,
  daysBetween,
  dueState,
  monthRange,
  weekRange
} from '@/lib/dates';
import {
  applyWorkflowMove,
  byWorkflowStatus,
  firstLine,
  groupByProduct,
  type MyTask
} from '@/lib/my-work';

function task(partial: Partial<MyTask> & {id: string}): MyTask {
  return {
    product_id: null,
    parent_task_id: null,
    title: partial.id,
    notes: null,
    due_date: null,
    status: 'pending',
    workflow_status: 'todo',
    completed_at: null,
    created_at: '2026-10-01T00:00:00Z',
    product_name: null,
    product_logo_url: null,
    parent_title: null,
    ...partial
  };
}

describe('groupByProduct', () => {
  const tasks = [
    task({id: 'g-undated'}),
    task({id: 'z-late', product_id: 'z', product_name: 'Zeta', due_date: '2026-11-02'}),
    task({id: 'a-undated', product_id: 'a', product_name: 'Alpha'}),
    task({id: 'a-soon', product_id: 'a', product_name: 'Alpha', due_date: '2026-10-27'}),
    task({id: 'g-dated', due_date: '2026-10-30'}),
    task({id: 'z-early', product_id: 'z', product_name: 'Zeta', due_date: '2026-10-20'})
  ];

  it('groups by product alphabetically with General last', () => {
    expect(groupByProduct(tasks).map((g) => g.productName)).toEqual(['Alpha', 'Zeta', null]);
  });

  it('orders each group by due date, undated last', () => {
    const groups = groupByProduct(tasks);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['a-soon', 'a-undated']);
    expect(groups[1].tasks.map((t) => t.id)).toEqual(['z-early', 'z-late']);
    expect(groups[2].tasks.map((t) => t.id)).toEqual(['g-dated', 'g-undated']);
  });
});

describe('kanban', () => {
  it('buckets tasks into the four columns', () => {
    const columns = byWorkflowStatus([
      task({id: '1', workflow_status: 'blocked'}),
      task({id: '2', workflow_status: 'done', status: 'completed'}),
      task({id: '3'})
    ]);
    expect(Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, v.map((t) => t.id)]))).toEqual({
      todo: ['3'],
      in_progress: [],
      blocked: ['1'],
      done: ['2']
    });
  });

  it('moving to done completes; moving out reopens (optimistic mirror of the DB)', () => {
    const [done] = applyWorkflowMove([task({id: '1'})], {taskId: '1', status: 'done'});
    expect(done.status).toBe('completed');
    const [back] = applyWorkflowMove([done], {taskId: '1', status: 'blocked'});
    expect(back.status).toBe('pending');
  });

  it('shows the first non-empty line of the description', () => {
    expect(firstLine('\n  first line \nsecond')).toBe('first line');
    expect(firstLine(null)).toBeNull();
    expect(firstLine('x'.repeat(200), 10)).toHaveLength(10);
  });
});

describe('business calendar', () => {
  it('uses Kuwait time (UTC+3), not UTC', () => {
    // 22:30 UTC on the 26th is already the 27th in Kuwait.
    expect(businessDate(new Date('2026-10-26T22:30:00Z'))).toBe('2026-10-27');
    expect(businessDate(new Date('2026-10-26T20:30:00Z'))).toBe('2026-10-26');
  });

  it('date arithmetic', () => {
    expect(daysBetween('2026-10-20', '2026-10-27')).toBe(7);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(dueState('2026-10-25', '2026-10-26')).toBe('overdue');
    expect(dueState('2026-10-26', '2026-10-26')).toBe('today');
    expect(dueState(null, '2026-10-26')).toBe('none');
  });

  it('week runs Sunday to Saturday; month bounds', () => {
    // 2026-10-26 is a Monday.
    expect(weekRange('2026-10-26')).toEqual({start: '2026-10-25', end: '2026-10-31'});
    expect(monthRange('2026-02-10')).toEqual({start: '2026-02-01', end: '2026-02-28'});
  });
});
