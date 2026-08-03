'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';

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
  product_id: string;
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
  attachments: TaskAttachment[];
  // Derived per viewer from task_watchers — not a column. Whoever is looking at
  // the row needs to know whether THEY are following it.
  is_watching: boolean;
};

export type TaskInput = {
  productId: string;
  parentTaskId: string | null;
  title: string;
  notes: string | null;
  dueDate: string | null;
  assigneeId: string | null;
};

type TaskActionResult =
  | {ok: true; taskId: string; storageKeys?: string[]}
  | {ok: false; error: string};

const nullableUuid = z.string().uuid().nullable();
const nullableDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

const createTaskSchema = z.object({
  productId: z.string().uuid(),
  parentTaskId: nullableUuid,
  title: z.string().trim().min(1).max(240),
  notes: z.string().trim().max(5000).nullable(),
  dueDate: nullableDate,
  assigneeId: nullableUuid
});

const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(240),
  notes: z.string().trim().max(5000).nullable(),
  dueDate: nullableDate,
  assigneeId: nullableUuid,
  status: z.enum(['pending', 'completed']),
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

function revalidateProduct(productId: string) {
  revalidatePath(`/[locale]/products/${productId}`, 'page');
  revalidatePath('/[locale]/products', 'page');
  revalidatePath('/[locale]', 'page');
}

export async function createTaskAction(
  input: TaskInput
): Promise<TaskActionResult> {
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalid'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {productId, parentTaskId, title, notes, dueDate, assigneeId} =
    parsed.data;
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
        created_by: caller.user.id
      }
    ])
    .select('id')
    .single();

  if (error || !data) return {ok: false, error: 'generic'};

  revalidateProduct(productId);
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

  const {data, error} = await insforge.database
    .from('product_tasks')
    .update(patch)
    .eq('id', taskId)
    .select('id, product_id');

  if (error) return {ok: false, error: 'generic'};
  if (!data?.length) return {ok: false, error: 'notFound'};

  revalidateProduct(data[0].product_id as string);
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
  if (error) return {ok: false, error: 'generic'};

  revalidateProduct(task.product_id as string);
  return {
    ok: true,
    taskId,
    storageKeys: (attachments ?? []).map((item) => item.storage_key as string)
  };
}
