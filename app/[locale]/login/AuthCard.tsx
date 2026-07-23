'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';

import {useRouter} from '@/i18n/navigation';
import {signInAction, signUpAction} from '@/lib/actions/auth';

type Mode = 'signin' | 'signup';

const ERROR_KEYS = new Set(['generic', 'invalidCredentials']);

export default function AuthCard() {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);

    startTransition(async () => {
      const result =
        mode === 'signin'
          ? await signInAction({email, password})
          : await signUpAction({email, password, displayName});

      if (!result.ok) {
        setErrorKey(ERROR_KEYS.has(result.error) ? result.error : 'generic');
        return;
      }
      // Session cookies are set; re-render the page — active members are
      // redirected to the dashboard, new sign-ups see "awaiting approval".
      router.refresh();
    });
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 font-mono text-sm font-semibold text-accent">
          92
        </span>
        <div>
          <h1 className="text-lg font-semibold">{tCommon('appName')}</h1>
          <p className="mt-1 text-sm text-muted">
            {mode === 'signin' ? t('signIn.subtitle') : t('signUp.subtitle')}
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-lg border border-hairline bg-panel p-6"
      >
        <h2 className="text-sm font-medium">
          {mode === 'signin' ? t('signIn.title') : t('signUp.title')}
        </h2>

        {mode === 'signup' ? (
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">{t('fields.displayName')}</span>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('fields.displayNamePlaceholder')}
              className="w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50"
            />
          </label>
        ) : null}

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('fields.email')}</span>
          <input
            type="email"
            dir="ltr"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('fields.emailPlaceholder')}
            className="w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('fields.password')}</span>
          <input
            type="password"
            dir="ltr"
            required
            minLength={8}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('fields.passwordPlaceholder')}
            className="w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50"
          />
        </label>

        {errorKey ? (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {t(`errors.${errorKey}`)}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending
            ? mode === 'signin'
              ? t('signIn.submitting')
              : t('signUp.submitting')
            : mode === 'signin'
              ? t('signIn.submit')
              : t('signUp.submit')}
        </button>
      </form>

      <p className="mt-4 text-center text-xs text-muted">
        {mode === 'signin' ? t('toggle.noAccount') : t('toggle.haveAccount')}{' '}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setErrorKey(null);
          }}
          className="font-medium text-accent hover:underline"
        >
          {mode === 'signin' ? t('toggle.createOne') : t('toggle.signIn')}
        </button>
      </p>
    </div>
  );
}
