'use client';

import {useOptimistic, useTransition} from 'react';
import {Bell, BellOff} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {setTaskWatchAction} from '@/lib/actions/notifications';

// "I can monitor it and get notification once it is updated." Watching is the
// whole opt-in: the assignee and the author are subscribed automatically by the
// trigger, everyone else presses this.
export default function TaskWatchToggle({
  taskId,
  watching,
  compact = false
}: {
  taskId: string;
  watching: boolean;
  compact?: boolean;
}) {
  const t = useTranslations('notifications');
  const [, startTransition] = useTransition();
  // Optimistic because the round trip is long enough that a bell which only
  // reacts on the response feels broken.
  const [optimisticWatching, setOptimisticWatching] = useOptimistic(
    watching,
    (_current: boolean, next: boolean) => next
  );

  const label = optimisticWatching ? t('watch.stop') : t('watch.start');
  const Icon = optimisticWatching ? Bell : BellOff;

  function toggle() {
    startTransition(async () => {
      setOptimisticWatching(!optimisticWatching);
      await setTaskWatchAction(taskId, !optimisticWatching);
    });
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-pressed={optimisticWatching}
        title={label}
        className={`rounded p-1.5 transition-colors hover:bg-raised ${
          optimisticWatching ? 'text-accent' : 'text-faint hover:text-ink'
        }`}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={optimisticWatching}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
        optimisticWatching
          ? 'border-accent/30 bg-accent/10 text-accent'
          : 'border-hairline text-muted hover:bg-raised hover:text-ink'
      }`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      {label}
    </button>
  );
}
