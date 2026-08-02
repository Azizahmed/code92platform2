// Shared notification vocabulary. No 'use server', so client components can
// import the constants and types directly.
//
// Mirrors migrations/20260803091000_add-task-notifications.sql. The trigger
// there is the only writer, so these types describe rows the app reads and
// never composes.

export const NOTIFICATION_TYPES = [
  'task_assigned',
  'task_unassigned',
  'task_updated',
  'task_completed',
  'task_reopened'
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const EMAIL_STATES = ['skipped', 'pending', 'sent', 'failed'] as const;
export type EmailState = (typeof EMAIL_STATES)[number];

export type AppNotification = {
  id: string;
  type: NotificationType;
  task_id: string | null;
  product_id: string | null;
  actor_id: string | null;
  title: string;
  body: string | null;
  read_at: string | null;
  email_state: EmailState;
  created_at: string;
};

export type NotificationPreferences = {
  email_enabled: boolean;
  email_on_assign: boolean;
  email_on_update: boolean;
};

// What a person gets when they have never opened the preferences panel: the
// bell, and nothing in their inbox. Matches the column defaults, and the
// coalesce() in enqueue_task_notification().
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  email_enabled: false,
  email_on_assign: true,
  email_on_update: true
};

// How many the bell loads at a time. The panel is a recent-activity list, not
// an archive: past this you are looking for the task itself.
export const NOTIFICATION_PAGE_SIZE = 20;

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}
