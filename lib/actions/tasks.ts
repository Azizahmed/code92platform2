'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {LIFECYCLE_PHASES, type LifecyclePhase} from '@/lib/lifecycle';

export type TaskStatus = 'pending' | 'completed';

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
  // Which delivery phase this work serves. Only ever set on a product task: the
  // phase names a row in product_lifecycle_phases, which is keyed by product.
  lifecycle_phase: LifecyclePhase | null;
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
  lifecyclePhase?: LifecyclePhase | null;
};

type TaskActionResult =
  | {ok: true; taskId: string; storageKeys?: string[]}
  | {ok: false; error: string};

const nullableUuid = z.string().uuid().nullable();
const nullableDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

const nullablePhase = z.enum(LIFECYCLE_PHASES).nullable();

const createTaskSchema = z
  .object({
    productId: nullableUuid,
    parentTaskId: nullableUuid,
    title: z.string().trim().min(1).max(240),
    notes: z.string().trim().max(5000).nullable(),
    dueDate: nullableDate,
    assigneeId: nullableUuid,
    lifecyclePhase: nullablePhase.optional()
  })
  // Mirrors the product_tasks_lifecycle_phase_needs_product CHECK. Caught here
  // so the form gets 'phaseNeedsProduct' rather than a constraint name.
  .refine((value) => !value.lifecyclePhase || value.productId !== null, {
    path: ['lifecyclePhase']
  });

const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(240),
  notes: z.string().trim().max(5000).nullable(),
  dueDate: nullableDate,
  assigneeId: nullableUuid,
  status: z.enum(['pending', 'completed']),
  // Both optional for the same reason as completionNote below: `undefined`
  // means "leave it alone". The status toggle sends neither.
  lifecyclePhase: nullablePhase.optional(),
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
  if (message.includes('general task cannot join a release')) return 'inRelease';
  if (message.includes('parent task must belong')) return 'parentMismatch';
  if (message.includes('one subtask level only')) return 'tooDeep';
  if (message.includes('parent task not found')) return 'notFound';
  if (message.includes('lifecycle_phase_needs_product')) return 'phaseNeedsProduct';
  if (message.includes('lifecycle_phase_known')) return 'invalid';
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
    lifecyclePhase
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
        lifecycle_phase: lifecyclePhase ?? null,
        created_by: caller.user.id
      }
    ])
    .select('id')
    .single();

  if (error) return {ok: false, error: mapTaskError(error)};
  if (!data) return {ok: false, error: 'generic'};

  revalidateTask(productId);
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
    lifecyclePhase?: LifecyclePhase | null;
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
  if (parsed.data.lifecyclePhase !== undefined) {
    patch.lifecycle_phase = parsed.data.lifecyclePhase;
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
