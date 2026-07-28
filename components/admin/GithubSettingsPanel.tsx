'use client';

import {useState, useTransition} from 'react';
import {Check, GitBranch, TriangleAlert} from 'lucide-react';
import {useTranslations} from 'next-intl';

import RelativeTime from '@/components/RelativeTime';
import {
  saveGithubCredentialsAction,
  testGithubConnectionAction
} from '@/lib/actions/github';
import {
  daysUntil,
  TOKEN_EXPIRY_WARNING_DAYS,
  type GithubConnectionStatus
} from '@/lib/github';

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50';

// The one place the org PAT is entered. The value is posted to a Server Action
// and forwarded straight to the edge function, which validates it against GitHub
// before anything is stored — and stores it encrypted. It is never echoed back:
// once saved, this panel can only ever show the last four characters.
export default function GithubSettingsPanel({
  status
}: {
  status: GithubConnectionStatus | null;
}) {
  const t = useTranslations('github');

  const [token, setToken] = useState('');
  const [editing, setEditing] = useState(!status?.is_configured);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const expiresInDays = daysUntil(status?.token_expires_at ?? null);
  const expiringSoon =
    expiresInDays !== null && expiresInDays <= TOKEN_EXPIRY_WARNING_DAYS;

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);
    setSavedMessage(null);

    startTransition(async () => {
      const result = await saveGithubCredentialsAction({token: token.trim()});
      if (!result.ok) {
        setErrorKey(result.error);
        return;
      }
      setToken('');
      setEditing(false);
      setSavedMessage(t('settings.saved'));
    });
  }

  function handleTest() {
    setErrorKey(null);
    setSavedMessage(null);

    startTransition(async () => {
      const result = await testGithubConnectionAction();
      if (!result.ok) {
        setErrorKey(result.error);
        return;
      }
      setSavedMessage(t('settings.testOk'));
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <GitBranch className="h-4 w-4 text-muted" strokeWidth={1.75} />
          {t('settings.title')}
        </h2>
        {status?.is_configured ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
            <Check className="h-3 w-3" strokeWidth={2.5} />
            {t('settings.connected')}
          </span>
        ) : (
          <span className="rounded border border-hairline bg-raised px-2 py-0.5 text-[11px] text-muted">
            {t('settings.notConnected')}
          </span>
        )}
      </div>

      <div className="space-y-4 rounded-lg border border-hairline bg-panel p-4">
        <p className="text-sm leading-relaxed text-muted">
          {t('settings.intro', {org: status?.org ?? 'code92-dev'})}
        </p>

        {status?.is_configured ? (
          <dl className="grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-faint">{t('settings.tokenLabel')}</dt>
              <dd dir="ltr" className="mt-0.5 font-mono text-ink">
                ••••••••{status.token_last_four}
              </dd>
            </div>
            <div>
              <dt className="text-faint">{t('settings.expiresLabel')}</dt>
              <dd
                className={`mt-0.5 ${expiringSoon ? 'text-amber' : 'text-ink'}`}
              >
                {status.token_expires_at ? (
                  <>
                    <RelativeTime date={status.token_expires_at} />
                    {expiringSoon ? (
                      <span className="ms-2">
                        {expiresInDays !== null && expiresInDays < 0
                          ? t('settings.expired')
                          : t('settings.expiringSoon')}
                      </span>
                    ) : null}
                  </>
                ) : (
                  t('settings.noExpiry')
                )}
              </dd>
            </div>
            <div>
              <dt className="text-faint">{t('settings.writeLabel')}</dt>
              <dd
                className={`mt-0.5 ${status.token_can_write ? 'text-ink' : 'text-danger'}`}
              >
                {status.token_can_write
                  ? t('settings.writeYes')
                  : t('settings.writeNo')}
              </dd>
            </div>
            <div>
              <dt className="text-faint">{t('settings.validatedLabel')}</dt>
              <dd className="mt-0.5 text-ink">
                {status.validated_at ? (
                  <RelativeTime date={status.validated_at} />
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
        ) : null}

        {status?.validation_error ? (
          <p
            dir="ltr"
            className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-start text-xs text-danger"
          >
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span className="font-mono">{status.validation_error}</span>
          </p>
        ) : null}

        {editing ? (
          <form onSubmit={handleSave} className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs text-muted">
                {t('settings.tokenInputLabel')}
              </span>
              <input
                type="password"
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="github_pat_..."
                className={`${INPUT_CLASS} font-mono text-start`}
              />
            </label>

            <details className="rounded-md border border-hairline bg-bg/50 px-3 py-2">
              <summary className="cursor-pointer text-xs text-muted">
                {t('settings.helpTitle')}
              </summary>
              <ol className="mt-2 list-decimal space-y-1 ps-4 text-xs leading-relaxed text-muted">
                <li>{t('settings.help1')}</li>
                <li>{t('settings.help2')}</li>
                <li>{t('settings.help3')}</li>
                <li>{t('settings.help4')}</li>
              </ol>
            </details>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={pending || token.trim().length < 20}
                className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {pending ? t('settings.saving') : t('settings.save')}
              </button>
              {status?.is_configured ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setToken('');
                    setErrorKey(null);
                  }}
                  disabled={pending}
                  className="rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
                >
                  {t('settings.cancel')}
                </button>
              ) : null}
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleTest}
              disabled={pending}
              className="rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
            >
              {pending ? t('settings.testing') : t('settings.test')}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={pending}
              className="rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
            >
              {t('settings.replace')}
            </button>
          </div>
        )}

        {errorKey ? (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {t(`errors.${errorKey}`)}
          </p>
        ) : null}

        {savedMessage ? (
          <p className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
            {savedMessage}
          </p>
        ) : null}
      </div>
    </section>
  );
}
