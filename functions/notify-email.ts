// notify-email: delivers the notifications that asked to be emailed.
//
// The database trigger product_tasks_notify() writes a notification row the
// moment a task changes and marks it email_state='pending' when the recipient
// has opted in. It does NOT send anything — a task edit must not wait on SES,
// and must not fail because SES is down.
//
// This function is the drain. It is invoked as a second round trip from the
// app after a task mutation (lib/actions/notifications.ts), and it is
// idempotent-ish by construction: every row it picks up is claimed before the
// send, so two concurrent drains cannot both send the same notification.
//
// Recipients' email addresses are never stored in public.notifications. They
// are resolved here, from auth.users, through the admin client — the app has no
// path to another member's address, and this keeps it that way.

// The SDK arrives through Deno's npm: specifier and this directory is excluded
// from tsconfig.json, so no local types exist for these clients. `any` is an
// accurate description of what is knowable here, not a shortcut.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient, createAdminClient } from 'npm:@insforge/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// One drain handles a burst comfortably and stays well inside both the
// function timeout and the hourly SES cap. Anything left over is picked up by
// the next drain — the rows do not expire.
const BATCH_SIZE = 25;

const APP_NAME = 'Code 92 Command Center';
const APP_URL = 'https://5nteb3xb.insforge.site';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SUBJECTS: Record<string, string> = {
  task_assigned: 'You were assigned a task',
  task_unassigned: 'A task was reassigned',
  task_updated: 'A task you follow was updated',
  task_completed: 'A task you follow was completed',
  task_reopened: 'A task you follow was reopened',
  task_due: 'Due today',
  task_overdue: 'Overdue',
  deal_assigned: 'You own a deal',
  deal_due: 'Next action due today',
  deal_overdue: 'Next action overdue',
  deal_closed: 'A deal closed',
  account_assigned: 'You own an account',
  account_archived: 'An account was archived',
};

// Where each notification leads. Mirrors notificationHref() in
// lib/notifications.ts — change both together.
function linkFor(row: any): { href: string; label: string } {
  if (row.deal_id) return { href: `${APP_URL}/en/sales/deals/${row.deal_id}`, label: 'Open the deal' };
  if (row.account_id) return { href: `${APP_URL}/en/sales/accounts/${row.account_id}`, label: 'Open the account' };
  if (row.task_id && row.product_id) {
    return { href: `${APP_URL}/en/products/${row.product_id}#task-${row.task_id}`, label: 'Open the task' };
  }
  return { href: `${APP_URL}/en/tasks`, label: 'Open the task' };
}

// Deliberately plain. This is an internal notification, not a campaign: the
// less markup it carries the less likely it is to be filed as spam by a cold
// SES tenant, and the more likely it is to render in whatever client the
// recipient actually uses.
function renderEmail(rows: any[]): { subject: string; html: string } {
  const single = rows.length === 1;
  const subject = single
    ? `${SUBJECTS[rows[0].type] ?? 'Update'}: ${rows[0].title}`
    : `${rows.length} updates on ${APP_NAME}`;

  const items = rows
    .map((row) => {
      const link = linkFor(row);
      return [
        '<li style="margin:0 0 14px 0">',
        `<div style="font-weight:600">${escapeHtml(row.title)}</div>`,
        row.body ? `<div style="color:#555">${escapeHtml(row.body)}</div>` : '',
        `<a href="${link.href}" style="color:#0b6">${link.label}</a>`,
        '</li>',
      ].join('');
    })
    .join('');

  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5">',
    `<p>${single ? 'There is an update on work you own or follow.' : 'There are updates on work you own or follow.'}</p>`,
    `<ul style="padding-left:18px">${items}</ul>`,
    `<p style="color:#888;font-size:12px">You are receiving this because email is switched on in your ${escapeHtml(APP_NAME)} settings, or because it is a due-date reminder for work you own. Change what you receive under Settings → Notifications.</p>`,
    '</div>',
  ].join('');

  return { subject, html };
}

// The SDK exposes emails.send on recent versions; the REST endpoint is the
// documented fallback. Trying the SDK first means we get its error shape when
// it exists rather than hand-parsing a response.
async function sendEmail(
  client: any,
  baseUrl: string,
  to: string,
  subject: string,
  html: string,
): Promise<string | null> {
  if (client?.emails?.send) {
    const { error } = await client.emails.send({ to, subject, html, from: APP_NAME });
    return error ? String(error.message ?? error) : null;
  }

  const anonKey = Deno.env.get('ANON_KEY');
  if (!anonKey) return 'email is not configured: no ANON_KEY available';

  const response = await fetch(`${baseUrl}/api/email/send-raw`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to, subject, html, from: APP_NAME }),
  });

  if (response.ok) return null;
  const text = await response.text().catch(() => '');
  return `${response.status}: ${text.slice(0, 300)}`;
}

async function resolveCaller(req: Request, admin: any, baseUrl: string): Promise<string | null> {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  try {
    const userClient = createClient({ baseUrl, accessToken: token });
    const { data } = await userClient.auth.getCurrentUser();
    const userId = data?.user?.id;
    if (!userId) return null;

    const { data: members } = await admin.database
      .from('team_members')
      .select('is_active')
      .eq('user_id', userId)
      .limit(1);
    return members?.[0]?.is_active === true ? userId : null;
  } catch {
    return null;
  }
}

export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const baseUrl = Deno.env.get('INSFORGE_BASE_URL')!;
  const admin = createAdminClient({ baseUrl, apiKey: Deno.env.get('API_KEY')! });

  // Two callers. The InsForge schedule, holding CRON_SECRET, runs the daily
  // pass: generate today's due and overdue reminders, then drain. Any active
  // member may trigger a plain drain — it sends nothing of the caller's
  // choosing (the queue decides who gets what), so that gate only keeps
  // anonymous traffic from spinning the mailer.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const cronSecret = Deno.env.get('CRON_SECRET');
  const isSchedule = Boolean(cronSecret) && token === cronSecret;
  if (!isSchedule) {
    const caller = await resolveCaller(req, admin, baseUrl);
    if (!caller) {
      return jsonResponse({ error: { code: 'forbidden', message: 'Unauthorized' } }, 401);
    }
  }

  let enqueued = 0;
  if (isSchedule) {
    const body = await req.json().catch(() => ({}));
    if (body?.mode === 'daily') {
      const { data: count, error: dueError } = await admin.database.rpc('notification_enqueue_due');
      if (dueError) {
        return jsonResponse(
          { error: { code: 'generic', message: `due generation failed: ${dueError.message}` } },
          500,
        );
      }
      enqueued = typeof count === 'number' ? count : 0;
    }
  }

  const { data: pending, error: queueError } = await admin.database
    .from('notifications')
    .select('id, user_id, type, task_id, product_id, deal_id, account_id, title, body')
    .eq('email_state', 'pending')
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (queueError) {
    return jsonResponse(
      { error: { code: 'generic', message: `queue read failed: ${queueError.message}` } },
      500,
    );
  }

  const rows = pending ?? [];
  if (rows.length === 0) return jsonResponse({ enqueued, sent: 0, failed: 0, skipped: 0 });

  // Claim the batch before sending. If two drains overlap, the second finds
  // these rows already out of 'pending' and does nothing with them — better a
  // notification that silently misses its email than one delivered twice.
  const claimed: any[] = [];
  for (const row of rows) {
    const { data: updated } = await admin.database
      .from('notifications')
      .update({ email_state: 'sending' })
      .eq('id', row.id)
      .eq('email_state', 'pending')
      .select('id');
    if (updated?.length) claimed.push(row);
  }

  if (claimed.length === 0) return jsonResponse({ sent: 0, failed: 0, skipped: rows.length });

  // One email per person, however many notifications they accumulated. Five
  // separate messages about the same afternoon is how a notification system
  // teaches people to filter it into a folder they never open.
  const byUser = new Map<string, any[]>();
  for (const row of claimed) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }

  // Addresses come from a SECURITY DEFINER function rather than an SDK admin
  // call: auth.users is not readable through PostgREST, and
  // notification_email_targets() only answers for users who actually have mail
  // queued, so it cannot double as a team directory.
  const { data: targets } = await admin.database.rpc('notification_email_targets', {
    p_user_ids: [...byUser.keys()],
  });
  const emailByUser = new Map<string, string>(
    (targets ?? []).map((row: any) => [row.user_id, row.email]),
  );

  let sent = 0;
  let failed = 0;

  for (const [userId, userRows] of byUser) {
    const ids = userRows.map((row) => row.id);
    let failure: string | null = null;
    const email = emailByUser.get(userId) ?? null;

    if (!email) {
      failure = 'no email address on file for this user';
    } else {
      const { subject, html } = renderEmail(userRows);
      failure = await sendEmail(admin, baseUrl, email, subject, html);
    }

    if (failure) {
      failed += ids.length;
      await admin.database
        .from('notifications')
        .update({ email_state: 'failed', email_error: failure.slice(0, 500) })
        .in('id', ids);
    } else {
      sent += ids.length;
      await admin.database
        .from('notifications')
        .update({
          email_state: 'sent',
          email_sent_at: new Date().toISOString(),
          email_error: null,
        })
        .in('id', ids);
    }
  }

  return jsonResponse({ enqueued, sent, failed, skipped: rows.length - claimed.length });
}
