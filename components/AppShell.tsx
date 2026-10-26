'use client';

import {useEffect, useState} from 'react';
import dynamic from 'next/dynamic';
import {
  Bot,
  BookOpen,
  Handshake,
  History,
  Inbox,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu,
  MessagesSquare,
  Package,
  Rocket,
  Scale,
  Settings2
} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {Link, usePathname, useRouter} from '@/i18n/navigation';
import {signOutAction} from '@/lib/actions/auth';
import {CURRENT_VERSION} from '@/lib/platform-releases';
import ControlPanel from '@/components/ControlPanel';
import NavBadge, {useMyWorkBadge} from '@/components/NavBadge';
import NotificationBell from '@/components/notifications/NotificationBell';

const AssistantPanel = dynamic(() => import('@/components/assistant/AssistantPanel'), {ssr: false});

type Props = {
  userName: string | null;
  userEmail: string | null;
  isAdmin: boolean;
  assistantUserId: string | null;
  myWorkBadge: number;
  children: React.ReactNode;
};

// Trends is deliberately absent: the pipeline is switched off (see the kill
// switch in functions/trend-scan.ts), so navigating to a feed that can never
// gain an item would be advertising a feature that does not work. The route
// still resolves and explains itself for anyone holding a direct link.
//
// Top to bottom: me and my team today (Dashboard → All tasks), the pipeline
// left to right (Sales → Releases), the record (Knowledge, Governance).
const NAV_ITEMS = [
  {href: '/', key: 'dashboard', icon: LayoutDashboard},
  {href: '/my-work', key: 'myWork', icon: Inbox},
  {href: '/channels', key: 'channels', icon: MessagesSquare},
  {href: '/tasks', key: 'tasks', icon: ListTodo},
  {href: '/sales', key: 'sales', icon: Handshake},
  {href: '/products', key: 'products', icon: Package},
  {href: '/releases', key: 'releases', icon: Rocket},
  {href: '/knowledge', key: 'knowledge', icon: BookOpen},
  {href: '/governance', key: 'governance', icon: Scale}
] as const;

// Nine items do not fit a phone's bottom bar. The first five daily ones are
// tabs; "More" opens the control panel, which lists the rest.
const MOBILE_TAB_COUNT = 5;

export default function AppShell({userName, userEmail, isAdmin, assistantUserId, myWorkBadge, children}: Props) {
  const t = useTranslations('common');
  const assistantT = useTranslations('assistant');
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [controlPanelOpen, setControlPanelOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantLoaded, setAssistantLoaded] = useState(false);
  const badge = useMyWorkBadge(myWorkBadge);

  useEffect(() => {
    setAssistantOpen(false);
    setAssistantLoaded(false);
  }, [assistantUserId]);

  useEffect(() => {
    setControlPanelOpen(false);
  }, [pathname]);

  // Bare chrome for the login screen: no sidebar until authenticated.
  if (pathname === '/login' || pathname.startsWith('/login/')) {
    return <>{children}</>;
  }

  async function handleSignOut() {
    setSigningOut(true);
    await signOutAction();
    router.push('/login');
    router.refresh();
  }

  // Admin is not a nav item any more: its panels are sections of /settings,
  // reached through the control panel. That also keeps the mobile bottom bar at
  // five tabs for everyone instead of seven for admins.
  const items = NAV_ITEMS;
  const activeItem = items.find(({href}) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)
  );
  const tabItems = items.slice(0, MOBILE_TAB_COUNT);
  const moreItems = items.slice(MOBILE_TAB_COUNT);
  const moreActive =
    moreItems.some(({href}) => pathname.startsWith(href)) ||
    pathname.startsWith('/changelog');
  const badgeLabel = t('nav.badge', {count: badge});

  return (
    <div className={`min-h-screen ${assistantOpen && assistantUserId ? 'assistant-shell-open' : ''}`}>
      <aside className="platform-sidebar fixed inset-y-0 start-0 z-40 hidden w-60 flex-col border-e border-hairline bg-panel/80 backdrop-blur md:flex">
        <div className="flex items-center gap-2.5 border-b border-hairline px-5 py-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-accent/30 bg-accent/10 font-mono text-xs font-semibold text-accent">
            92
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold">{t('appNameShort')}</div>
            <div className="text-[11px] text-faint">{t('consoleTag')}</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <div className="px-2 pb-2 text-[10px] font-medium uppercase tracking-widest text-faint">
            {t('nav.section')}
          </div>
          <ul className="space-y-0.5">
            {items.map(({href, key, icon: Icon}) => {
              const active =
                href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <li key={key}>
                  <Link
                    href={href}
                    className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-accent/10 text-accent'
                        : 'text-muted hover:bg-raised hover:text-ink'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    {t(`nav.${key}`)}
                    {key === 'myWork' ? <NavBadge count={badge} label={badgeLabel} /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-hairline px-4 py-4">
          <Link
            href="/changelog"
            title={t('nav.changelog')}
            className={`mb-3 flex items-center justify-between gap-2 rounded-md px-1 text-[11px] transition-colors ${
              pathname.startsWith('/changelog') ? 'text-accent' : 'text-faint hover:text-ink'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <History className="h-3 w-3" strokeWidth={1.75} />
              {t('nav.changelog')}
            </span>
            <span className="font-mono">v{CURRENT_VERSION}</span>
          </Link>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-medium">
                {userName ?? userEmail ?? '—'}
              </div>
              {userName && userEmail ? (
                <div className="truncate text-[11px] text-faint">{userEmail}</div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <NotificationBell />
              <button
                type="button"
                onClick={() => setControlPanelOpen(true)}
                aria-expanded={controlPanelOpen}
                title={t('nav.controlPanel')}
                aria-label={t('nav.controlPanel')}
                className="rounded-md border border-hairline p-2 text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                <Settings2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                title={t('actions.signOut')}
                aria-label={t('actions.signOut')}
                className="rounded-md border border-hairline p-2 text-muted transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className={`min-w-0 md:ms-60 ${assistantOpen && assistantUserId ? 'assistant-content' : ''}`}>
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-hairline bg-panel/90 px-4 backdrop-blur-xl md:hidden">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 font-mono text-xs font-semibold text-accent">
              92
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold">
                {t('appNameShort')}
              </div>
              <div className="truncate text-[10px] text-faint">
                {activeItem
                  ? t(`nav.${activeItem.key}`)
                  : // /settings is reachable from the control panel rather than
                    // the nav, so it has no activeItem to name it.
                    pathname.startsWith('/settings')
                    ? t('nav.settings')
                    : pathname.startsWith('/changelog')
                      ? t('nav.changelog')
                      : t('consoleTag')}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <NotificationBell />
            <button
              type="button"
              onClick={() => setControlPanelOpen(true)}
              aria-label={t('nav.preferences')}
              aria-expanded={controlPanelOpen}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-hairline bg-bg/50 text-muted transition-colors active:bg-raised active:text-ink"
            >
              <Settings2 className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </header>

        <main className="min-w-0 px-4 py-5 pb-28 sm:px-6 md:px-8 md:py-8 md:pb-8">
          {children}
        </main>
      </div>

      <nav
        aria-label={t('nav.section')}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-panel/95 px-1 pt-1 backdrop-blur-xl md:hidden"
      >
        <ul
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${tabItems.length + 1}, minmax(0, 1fr))`
          }}
        >
          {tabItems.map(({href, key, icon: Icon}) => {
            const active =
              href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <li key={key}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[9px] font-medium transition-colors ${
                    active
                      ? 'text-accent'
                      : 'text-faint active:bg-raised active:text-ink'
                  }`}
                >
                  {active ? (
                    <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-accent" />
                  ) : null}
                  <span className="relative">
                    <Icon
                      className="h-5 w-5 shrink-0"
                      strokeWidth={active ? 2 : 1.75}
                    />
                    {key === 'myWork' && badge > 0 ? (
                      <span
                        aria-label={badgeLabel}
                        className="absolute -end-2.5 -top-1.5 min-w-4 rounded-full bg-amber px-1 text-center font-mono text-[9px] font-semibold leading-4 text-bg"
                      >
                        {badge > 99 ? '99+' : badge}
                      </span>
                    ) : null}
                  </span>
                  <span className="max-w-full truncate">{t(`nav.${key}`)}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setControlPanelOpen(true)}
              aria-expanded={controlPanelOpen}
              className={`relative flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[9px] font-medium transition-colors ${
                moreActive ? 'text-accent' : 'text-faint active:bg-raised active:text-ink'
              }`}
            >
              {moreActive ? (
                <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-accent" />
              ) : null}
              <Menu className="h-5 w-5 shrink-0" strokeWidth={moreActive ? 2 : 1.75} />
              <span className="max-w-full truncate">{t('nav.more')}</span>
            </button>
          </li>
        </ul>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </nav>

      {assistantUserId ? <>
        {!assistantOpen ? <button type="button" aria-controls="platform-assistant" aria-expanded={false}
          onClick={() => {setAssistantLoaded(true); setAssistantOpen(true);}}
          aria-label={assistantT('open')}
          className="assistant-launcher fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-2 rounded-full border border-accent/30 bg-panel px-4 py-3 text-sm text-accent shadow-lg md:bottom-6">
          <Bot className="h-4 w-4" />{assistantT('title')}
        </button> : null}
        {assistantLoaded ? <AssistantPanel key={assistantUserId} open={assistantOpen} onClose={() => setAssistantOpen(false)} /> : null}
      </> : null}

      <ControlPanel
        open={controlPanelOpen}
        onClose={() => setControlPanelOpen(false)}
        userName={userName}
        userEmail={userEmail}
        isAdmin={isAdmin}
        signingOut={signingOut}
        onSignOut={handleSignOut}
        moreLinks={[
          ...moreItems.map(({href, key, icon}) => ({href, label: t(`nav.${key}`), icon})),
          {href: '/changelog', label: `${t('nav.changelog')} · v${CURRENT_VERSION}`, icon: History}
        ]}
      />
    </div>
  );
}
