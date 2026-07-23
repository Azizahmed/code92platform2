'use server';

import {cookies} from 'next/headers';
import {createAuthActions} from '@insforge/sdk/ssr';
import {z} from 'zod';

import {createInsForgeServerClient} from '@/lib/insforge/server';

// `error` is a message key under the `auth.errors` namespace, never a raw
// backend message — Server Actions must only return safe app data.
export type AuthActionResult = {ok: true} | {ok: false; error: string};

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const signUpSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(1).max(80)
});

export async function signInAction(input: {
  email: string;
  password: string;
}): Promise<AuthActionResult> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalidCredentials'};

  const auth = createAuthActions({cookies: await cookies()});
  const {data, error} = await auth.signInWithPassword(parsed.data);
  if (error || !data?.user) return {ok: false, error: 'invalidCredentials'};

  return {ok: true};
}

export async function signUpAction(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<AuthActionResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'generic'};

  const {email, password, displayName} = parsed.data;
  const auth = createAuthActions({cookies: await cookies()});
  // Email verification is disabled: a successful sign-up establishes a
  // session immediately, so the follow-up insert runs under the new user.
  const {data, error} = await auth.signUp({email, password, name: displayName});
  if (error || !data?.user) return {ok: false, error: 'generic'};

  // Signup is open but data access is gated on an active team_members row;
  // RLS allows self-insert of user_id + display_name only, is_active stays
  // false until an admin activates the account.
  const insforge = await createInsForgeServerClient();
  const {error: insertError} = await insforge.database
    .from('team_members')
    .insert([{user_id: data.user.id, display_name: displayName}]);
  if (insertError) return {ok: false, error: 'generic'};

  return {ok: true};
}

export async function signOutAction(): Promise<void> {
  const auth = createAuthActions({cookies: await cookies()});
  await auth.signOut();
}
