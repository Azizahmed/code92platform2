'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {drainEmailsAfterResponse} from '@/lib/email-drain';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {WORKFLOW_STATUSES, type WorkflowStatus} from '@/lib/my-work';

export type MyWorkActionResult =
  | {ok: true; taskId: string}
  | {ok: false; error: string};

async function requireActiveCaller() {
  const [user, member] = await Promise.all([
    getSessionUser(),
    getOwnMembership()
  ]);
  if (!user || !member?.is_active) return null;
  return {user, member};
}

function revalidateMyWork(productId: string | null) {
  revalidatePath('/[locale]/my-work', 'page');
  revalidatePath('/[locale]/tasks', 'page');
  if (productId) revalidatePath(`/[locale]/products/${productId}`, 'page');
}

// Kanban move. validate_product_task() keeps status and completed_at in step,
// so moving a card to Done completes the task in its product record, and the
// existing notification trigger tells its watchers.
export async function setTaskWorkflowStatusAction(
  taskId: string,
  status: WorkflowStatus
): Promise<MyWorkActionResult> {
  if (
    !z.string().uuid().safeParse(taskId).success ||
    !(WORKFLOW_STATUSES as readonly string[]).includes(status)
  ) {
    return {ok: false, error: 'invalid'};
  }
  if (!(await requireActiveCaller())) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('product_tasks')
    .update({workflow_status: status})
    .eq('id', taskId)
    .select('id, product_id');

  if (error) return {ok: false, error: 'generic'};
  if (!data?.length) return {ok: false, error: 'notFound'};

  revalidateMyWork((data[0].product_id as string | null) ?? null);
  // Done completes the task, which notifies its watchers.
  if (status === 'done') drainEmailsAfterResponse();
  return {ok: true, taskId};
}

const quickCaptureSchema = z.object({
  title: z.string().trim().min(1).max(240),
  productId: z.string().uuid().nullable(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
});

// Quick capture: always assigned to the caller; product defaults to General.
export async function quickCaptureTaskAction(input: {
  title: string;
  productId: string | null;
  dueDate: string | null;
}): Promise<MyWorkActionResult> {
  const parsed = quickCaptureSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalid'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database
    .from('product_tasks')
    .insert([
      {
        product_id: parsed.data.productId,
        title: parsed.data.title,
        due_date: parsed.data.dueDate,
        assignee_id: caller.user.id,
        created_by: caller.user.id
      }
    ])
    .select('id')
    .single();

  if (error || !data) return {ok: false, error: 'generic'};

  revalidateMyWork(parsed.data.productId);
  return {ok: true, taskId: data.id as string};
}
