'use client';

import {useCallback, useEffect, useRef, useState, useTransition} from 'react';
import {createPortal} from 'react-dom';
import {
  AlarmClock,
  Archive,
  AtSign,
  Bell,
  Building2,
  CalendarClock,
  Handshake,
  CheckCheck,
  CircleCheck,
  CircleDot,
  MessagesSquare,
  RotateCcw,
  Sparkles,
  UserRoundPlus,
  UserRoundX,
  X
} from 'lucide-react';
import {useTranslations} from 'next-intl';

import RelativeTime from '@/components/RelativeTime';
import {Link, usePathname} from '@/i18n/navigation';
import {
  dismissNotificationAction,
  getNotificationFeedAction,
  markNotificationsReadAction
} from '@/lib/actions/notifications';
import {
  notificationHref,
  type AppNotification,
  type NotificationType
} from '@/lib/notifications';

// How often the bell asks for new items while the tab is open. Notifications
// here are minutes-matter, not seconds-matter — a task was reassigned, a due
// date moved — so a minute is responsive enough to be useful and quiet enough
// not to be a background job. Realtime would be the alternative, but the
// project keeps realtime retention at zero, so there is nothing to subscribe to.
const POLL_INTERVAL_MS = 60_000;

const TYPE_ICONS: Record<NotificationType, typeof Bell> = {
  task_assigned: UserRoundPlus,
  task_unassigned: UserRoundX,
  task_updated: CircleDot,
  task_completed: CircleCheck,
  task_reopened: RotateCcw,
  mention: AtSign,
  channel_message: MessagesSquare,
  proposal_pending: Sparkles,
  proposal_decided: Sparkles,
  task_due: CalendarClock,
  task_overdue: AlarmClock,
  deal_assigned: Handshake,
  deal_due: CalendarClock,
  deal_overdue: AlarmClock,
  deal_closed: CircleCheck,
  account_assigned: Building2,
  account_archived: Archive
};

function NotificationRow({
  item,
  onDismiss,
  onNavigate
}: {
  item: AppNotification;
  onDismiss: (id: string) => void;
  onNavigate: () => void;
}) {
  const t = useTranslations('notifications');
  const Icon = TYPE_ICONS[item.type] ?? Bell;
  const unread = item.read_at === null;
  const href = notificationHref(item);

  const body = (
    <>
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
          unread
            ? 'border-accent/30 bg-accent/10 text-accent'
            : 'border-hairline bg-raised text-faint'
        }`}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm ${
            unread ? 'font-medium text-ink' : 'text-muted'
          }`}
        >
          {item.title}
        </span>
        {item.body ? (
          <span className="mt-0.5 block truncate text-[11px] text-faint">
            {item.body}
          </span>
        ) : null}
        <span className="mt-0.5 block text-[10px] text-faint">
          <RelativeTime date={item.created_at} />
        </span>
      </span>
    </>
  );

  return (
    <li className="group/row flex items-start gap-1">
      {href ? (
        <Link
          href={href}
          onClick={onNavigate}
          className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-raised"
        >
          {body}
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-start gap-2.5 px-2 py-2">
          {body}
        </span>
      )}
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label={t('dismiss')}
        title={t('dismiss')}
        className="mt-2 shrink-0 rounded p-1.5 text-faint opacity-0 transition-opacity hover:bg-raised hover:text-ink focus:opacity-100 group-hover/row:opacity-100"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </li>
  );
}

export default function NotificationBell() {
  const t = useTranslations('notifications');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    const feed = await getNotificationFeedAction();
    setItems(feed.items);
    setUnread(feed.unread);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      // Nothing to refresh into a tab nobody is looking at, and polling a
      // backgrounded tab for hours is how a quiet feature becomes an expensive
      // one. AppShell renders desktop and mobile bells together; CSS hides one,
      // so only the visible instance should issue the request.
      if (
        document.visibilityState !== 'visible' ||
        !triggerRef.current ||
        triggerRef.current.getClientRects().length === 0
      ) {
        return;
      }
      refresh().catch(() => {
        if (!cancelled) setLoaded(true);
      });
    };

    tick();
    const timer = window.setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('resize', tick);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('resize', tick);
    };
  }, [pathname, refresh]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  function markAllRead() {
    startTransition(async () => {
      setUnread(0);
      setItems((current) =>
        current.map((item) =>
          item.read_at ? item : {...item, read_at: new Date().toISOString()}
        )
      );
      await markNotificationsReadAction();
    });
  }

  function dismiss(id: string) {
    startTransition(async () => {
      setItems((current) => current.filter((item) => item.id !== id));
      await dismissNotificationAction(id);
      await refresh();
    });
  }

  function openPanel() {
    setOpen(true);
    refresh().catch(() => undefined);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-expanded={open}
        aria-label={
          unread > 0 ? t('bell.labelWithCount', {count: unread}) : t('bell.label')
        }
        title={t('bell.label')}
        className="relative rounded-md border border-hairline p-2 text-muted transition-colors hover:bg-raised hover:text-ink"
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} />
        {unread > 0 ? (
          <span className="absolute -top-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] font-semibold text-bg">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {/* Portalled to <body>: both hosts (the desktop sidebar and the mobile
          header) use backdrop-blur, and a backdrop-filter makes an ancestor the
          containing block for `fixed` descendants — the overlay would be boxed
          into a 240px sidebar or a 56px header instead of the viewport. */}
      {open ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('title')}
          className="fixed inset-0 z-50 flex items-end justify-center p-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:items-center md:pb-3"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t('close')}
            className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
          />

          {/* Centred with flex rather than a translate, which is physical and
              would need an rtl: patch to sit correctly in Arabic. */}
          <div className="relative flex max-h-[70vh] w-full flex-col rounded-2xl border border-hairline bg-panel shadow-2xl md:w-96">
            <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{t('title')}</div>
                <div className="mt-0.5 text-[11px] text-faint">
                  {unread > 0 ? t('unreadCount', {count: unread}) : t('allRead')}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {unread > 0 ? (
                  <button
                    type="button"
                    onClick={markAllRead}
                    aria-label={t('markAllRead')}
                    title={t('markAllRead')}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-hairline text-muted transition-colors hover:bg-raised hover:text-ink"
                  >
                    <CheckCheck className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t('close')}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-hairline text-muted transition-colors hover:bg-raised hover:text-ink"
                >
                  <X className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {!loaded ? (
                <p className="px-2 py-6 text-center text-xs text-faint">
                  {t('loading')}
                </p>
              ) : items.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm font-medium">{t('emptyTitle')}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    {t('emptyBody')}
                  </p>
                </div>
              ) : (
                <ul className="space-y-0.5">
                  {items.map((item) => (
                    <NotificationRow
                      key={item.id}
                      item={item}
                      onDismiss={dismiss}
                      onNavigate={() => setOpen(false)}
                    />
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-hairline px-4 py-2.5">
              <Link
                href="/settings#notifications"
                onClick={() => setOpen(false)}
                className="text-[11px] text-muted transition-colors hover:text-accent"
              >
                {t('managePreferences')}
              </Link>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}
