'use client';

import {useEffect, useState} from 'react';
import {
  BookOpen,
  LayoutDashboard,
  ListTodo,
  LogOut,
  MessagesSquare,
  Package,
  Rocket,
  Scale,
  Settings2
} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {Link, usePathname, useRouter} from '@/i18n/navigation';
import {signOutAction} from '@/lib/actions/auth';
import ControlPanel from '@/components/ControlPanel';
import NotificationBell from '@/components/notifications/NotificationBell';

type Props = {
  userName: string | null;
  userEmail: string | null;
  isAdmin: boolean;
  children: React.ReactNode;
};

// Trends is deliberately absent: the pipeline is switched off (see the kill
// switch in functions/trend-scan.ts), so navigating to a feed that can never
// gain an item would be advertising a feature that does not work. The route
// still resolves and explains itself for anyone holding a direct link.
const NAV_ITEMS = [
  {href: '/', key: 'dashboard', icon: LayoutDashboard},
  {href: '/channels', key: 'channels', icon: MessagesSquare},
  {href: '/tasks', key: 'tasks', icon: ListTodo},
  {href: '/products', key: 'products', icon: Package},
  {href: '/releases', key: 'releases', icon: Rocket},
  {href: '/knowledge', key: 'knowledge', icon: BookOpen},
  {href: '/governance', key: 'governance', icon: Scale}
] as const;

export default function AppShell({userName, userEmail, isAdmin, children}: Props) {
  const t = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [controlPanelOpen, setControlPanelOpen] = useState(false);

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

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 start-0 z-40 hidden w-60 flex-col border-e border-hairline bg-panel/80 backdrop-blur md:flex">
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
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-hairline px-4 py-4">
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

      <div className="min-w-0 md:ms-60">
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
            gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`
          }}
        >
          {items.map(({href, key, icon: Icon}) => {
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
                  <Icon
                    className="h-5 w-5 shrink-0"
                    strokeWidth={active ? 2 : 1.75}
                  />
                  <span className="max-w-full truncate">{t(`nav.${key}`)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </nav>

      <ControlPanel
        open={controlPanelOpen}
        onClose={() => setControlPanelOpen(false)}
        userName={userName}
        userEmail={userEmail}
        isAdmin={isAdmin}
        signingOut={signingOut}
        onSignOut={handleSignOut}
      />
    </div>
  );
}
