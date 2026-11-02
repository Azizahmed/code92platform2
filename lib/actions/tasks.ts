'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';

export type TaskStatus = 'pending' | 'completed';

export type TaskWorkflowStatus = 'todo' | 'in_progress' | 'blocked' | 'done';

export type TaskAttachment = {
  id: string;
  task_id: string;
  storage_url: string;
  storage_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export type ProductTask = {
  id: string;
  // NULL for a general task — work owned by the team rather than by any one
  // product. See migrations/20260825097000_add-general-tasks.sql.
  product_id: string | null;
  parent_task_id: string | null;
  title: string;
  notes: string | null;
  due_date: string | null;
  assignee_id: string | null;
  status: TaskStatus;
  // The four-state status every screen shows. Kept in step with `status` by
  // validate_product_task(). Optional only for rows read by older queries.
  workflow_status?: TaskWorkflowStatus;
  position: number;
  created_by: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // The release this work is scoped into, if any. Written through
  // setTaskReleaseAction rather than here, so the board can rescope without
  // holding a whole task payload.
  release_id: string | null;
  // What was done, written when the task was completed. Kept through a reopen
  // so nobody loses what they wrote; only ever shown against a completed task.
  completion_note: string | null;
  // Stamped by the database from auth.uid() on the transition to completed, so
  // it cannot be claimed on someone else's behalf.
  completed_by: string | null;
  // The project this work belongs to, for project tasks. Product and project
  // are mutually exclusive, and a project's task cannot change project.
  project_id: string | null;
  attachments: TaskAttachment[];
  // Derived per viewer from task_watchers — not a column. Whoever is looking at
  // the row needs to know whether THEY are following it.
  is_watching: boolean;
};

export type TaskInput = {
  // null creates a general task.
  productId: string | null;
  parentTaskId: string | null;
  title: string;
  notes: string | null;
  dueDate: string | null;
  assigneeId: string | null;
  // Set for a project's task; leave null for a product or general task.
  projectId?: string | null;
};

type TaskActionResult =
  | {ok: true; taskId: string; storageKeys?: string[]}
  | {ok: false; error: string};

const nullableUuid = z.string().uuid().nullable();
const nullableDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

const createTaskSchema = z
  .object({
    productId: nullableUuid,
    parentTaskId: nullableUuid,
    title: z.string().trim().min(1).max(240),
    notes: z.string().trim().max(5000).nullable(),
    dueDate: nullableDate,
    assigneeId: nullableUuid,
    projectId: nullableUuid.optional()
  })
  // Mirrors product_tasks_one_scope: a task belongs to a product or a project.
  .refine((value) => !(value.productId && value.projectId), {
    path: ['projectId']
  });

const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(240),
  notes: z.string().trim().max(5000).nullable(),
  dueDate: nullableDate,
  assigneeId: nullableUuid,
  status: z.enum(['pending', 'completed']),
  // Optional for the same reason as completionNote below: `undefined` means
  // "leave it alone". The status toggle sends neither.
  // Adopting a general task into a product. Never null — the database refuses
  // to hand a product task back to general, so there is nothing to send.
  productId: z.string().uuid().optional(),
  // Optional: the editor form does not carry it, only the completion dialog
  // does. `undefined` means "leave whatever is there alone".
  completionNote: z.string().trim().max(5000).nullable().optional()
});

async function requireActiveCaller() {
  const [user, member] = await Promise.all([
    getSessionUser(),
    getOwnMembership()
  ]);
  if (!user || !member?.is_active) return null;
  return {user, member};
}

// A general task has no product page to refresh, but it does appear on
// /tasks — which, before general tasks existed, nothing here revalidated. That
// is now the one page every task is guaranteed to show up on, so it is always
// included.
function revalidateTask(productId: string | null) {
  revalidatePath('/[locale]/tasks', 'page');
  revalidatePath('/[locale]', 'page');
  if (!productId) return;
  revalidatePath(`/[locale]/products/${productId}`, 'page');
  revalidatePath('/[locale]/products', 'page');
}

// validate_product_task() raises with a human-readable reason. Map the ones a
// user can act on to message keys; everything else falls through to a generic
// failure. Same convention as lib/actions/releases.ts.
function mapTaskError(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as {message: unknown}).message)
      : String(error ?? '');

  if (message.includes('cannot be moved between products')) return 'productLocked';
  if (message.includes('detach the subtasks')) return 'hasSubtasks';
  if (message.includes('move the parent task instead')) return 'isSubtask';
  if (message.includes('unscope the task from its release')) return 'inRelease';
  if (message.includes('only a product task can join a release')) return 'inRelease';
  if (message.includes('a task cannot change project')) return 'invalid';
  if (message.includes('product_tasks_one_scope')) return 'invalid';
  if (message.includes('parent task must belong')) return 'parentMismatch';
  if (message.includes('one subtask level only')) return 'tooDeep';
  if (message.includes('parent task not found')) return 'notFound';
  return 'generic';
}

export async function createTaskAction(
  input: TaskInput
): Promise<TaskActionResult> {
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalid'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {
    productId,
    parentTaskId,
    title,
    notes,
    dueDate,
    assigneeId,
    projectId
  } = parsed.data;
  const {data, error} = await insforge.database
    .from('product_tasks')
    .insert([
      {
        product_id: productId,
        parent_task_id: parentTaskId,
        title,
        notes: notes || null,
        due_date: dueDate,
        assignee_id: assigneeId,
        project_id: projectId ?? null,
        created_by: caller.user.id
      }
    ])
    .select('id')
    .single();

  if (error) return {ok: false, error: mapTaskError(error)};
  if (!data) return {ok: false, error: 'generic'};

  revalidateTask(productId);
  if (projectId) revalidatePath(`/[locale]/projects/${projectId}`, 'page');
  return {ok: true, taskId: data.id as string};
}

export async function updateTaskAction(
  taskId: string,
  input: {
    title: string;
    notes: string | null;
    dueDate: string | null;
    assigneeId: string | null;
    status: TaskStatus;
    completionNote?: string | null;
    productId?: string;
  }
): Promise<TaskActionResult> {
  const parsed = updateTaskSchema.safeParse(input);
  if (
    !z.string().uuid().safeParse(taskId).success ||
    !parsed.success
  ) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const patch: Record<string, unknown> = {
    title: parsed.data.title,
    notes: parsed.data.notes || null,
    due_date: parsed.data.dueDate,
    assignee_id: parsed.data.assigneeId,
    status: parsed.data.status
  };

  // Only the completion dialog sends a note. Editing a completed task through
  // the normal form leaves the existing note untouched rather than wiping it
  // with the field the form never had.
  if (parsed.data.completionNote !== undefined) {
    patch.completion_note = parsed.data.completionNote || null;
  }
  // Only sent when adopting a general task. The database is what decides
  // whether that is allowed; sending it on an unchanged product is a no-op
  // there, since the trigger only reacts to an actual change.
  if (parsed.data.productId !== undefined) {
    patch.product_id = parsed.data.productId;
  }

  const {data, error} = await insforge.database
    .from('product_tasks')
    .update(patch)
    .eq('id', taskId)
    .select('id, product_id');

  if (error) return {ok: false, error: mapTaskError(error)};
  if (!data?.length) return {ok: false, error: 'notFound'};

  revalidateTask((data[0].product_id as string | null) ?? null);
  return {ok: true, taskId};
}

// Partial edits for the assistant. Updating just a due date must not overwrite
// a title, assignee or status changed by another person after the read.
export async function patchTaskAction(
  taskId: string,
  input: Partial<z.infer<typeof updateTaskSchema>>
): Promise<TaskActionResult> {
  const parsed = updateTaskSchema.partial().strict().safeParse(input);
  if (!z.string().uuid().safeParse(taskId).success || !parsed.success ||
      !Object.values(parsed.data).some((value) => value !== undefined)) {
    return {ok: false, error: 'invalid'};
  }
  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const columns = {
    title: 'title', notes: 'notes', dueDate: 'due_date', assigneeId: 'assignee_id',
    status: 'status', completionNote: 'completion_note',
    productId: 'product_id'
  } as const;
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(parsed.data) as (keyof typeof columns)[]) {
    const value = parsed.data[key];
    if (value !== undefined) patch[columns[key]] = value === '' ? null : value;
  }
  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database.from('product_tasks')
    .update(patch).eq('id', taskId).select('id, product_id');
  if (error) return {ok: false, error: mapTaskError(error)};
  if (!data?.length) return {ok: false, error: 'notFound'};
  revalidateTask((data[0].product_id as string | null) ?? null);
  return {ok: true, taskId};
}

export async function deleteTaskAction(
  taskId: string
): Promise<TaskActionResult> {
  if (!z.string().uuid().safeParse(taskId).success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const [{data: task}, {data: children}] = await Promise.all([
    insforge.database
      .from('product_tasks')
      .select('product_id')
      .eq('id', taskId)
      .maybeSingle(),
    insforge.database
      .from('product_tasks')
      .select('id')
      .eq('parent_task_id', taskId)
  ]);

  if (!task) return {ok: false, error: 'notFound'};

  const taskIds = [
    taskId,
    ...(children ?? []).map((child) => child.id as string)
  ];
  const {data: attachments} = await insforge.database
    .from('task_attachments')
    .select('storage_key')
    .in('task_id', taskIds);

  const {error} = await insforge.database
    .from('product_tasks')
    .delete()
    .eq('id', taskId);
  if (error) return {ok: false, error: mapTaskError(error)};

  revalidateTask((task.product_id as string | null) ?? null);
  return {
    ok: true,
    taskId,
    storageKeys: (attachments ?? []).map((item) => item.storage_key as string)
  };
}

// ============================================================
// Task detail — the side panel
// ============================================================

export type TaskSubtaskSummary = {
  id: string;
  title: string;
  status: TaskStatus;
  workflow_status: TaskWorkflowStatus;
  due_date: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  release_id: string | null;
  completion_note: string | null;
};

export type TaskDetail = ProductTask & {
  workflow_status: TaskWorkflowStatus;
  product_name: string | null;
  project_name: string | null;
  release_name: string | null;
  assignee_name: string | null;
  created_by_name: string | null;
  completed_by_name: string | null;
  parent: {id: string; title: string} | null;
  subtasks: TaskSubtaskSummary[];
};

export type TaskDetailResult =
  | {
      ok: true;
      task: TaskDetail;
      members: {userId: string; displayName: string}[];
      products: {id: string; name: string}[];
    }
  | {ok: false; error: string};

const TASK_COLUMNS =
  'id, product_id, parent_task_id, title, notes, due_date, assignee_id, status, workflow_status, position, created_by, completed_at, created_at, updated_at, release_id, completion_note, completed_by, project_id';

// Everything the panel shows in one call: the task, its parent and subtasks,
// attachments, the names behind every id, and the option lists its editor
// needs. Read-only.
export async function getTaskDetailAction(taskId: string): Promise<TaskDetailResult> {
  if (!z.string().uuid().safeParse(taskId).success) return {ok: false, error: 'invalid'};
  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const [{data: row}, {data: subtasks}, {data: attachments}, {data: watched}, {data: members}, {data: products}] =
    await Promise.all([
      insforge.database.from('product_tasks').select(TASK_COLUMNS).eq('id', taskId).maybeSingle(),
      insforge.database
        .from('product_tasks')
        .select('id, title, status, workflow_status, due_date, assignee_id, release_id, completion_note')
        .eq('parent_task_id', taskId)
        .order('position', {ascending: true})
        .order('created_at', {ascending: true}),
      insforge.database
        .from('task_attachments')
        .select('id, task_id, storage_url, storage_key, file_name, mime_type, size_bytes, created_at')
        .eq('task_id', taskId)
        .order('created_at', {ascending: true}),
      insforge.database
        .from('task_watchers')
        .select('task_id')
        .eq('task_id', taskId)
        .eq('user_id', caller.user.id),
      insforge.database
        .from('team_members')
        .select('user_id, display_name')
        .eq('is_active', true)
        .order('display_name'),
      insforge.database
        .from('products')
        .select('id, name, archived_at')
        .order('name')
    ]);

  if (!row) return {ok: false, error: 'notFound'};
  const task = row as unknown as Omit<ProductTask, 'attachments' | 'is_watching'> & {
    workflow_status: TaskWorkflowStatus;
  };

  const [parentResult, projectResult, releaseResult] = await Promise.all([
    task.parent_task_id
      ? insforge.database.from('product_tasks').select('id, title').eq('id', task.parent_task_id).maybeSingle()
      : Promise.resolve({data: null}),
    task.project_id
      ? insforge.database.from('projects').select('name').eq('id', task.project_id).maybeSingle()
      : Promise.resolve({data: null}),
    task.release_id
      ? insforge.database.from('product_releases').select('version, name').eq('id', task.release_id).maybeSingle()
      : Promise.resolve({data: null})
  ]);

  const nameOf = new Map(
    (members ?? []).map((member) => [member.user_id as string, member.display_name as string])
  );
  const productName = task.product_id
    ? ((products ?? []).find((product) => product.id === task.product_id)?.name as string | undefined) ?? null
    : null;
  const release = releaseResult.data as Record<string, unknown> | null;

  return {
    ok: true,
    task: {
      ...task,
      attachments: (attachments ?? []) as unknown as TaskAttachment[],
      is_watching: (watched ?? []).length > 0,
      product_name: productName,
      project_name: ((projectResult.data as {name?: string} | null)?.name as string | undefined) ?? null,
      release_name: release
        ? [release.version, release.name].filter(Boolean).join(' · ') || null
        : null,
      assignee_name: task.assignee_id ? nameOf.get(task.assignee_id) ?? null : null,
      created_by_name: nameOf.get(task.created_by) ?? null,
      completed_by_name: task.completed_by ? nameOf.get(task.completed_by) ?? null : null,
      parent: (parentResult.data as {id: string; title: string} | null) ?? null,
      subtasks: ((subtasks ?? []) as unknown as Omit<TaskSubtaskSummary, 'assignee_name'>[]).map((subtask) => ({
        ...subtask,
        assignee_name: subtask.assignee_id ? nameOf.get(subtask.assignee_id) ?? null : null
      }))
    },
    members: (members ?? []).map((member) => ({
      userId: member.user_id as string,
      displayName: member.display_name as string
    })),
    products: (products ?? [])
      .filter((product) => !product.archived_at)
      .map((product) => ({id: product.id as string, name: product.name as string}))
  };
}
