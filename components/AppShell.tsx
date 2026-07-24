'use client';

import {useState} from 'react';
import {
  LayoutDashboard,
  ListTodo,
  LogOut,
  Package,
  ShieldCheck,
  TrendingUp
} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {Link, usePathname, useRouter} from '@/i18n/navigation';
import {signOutAction} from '@/lib/actions/auth';
import LocaleSwitcher from '@/components/LocaleSwitcher';

type Props = {
  userName: string | null;
  userEmail: string | null;
  isAdmin: boolean;
  children: React.ReactNode;
};

const NAV_ITEMS = [
  {href: '/', key: 'dashboard', icon: LayoutDashboard},
  {href: '/tasks', key: 'tasks', icon: ListTodo},
  {href: '/products', key: 'products', icon: Package},
  {href: '/trends', key: 'trends', icon: TrendingUp}
] as const;

export default function AppShell({userName, userEmail, isAdmin, children}: Props) {
  const t = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

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

  const items = [
    ...NAV_ITEMS,
    ...(isAdmin ? [{href: '/admin', key: 'admin', icon: ShieldCheck} as const] : [])
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 start-0 flex w-60 flex-col border-e border-hairline bg-panel/80 backdrop-blur">
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

        <div className="space-y-3 border-t border-hairline px-4 py-4">
          <LocaleSwitcher />
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-medium">
                {userName ?? userEmail ?? '—'}
              </div>
              {userName && userEmail ? (
                <div className="truncate text-[11px] text-faint">{userEmail}</div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              title={t('actions.signOut')}
              className="rounded-md border border-hairline p-2 text-muted transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </aside>

      <main className="ms-60 flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
