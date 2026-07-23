'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getOwnMembership} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';

// `error` is a message key under the `admin.errors` namespace, never a raw
// backend message — Server Actions must only return safe app data.
export type AdminActionResult = {ok: true} | {ok: false; error: string};

const setMemberSchema = z.object({
  target: z.string().uuid(),
  newRole: z.enum(['admin', 'member']),
  newActive: z.boolean()
});

// Map the admin_set_member RPC's known failure messages to safe message keys.
function mapRpcError(message: string): string {
  if (message.includes('last active admin')) return 'lastAdmin';
  if (message.includes('only admins')) return 'notAdmin';
  if (message.includes('not found')) return 'notFound';
  if (message.includes('invalid role')) return 'invalidRole';
  return 'generic';
}

// Role/activation changes go exclusively through the admin_set_member RPC
// (SECURITY DEFINER, admin-only, protects the last active admin).
export async function setMemberAction(input: {
  target: string;
  newRole: 'admin' | 'member';
  newActive: boolean;
}): Promise<AdminActionResult> {
  const parsed = setMemberSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'generic'};

  const member = await getOwnMembership();
  if (member?.role !== 'admin' || !member.is_active) {
    return {ok: false, error: 'notAdmin'};
  }

  const insforge = await createInsForgeServerClient();
  const {error} = await insforge.database.rpc('admin_set_member', {
    target: parsed.data.target,
    new_role: parsed.data.newRole,
    new_active: parsed.data.newActive
  });
  if (error) return {ok: false, error: mapRpcError(error.message ?? '')};

  revalidatePath('/[locale]/admin', 'page');
  return {ok: true};
}

export type ScanNowResult =
  | {
      ok: true;
      status: string;
      productsScanned: number;
      itemsInserted: number;
      itemsLinked: number;
    }
  | {ok: false; error: string};

// Manual "Scan now": invokes the deployed trend-scan edge function with the
// admin's own JWT (the function rejects non-admins independently).
export async function scanNowAction(): Promise<ScanNowResult> {
  const member = await getOwnMembership();
  if (member?.role !== 'admin' || !member.is_active) {
    return {ok: false, error: 'notAdmin'};
  }

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.functions.invoke('trend-scan', {
    method: 'POST',
    headers: {'x-trigger': 'admin-scan-now'}
  });

  const body = (data ?? {}) as Record<string, unknown>;
  if (error || typeof body.error === 'string') {
    const message = `${error?.message ?? ''} ${body.error ?? ''}`;
    const unauthorized = message.includes('401') || /unauthorized/i.test(message);
    return {ok: false, error: unauthorized ? 'scanUnauthorized' : 'scanFailed'};
  }

  revalidatePath('/[locale]/admin', 'page');
  return {
    ok: true,
    status: typeof body.status === 'string' ? body.status : 'success',
    productsScanned: Number(body.products_scanned ?? 0),
    itemsInserted: Number(body.items_inserted ?? 0),
    itemsLinked: Number(body.items_linked ?? 0)
  };
}
