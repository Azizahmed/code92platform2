'use client';

// The task side panel is addressed by a `?task=<id>` search parameter, so any
// page can open it, a link to it can be shared, and Back closes it.
//
// history.pushState / replaceState are integrated with Next's router (14.1+):
// useSearchParams() sees the change without a server round trip. The state
// argument must be null: Next skips its sync for a state object it recognises
// as its own (window.history.state), and fills in its own state otherwise.

export const TASK_PARAM = 'task';

// True while the open panel was pushed by this tab, so closing can step back
// instead of leaving a duplicate history entry.
let pushedByUs = false;

export function openTaskDrawer(taskId: string) {
  const url = new URL(window.location.href);
  if (url.searchParams.get(TASK_PARAM) === taskId) return;
  const replacing = url.searchParams.has(TASK_PARAM);
  url.searchParams.set(TASK_PARAM, taskId);
  // Moving from one task to another inside the panel replaces, so Back still
  // returns to the list rather than walking through every task opened.
  if (replacing) {
    window.history.replaceState(null, '', url);
  } else {
    window.history.pushState(null, '', url);
    pushedByUs = true;
  }
}

export function closeTaskDrawer() {
  if (pushedByUs) {
    pushedByUs = false;
    window.history.back();
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete(TASK_PARAM);
  window.history.replaceState(null, '', url);
}

// A shareable absolute link to a task, on its product's task tab when it has
// one so the panel opens over the place the task lives.
export function taskLink(task: {id: string; product_id: string | null}, locale: string): string {
  const path = task.product_id
    ? `/${locale}/products/${task.product_id}?tab=tasks&${TASK_PARAM}=${task.id}`
    : `/${locale}/tasks?${TASK_PARAM}=${task.id}`;
  return `${window.location.origin}${path}`;
}
