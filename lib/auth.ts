import {cache} from 'react';
import {getLocale} from 'next-intl/server';

import {redirect} from '@/i18n/navigation';
import {createInsForgeServerClient} from '@/lib/insforge/server';

export type SessionUser = {
  id: string;
  email: string | null;
};

export type TeamMember = {
  user_id: string;
  display_name: string;
  role: 'admin' | 'member';
  is_active: boolean;
};

// Cached per request so layout + page can both ask without extra round-trips.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.auth.getCurrentUser();
  if (error || !data?.user) return null;
  return {id: data.user.id, email: data.user.email ?? null};
});

// The caller's own team_members row. RLS always lets a user read their own
// row (needed for the "awaiting approval" state); inactive users get nothing
// else from the database.
export const getOwnMembership = cache(
  async (): Promise<TeamMember | null> => {
    const user = await getSessionUser();
    if (!user) return null;

    const insforge = await createInsForgeServerClient();
    const {data, error} = await insforge.database
      .from('team_members')
      .select('user_id, display_name, role, is_active')
      .eq('user_id', user.id)
      .limit(1);
    if (error || !data?.length) return null;
    return data[0] as TeamMember;
  }
);

// Gate for authenticated pages: signed-out users and signed-in users whose
// membership row is missing or inactive are sent to /login (which shows the
// sign-in form or the "awaiting approval" state respectively).
export async function requireActiveMember(): Promise<{
  user: SessionUser;
  member: TeamMember;
}> {
  const locale = await getLocale();
  const user = await getSessionUser();
  const member = user ? await getOwnMembership() : null;

  if (!user || !member?.is_active) {
    redirect({href: '/login', locale});
    // redirect() throws NEXT_REDIRECT; this only satisfies the type checker.
    throw new Error('unreachable');
  }

  return {user, member};
}
