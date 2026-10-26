// Pure helpers for the My work screen (grouping, ordering, kanban columns),
// kept out of components so they are unit-tested.

export const WORKFLOW_STATUSES = ['todo', 'in_progress', 'blocked', 'done'] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export function isWorkflowStatus(value: string): value is WorkflowStatus {
  return (WORKFLOW_STATUSES as readonly string[]).includes(value);
}

export type MyTask = {
  id: string;
  product_id: string | null;
  parent_task_id: string | null;
  title: string;
  notes: string | null;
  due_date: string | null;
  status: 'pending' | 'completed';
  workflow_status: WorkflowStatus;
  completed_at: string | null;
  created_at: string;
  product_name: string | null;
  product_logo_url: string | null;
  parent_title: string | null;
};

// Due date ascending, undated last, then newest first.
export function compareByDue(a: MyTask, b: MyTask): number {
  if (a.due_date !== b.due_date) {
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  }
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

export type TaskGroup<T extends MyTask = MyTask> = {
  productId: string | null;
  productName: string | null;
  tasks: T[];
};

// Grouped by product (alphabetical), General (no product) last; each group
// ordered by due date with undated last.
export function groupByProduct<T extends MyTask>(tasks: T[], locale = 'en'): TaskGroup<T>[] {
  const groups = new Map<string, TaskGroup<T>>();
  for (const task of tasks) {
    const key = task.product_id ?? '';
    let group = groups.get(key);
    if (!group) {
      group = {productId: task.product_id, productName: task.product_name, tasks: []};
      groups.set(key, group);
    }
    group.tasks.push(task);
  }
  const list = [...groups.values()];
  for (const group of list) group.tasks.sort(compareByDue);
  return list.sort((a, b) => {
    if (a.productId === null) return 1;
    if (b.productId === null) return -1;
    return (a.productName ?? '').localeCompare(b.productName ?? '', locale);
  });
}

export function byWorkflowStatus<T extends MyTask>(tasks: T[]): Record<WorkflowStatus, T[]> {
  const columns: Record<WorkflowStatus, T[]> = {
    todo: [],
    in_progress: [],
    blocked: [],
    done: []
  };
  for (const task of tasks) columns[task.workflow_status].push(task);
  for (const status of WORKFLOW_STATUSES) columns[status].sort(compareByDue);
  return columns;
}

export function firstLine(text: string | null, max = 120): string | null {
  if (!text) return null;
  const line = text.split('\n').find((part) => part.trim())?.trim() ?? '';
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// Optimistic kanban move: mirrors the DB sync (done <-> completed).
export function applyWorkflowMove<T extends MyTask>(
  tasks: T[],
  move: {taskId: string; status: WorkflowStatus}
): T[] {
  return tasks.map((task) =>
    task.id === move.taskId
      ? {
          ...task,
          workflow_status: move.status,
          status: move.status === 'done' ? 'completed' : 'pending'
        }
      : task
  );
}
