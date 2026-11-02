'use server';

import {z} from 'zod';

import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';

export type SearchHit =
  | {kind: 'task'; id: string; title: string; detail: string | null; done: boolean}
  | {kind: 'product'; id: string; title: string; detail: string | null}
  | {kind: 'project'; id: string; title: string; detail: string | null}
  | {kind: 'channel'; id: string; title: string; detail: string | null};

// PostgREST filter values cannot carry its own syntax characters; a search box
// only needs words, so everything else becomes a space.
function cleanQuery(value: string): string {
  return value.replace(/[%_*,()."'\\:]/g, ' ').replace(/\s+/g, ' ').trim();
}

// The command palette's lookup: a handful of matches per kind, read with the
// caller's own session so RLS decides what they can find. Read-only.
export async function commandSearchAction(
  query: string,
  locale: string
): Promise<{ok: true; hits: SearchHit[]} | {ok: false}> {
  const parsed = z.string().max(120).safeParse(query);
  if (!parsed.success) return {ok: false};
  const q = cleanQuery(parsed.data);
  if (q.length < 2) return {ok: true, hits: []};

  const [user, member] = await Promise.all([getSessionUser(), getOwnMembership()]);
  if (!user || !member?.is_active) return {ok: false};

  const insforge = await createInsForgeServerClient();
  const pattern = `%${q}%`;
  const [tasks, products, projects, channels] = await Promise.all([
    insforge.database
      .from('product_tasks')
      .select('id, title, status, product_id, due_date')
      .ilike('title', pattern)
      .order('status', {ascending: false})
      .order('updated_at', {ascending: false})
      .limit(6),
    insforge.database
      .from('products')
      .select('id, name, business_stage')
      .is('archived_at', null)
      .ilike('name', pattern)
      .order('name')
      .limit(4),
    insforge.database.from('projects').select('id, name, phase').ilike('name', pattern).order('name').limit(4),
    insforge.database
      .from('channels')
      .select('id, name, name_ar, kind')
      .is('archived_at', null)
      .neq('kind', 'dm')
      // Arabic text searches the Arabic name; anything else the English one.
      .ilike(/[\u0600-\u06FF]/.test(q) ? 'name_ar' : 'name', pattern)
      .order('name')
      .limit(4)
  ]);

  const productNames = new Map<string, string>();
  const taskProductIds = [
    ...new Set((tasks.data ?? []).map((task) => task.product_id as string | null).filter(Boolean) as string[])
  ];
  if (taskProductIds.length > 0) {
    const {data} = await insforge.database.from('products').select('id, name').in('id', taskProductIds);
    for (const row of data ?? []) productNames.set(row.id as string, row.name as string);
  }

  const hits: SearchHit[] = [
    ...(tasks.data ?? []).map((task) => ({
      kind: 'task' as const,
      id: task.id as string,
      title: task.title as string,
      detail: task.product_id ? productNames.get(task.product_id as string) ?? null : null,
      done: task.status === 'completed'
    })),
    ...(products.data ?? []).map((product) => ({
      kind: 'product' as const,
      id: product.id as string,
      title: product.name as string,
      detail: (product.business_stage as string | null) ?? null
    })),
    ...(projects.data ?? []).map((project) => ({
      kind: 'project' as const,
      id: project.id as string,
      title: project.name as string,
      detail: (project.phase as string | null) ?? null
    })),
    ...(channels.data ?? []).map((channel) => ({
      kind: 'channel' as const,
      id: channel.id as string,
      title: ((locale === 'ar' && channel.name_ar) || channel.name) as string,
      detail: null
    }))
  ];
  return {ok: true, hits};
}
