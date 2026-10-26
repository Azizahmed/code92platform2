import {cache} from 'react';

import {createInsForgeServerClient} from '@/lib/insforge/server';
import type {MemberOption, ProductOption} from '@/lib/sales/types';

// Shared option lists for sales forms. Cached per request.

export const getActiveMembers = cache(async (): Promise<MemberOption[]> => {
  const insforge = await createInsForgeServerClient();
  const {data} = await insforge.database
    .from('team_members')
    .select('user_id, display_name')
    .eq('is_active', true)
    // Agents have team_members rows too, but cannot own an account or a deal.
    .eq('kind', 'human')
    .order('display_name');
  return (data ?? []).map((row) => ({
    userId: row.user_id as string,
    displayName: row.display_name as string
  }));
});

export const getActiveProducts = cache(async (): Promise<ProductOption[]> => {
  const insforge = await createInsForgeServerClient();
  const {data} = await insforge.database
    .from('products')
    .select('id, name')
    .is('archived_at', null)
    .order('name');
  return (data ?? []).map((row) => ({id: row.id as string, name: row.name as string}));
});

export const getAccountSectors = cache(async (): Promise<string[]> => {
  const insforge = await createInsForgeServerClient();
  const {data} = await insforge.database
    .from('accounts')
    .select('sector')
    .not('sector', 'is', null);
  return [...new Set((data ?? []).map((row) => row.sector as string))].sort();
});
