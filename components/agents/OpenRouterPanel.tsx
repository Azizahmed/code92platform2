'use client';

import {useState, useTransition} from 'react';
import {AlertTriangle, CircleCheck, KeyRound, Trash2} from 'lucide-react';
import {useTranslations} from 'next-intl';

import RelativeTime from '@/components/RelativeTime';
import {
  clearOpenRouterKeyAction,
  saveOpenRouterKeyAction,
  testOpenRouterKeyAction
} from '@/lib/actions/agents';
import {looksLikeOpenRouterKey, type OpenRouterStatus} from '@/lib/agents';

// The one credential every agent shares. The key never comes back from the
// server — openrouter_connection_status() structurally cannot return it — so
// this panel only ever shows the last four digits and what OpenRouter reported
// about the key when it was validated.

function money(value: number | null): string {
  if (value === null) return '—';
  return `$${value.toFixed(2)}`;
}

export default function OpenRouterPanel({
  status
}: {
  status: OpenRouterStatus | null;
}) {
  const t = useTranslations('agents');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    const trimmed = key.trim();
    if (!looksLikeOpenRouterKey(trimmed)) {
      setError('apiKeyInvalid');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await saveOpenRouterKeyAction({apiKey: trimmed});
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setKey('');
    });
  }

  function run(action: () => Promise<{ok: boolean; error?: string}>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? 'generic');
    });
  }

  // `error` holds a code, never prose, so that the action and the client-side
  // check can both feed it. Translated at render, as in ReleaseForm.
  function errorText(code: string) {
    return code === 'apiKeyInvalid'
      ? t('openrouter.apiKeyInvalid')
      : t(`errors.${code}`);
  }

  const configured = status?.is_configured ?? false;

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-sm font-medium text-ink">{t('openrouter.title')}</h2>
        <p className="mt-0.5 text-xs text-muted">{t('openrouter.subtitle')}</p>
      </header>

      <div className="rounded-lg border border-hairline bg-panel p-4">
        {configured ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent">
                <CircleCheck className="h-3 w-3" strokeWidth={2} />
                {t('openrouter.configured', {
                  lastFour: status?.key_last_four ?? '····'
                })}
              </span>
              {status?.key_label ? (
                <span className="font-mono text-[11px] text-faint">
                  {status.key_label}
                </span>
              ) : null}
              {status?.key_is_free_tier ? (
                <span className="rounded border border-hairline bg-raised px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-faint">
                  {t('openrouter.freeTier')}
                </span>
              ) : null}
            </div>

            <p className="font-mono text-xs text-muted">
              {status?.key_is_capped
                ? t('openrouter.usage', {
                    usage: money(status?.key_usage_usd ?? 0),
                    limit: money(status?.key_limit_usd ?? null)
                  })
                : t('openrouter.usageUncapped', {
                    usage: money(status?.key_usage_usd ?? 0)
                  })}
            </p>

            {/* "Should be a test key", made concrete. A key with no spend limit
                is the thing this guidance is about, so it is called out rather
                than left for someone to notice on an invoice. */}
            {!status?.key_is_capped ? (
              <p className="flex items-start gap-2 rounded border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span>{t('openrouter.uncappedWarning')}</span>
              </p>
            ) : null}

            {status?.validation_error ? (
              <p className="text-xs text-danger">
                {t('openrouter.checkFailed', {error: status.validation_error})}
              </p>
            ) : status?.validated_at ? (
              <p className="font-mono text-[11px] text-faint">
                <RelativeTime date={status.validated_at} />
              </p>
            ) : null}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => run(testOpenRouterKeyAction)}
                disabled={pending}
                className="rounded border border-hairline bg-raised px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
              >
                {t('openrouter.test')}
              </button>
              <button
                type="button"
                onClick={() => run(clearOpenRouterKeyAction)}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded border border-danger/30 bg-danger/10 px-3 py-1.5 text-sm text-danger transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t('openrouter.clear')}
              </button>
            </div>
          </div>
        ) : (
          <p className="mb-3 text-sm text-muted">{t('openrouter.notConfigured')}</p>
        )}

        <div className="mt-4 flex flex-col gap-2 border-t border-hairline pt-4">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-faint">
              {t('openrouter.apiKey')}
            </span>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              dir="ltr"
              autoComplete="off"
              placeholder="sk-or-v1-…"
              disabled={pending}
              className="rounded border border-hairline bg-bg px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-50"
            />
            <span className="text-xs text-faint">{t('openrouter.apiKeyHint')}</span>
          </label>

          {error ? (
            <p className="text-xs text-danger">{errorText(error)}</p>
          ) : null}

          <button
            type="button"
            onClick={save}
            disabled={pending || !key.trim()}
            className="inline-flex w-fit items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
          >
            <KeyRound className="h-3.5 w-3.5" strokeWidth={2} />
            {pending ? t('openrouter.saving') : t('openrouter.save')}
          </button>
        </div>
      </div>
    </section>
  );
}
