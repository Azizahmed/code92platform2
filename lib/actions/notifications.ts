'use server';

import {revalidatePath} from 'next/cache';
import {z} from 'zod';

import {getOwnMembership, getSessionUser} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {
  DEFAULT_PREFERENCES,
  NOTIFICATION_PAGE_SIZE,
  type AppNotification,
  type NotificationPreferences
} from '@/lib/notifications';

export type NotificationActionResult =
  | {ok: true}
  | {ok: false; error: string};

export type NotificationFeed = {
  items: AppNotification[];
  unread: number;
};

const uuid = z.string().uuid();

const preferencesSchema = z.object({
  emailEnabled: z.boolean(),
  emailOnAssign: z.boolean(),
  emailOnUpdate: z.boolean()
});

async function requireActiveCaller() {
  const [user, member] = await Promise.all([
    getSessionUser(),
    getOwnMembership()
  ]);
  if (!user || !member?.is_active) return null;
  return {user, member};
}

const NOTIFICATION_COLUMNS =
  'id, type, task_id, product_id, actor_id, title, body, read_at, email_state, created_at';

// The bell polls this. RLS already restricts the table to the caller's own
// rows, so there is no user filter here — adding one would be decoration that
// implies the safety lives in the query.
export async function getNotificationFeedAction(): Promise<NotificationFeed> {
  const caller = await requireActiveCaller();
  if (!caller) return {items: [], unread: 0};

  const insforge = await createInsForgeServerClient();
  const [{data: rows}, {data: unreadRows}] = await Promise.all([
    insforge.database
      .from('notifications')
      .select(NOTIFICATION_COLUMNS)
      .order('created_at', {ascending: false})
      .limit(NOTIFICATION_PAGE_SIZE),
    insforge.database
      .from('notifications')
      .select('id')
      .is('read_at', null)
  ]);

  return {
    items: (rows ?? []) as unknown as AppNotification[],
    unread: (unreadRows ?? []).length
  };
}

export async function markNotificationsReadAction(
  notificationIds?: string[]
): Promise<NotificationActionResult> {
  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const ids = notificationIds?.filter((id) => uuid.safeParse(id).success);
  if (notificationIds && ids?.length !== notificationIds.length) {
    return {ok: false, error: 'invalid'};
  }

  const insforge = await createInsForgeServerClient();
  const readAt = new Date().toISOString();
  let query = insforge.database
    .from('notifications')
    .update({read_at: readAt})
    .is('read_at', null);

  // No ids means "mark everything read" — the button on the panel header.
  if (ids?.length) query = query.in('id', ids);

  const {error} = await query;
  if (error) return {ok: false, error: 'generic'};

  revalidatePath('/[locale]', 'layout');
  return {ok: true};
}

export async function dismissNotificationAction(
  notificationId: string
): Promise<NotificationActionResult> {
  if (!uuid.safeParse(notificationId).success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {error} = await insforge.database
    .from('notifications')
    .delete()
    .eq('id', notificationId);

  if (error) return {ok: false, error: 'generic'};

  revalidatePath('/[locale]', 'layout');
  return {ok: true};
}

// ============================================================
// Watching
// ============================================================

export async function setTaskWatchAction(
  taskId: string,
  watching: boolean
): Promise<NotificationActionResult> {
  if (!uuid.safeParse(taskId).success) {
    return {ok: false, error: 'invalid'};
  }

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();

  if (watching) {
    // The RLS policy pins user_id to the caller, so the id here cannot be used
    // to sign someone else up.
    const {error} = await insforge.database
      .from('task_watchers')
      .insert([{task_id: taskId, user_id: caller.user.id}]);
    // Already watching is the outcome the caller wanted, not a failure.
    if (error && !String(error.message ?? '').includes('duplicate key')) {
      return {ok: false, error: 'generic'};
    }
  } else {
    const {error} = await insforge.database
      .from('task_watchers')
      .delete()
      .eq('task_id', taskId)
      .eq('user_id', caller.user.id);
    if (error) return {ok: false, error: 'generic'};
  }

  revalidatePath('/[locale]/tasks', 'page');
  revalidatePath('/[locale]/products', 'page');
  return {ok: true};
}

// ============================================================
// Preferences
// ============================================================

export async function getNotificationPreferencesAction(): Promise<NotificationPreferences> {
  const caller = await requireActiveCaller();
  if (!caller) return DEFAULT_PREFERENCES;

  const insforge = await createInsForgeServerClient();
  const {data} = await insforge.database
    .from('notification_preferences')
    .select('email_enabled, email_on_assign, email_on_update')
    .eq('user_id', caller.user.id)
    .maybeSingle();

  // No row is the common case, not an error: preferences are created the first
  // time somebody changes one.
  if (!data) return DEFAULT_PREFERENCES;
  return {
    email_enabled: Boolean(data.email_enabled),
    email_on_assign: Boolean(data.email_on_assign),
    email_on_update: Boolean(data.email_on_update)
  };
}

export async function saveNotificationPreferencesAction(input: {
  emailEnabled: boolean;
  emailOnAssign: boolean;
  emailOnUpdate: boolean;
}): Promise<NotificationActionResult> {
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return {ok: false, error: 'invalid'};

  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const row = {
    user_id: caller.user.id,
    email_enabled: parsed.data.emailEnabled,
    email_on_assign: parsed.data.emailOnAssign,
    email_on_update: parsed.data.emailOnUpdate
  };

  // No upsert: the client holds INSERT and a column-scoped UPDATE, and an
  // upsert would need both to be expressible in one grant. Update first, and
  // insert only when there was nothing to update.
  const {data: updated, error: updateError} = await insforge.database
    .from('notification_preferences')
    .update({
      email_enabled: row.email_enabled,
      email_on_assign: row.email_on_assign,
      email_on_update: row.email_on_update
    })
    .eq('user_id', caller.user.id)
    .select('user_id');

  if (updateError) return {ok: false, error: 'generic'};

  if (!updated?.length) {
    const {error: insertError} = await insforge.database
      .from('notification_preferences')
      .insert([row]);
    if (insertError) return {ok: false, error: 'generic'};
  }

  revalidatePath('/[locale]/settings', 'page');
  return {ok: true};
}

// ============================================================
// Email drain
// ============================================================

export type EmailDrainResult =
  | {ok: true; sent: number; failed: number}
  | {ok: false; error: string};

// Mirroring the GitHub pattern: the notification row exists the moment the
// task changes, and email is a SECOND round trip the client makes afterwards.
// Inline sending would make every task edit wait on SES, and fire-and-forget
// does not survive a serverless function returning.
//
// Nothing is lost if this call never happens: the rows stay 'pending' and the
// next drain — from anybody's task edit — picks them up.
export async function drainNotificationEmailsAction(): Promise<EmailDrainResult> {
  const caller = await requireActiveCaller();
  if (!caller) return {ok: false, error: 'forbidden'};

  const insforge = await createInsForgeServerClient();
  const {data, error} = await insforge.functions.invoke('notify-email', {
    body: {}
  });

  if (error) return {ok: false, error: 'generic'};

  const payload = data as {sent?: number; failed?: number} | null;
  return {
    ok: true,
    sent: payload?.sent ?? 0,
    failed: payload?.failed ?? 0
  };
}
