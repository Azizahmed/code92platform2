import 'server-only';

import {cookies} from 'next/headers';

import {createInsForgeServerClient} from '@/lib/insforge/server';

export type MyWorkCounts = {
  waiting: number;
  overdueTasks: number;
  dueTodayTasks: number;
  badge: number;
};

export const EMPTY_COUNTS: MyWorkCounts = {waiting: 0, overdueTasks: 0, dueTodayTasks: 0, badge: 0};

// my_work_counts() in one round trip. Never throws; zeros on any failure.
// Like getMe(), a request with no session cookie returns before touching the
// backend, so the layout can start this in the same wave as get_me() without
// costing anonymous traffic a call.
export async function getMyWorkCounts(): Promise<MyWorkCounts> {
  try {
    const cookieStore = await cookies();
    if (
      !cookieStore.has('insforge_access_token') &&
      !cookieStore.has('insforge_refresh_token')
    ) {
      return EMPTY_COUNTS;
    }

    const insforge = await createInsForgeServerClient();
    const {data, error} = await insforge.database.rpc('my_work_counts');
    if (error) return EMPTY_COUNTS;
    const row = (Array.isArray(data) ? data[0] : data) as
      | {waiting: number; overdue_tasks: number; due_today_tasks: number; badge: number}
      | undefined;
    if (!row) return EMPTY_COUNTS;
    return {
      waiting: row.waiting,
      overdueTasks: row.overdue_tasks,
      dueTodayTasks: row.due_today_tasks,
      badge: row.badge
    };
  } catch {
    return EMPTY_COUNTS;
  }
}
