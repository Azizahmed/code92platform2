'use client';

import {useEffect, useRef, useState} from 'react';

import {usePathname} from '@/i18n/navigation';

const POLL_MS = 60_000;

async function fetchBadge(): Promise<number | null> {
  try {
    const res = await fetch('/api/my-work/counts', {cache: 'no-store'});
    if (!res.ok) return null;
    const body = (await res.json()) as {badge?: number};
    return typeof body.badge === 'number' ? body.badge : null;
  } catch {
    // Offline or signed out: keep the last known value.
    return null;
  }
}

// My work badge: waiting-on-me items + the caller's overdue tasks. Seeded by
// the server render, then kept live by polling every minute, when the tab
// regains focus, and on navigation (which follows most mutations). Polling
// pauses while the tab is hidden.
export function useMyWorkBadge(initial: number): number {
  const [count, setCount] = useState(initial);
  const pathname = usePathname();
  const firstPath = useRef(true);

  useEffect(() => setCount(initial), [initial]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      const badge = await fetchBadge();
      if (!cancelled && badge !== null) setCount(badge);
    };

    const start = () => {
      clearInterval(timer);
      timer = setInterval(refresh, POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
        start();
      } else {
        clearInterval(timer);
      }
    };

    start();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Navigation usually follows a mutation (task done, deal moved). The first
  // render is already seeded by the server, so skip it.
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    let cancelled = false;
    void fetchBadge().then((badge) => {
      if (!cancelled && badge !== null) setCount(badge);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return count;
}

export default function NavBadge({count, label}: {count: number; label: string}) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={label}
      className="ms-auto rounded-full border border-amber/30 bg-amber/10 px-1.5 font-mono text-[10px] leading-4 text-amber"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
