'use client';

import {useState, useTransition} from 'react';
import {CheckCircle2, Circle, Minus, Plus} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {setTaskReleaseAction} from '@/lib/actions/releases';
import {Link} from '@/i18n/navigation';

export type ScopeTask = {
  id: string;
  title: string;
  status: 'pending' | 'completed';
  assignee_name: string | null;
  due_date: string | null;
};

// What is actually in this release. A release with no scope is a date with an
// opinion; this is the part that makes "are we ready" answerable from evidence
// rather than from memory.
export default function ReleaseScopePanel({
  releaseId,
  productId,
  scoped,
  available,
  canManage
}: {
  releaseId: string;
  productId: string;
  scoped: ScopeTask[];
  available: ScopeTask[];
  canManage: boolean;
}) {
  const t = useTranslations('releases');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function move(taskId: string, releaseId: string | null) {
    setError(null);
    setPendingId(taskId);
    startTransition(async () => {
      const result = await setTaskReleaseAction(taskId, releaseId);
      if (!result.ok) setError(result.error);
      setPendingId(null);
    });
  }

  const open = scoped.filter((task) => task.status !== 'completed').length;

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">{t('scope.title')}</h2>
        <span className="font-mono text-[11px] text-faint">
          {t('scope.progress', {open, total: scoped.length})}
        </span>
      </header>

      {error ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      {scoped.length === 0 ? (
        <p className="rounded-lg border border-dashed border-hairline bg-panel/50 px-4 py-6 text-center text-xs text-muted">
          {t('scope.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-panel">
          {scoped.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-3 px-4 py-2.5 text-sm"
            >
              <span
                className={`shrink-0 ${
                  task.status === 'completed' ? 'text-accent' : 'text-faint'
                }`}
              >
                {task.status === 'completed' ? (
                  <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
                ) : (
                  <Circle className="h-4 w-4" strokeWidth={1.75} />
                )}
              </span>
              <Link
                href={`/products/${productId}#task-${task.id}`}
                className={`min-w-0 flex-1 truncate transition-colors hover:text-accent ${
                  task.status === 'completed'
                    ? 'text-muted line-through'
                    : 'text-ink'
                }`}
              >
                {task.title}
              </Link>
              <span className="hidden shrink-0 text-[11px] text-faint sm:block">
                {task.assignee_name ?? t('scope.unassigned')}
              </span>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => move(task.id, null)}
                  disabled={pendingId === task.id}
                  aria-label={t('scope.remove')}
                  title={t('scope.remove')}
                  className="shrink-0 rounded p-1.5 text-faint transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                >
                  <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        available.length === 0 ? (
          <p className="text-[11px] text-faint">{t('scope.noneAvailable')}</p>
        ) : !adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t('scope.add')}
          </button>
        ) : (
          <div className="space-y-2 rounded-lg border border-accent/20 bg-accent/[0.035] p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium">{t('scope.addTitle')}</span>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="text-[11px] text-muted transition-colors hover:text-ink"
              >
                {t('form.cancel')}
              </button>
            </div>
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {available.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => move(task.id, releaseId)}
                    disabled={pendingId === task.id}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-start text-sm text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
                  >
                    <Plus
                      className="h-3.5 w-3.5 shrink-0 text-accent"
                      strokeWidth={1.75}
                    />
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    <span className="shrink-0 text-[11px] text-faint">
                      {task.assignee_name ?? t('scope.unassigned')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}
    </section>
  );
}
