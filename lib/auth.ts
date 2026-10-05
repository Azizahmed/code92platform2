import {cache} from 'react';
import {cookies} from 'next/headers';
import {getLocale} from 'next-intl/server';

import {redirect} from '@/i18n/navigation';
import {createInsForgeServerClient, hasRequestAccessToken} from '@/lib/insforge/server';

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

type MeRow = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: 'admin' | 'member' | null;
  is_active: boolean;
};

// Identity + membership in ONE round trip.
//
// This used to be two sequential calls: auth.getCurrentUser() (which is a
// network GET to /api/auth/sessions/current in server mode) purely to learn
// the caller's id, and only then a team_members lookup keyed by that id.
// Nothing else on the page could start until both had finished, so every
// render and every server action paid two serial backend round trips up
// front. get_me() resolves identity server-side from auth.uid() instead.
//
// Cached per request, so layout, page, and any server action in the same
// request all share the single call.
const getMe = cache(async (): Promise<MeRow | null> => {
  if (!hasRequestAccessToken()) {
    const cookieStore = await cookies();
    if (
      !cookieStore.has('insforge_access_token') &&
      !cookieStore.has('insforge_refresh_token')
    ) {
      return null;
    }
  }

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.database.rpc('get_me');
  if (error) return null;

  // Set-returning function: PostgREST hands back an array of rows.
  const row = (Array.isArray(data) ? data[0] : data) as MeRow | undefined;
  return row ?? null;
});

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const me = await getMe();
  if (!me) return null;
  return {id: me.user_id, email: me.email};
});

// The caller's own team_members row, or null when they have not been added to
// the team yet. Signed-in-but-unlisted users still resolve a SessionUser, so
// the login screen can tell "awaiting approval" apart from "signed out".
export const getOwnMembership = cache(async (): Promise<TeamMember | null> => {
  const me = await getMe();
  // get_me() LEFT JOINs team_members; a null display_name means no row.
  if (!me || me.display_name === null || me.role === null) return null;

  return {
    user_id: me.user_id,
    display_name: me.display_name,
    role: me.role,
    is_active: me.is_active
  };
});

// Gate for authenticated pages: signed-out users and signed-in users whose
// membership row is missing or inactive are sent to /login (which shows the
// sign-in form or the "awaiting approval" state respectively).
export async function requireActiveMember(): Promise<{
  user: SessionUser;
  member: TeamMember;
}> {
  const locale = await getLocale();
  const [user, member] = await Promise.all([
    getSessionUser(),
    getOwnMembership()
  ]);

  if (!user || !member?.is_active) {
    redirect({href: '/login', locale});
    // redirect() throws NEXT_REDIRECT; this only satisfies the type checker.
    throw new Error('unreachable');
  }

  return {user, member};
}
