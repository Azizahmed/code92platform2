'use client';

import {Eye, EyeOff} from 'lucide-react';
import {useState, useTransition} from 'react';

// Following a record: the same control for products and projects. The labels
// come from the page, which knows which namespace it is in.
export default function WatchButton({
  watching: initial,
  action,
  labels
}: {
  watching: boolean;
  action: (watching: boolean) => Promise<{ok: boolean}>;
  labels: {watch: string; watching: string};
}) {
  const [watching, setWatching] = useState(initial);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={watching}
      onClick={() => {
        const next = !watching;
        setWatching(next);
        startTransition(async () => {
          const result = await action(next);
          if (!result.ok) setWatching(!next);
        });
      }}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
        watching
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-hairline text-muted hover:bg-raised hover:text-ink'
      }`}
    >
      {watching ? (
        <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
      ) : (
        <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
      )}
      {watching ? labels.watching : labels.watch}
    </button>
  );
}
