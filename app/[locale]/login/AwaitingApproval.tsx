'use client';

import {useState, useTransition} from 'react';
import {Hourglass, LogOut} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {useRouter} from '@/i18n/navigation';
import {signOutAction} from '@/lib/actions/auth';

// Shown to signed-in users whose team_members row is still inactive
// (is_active=false until an admin activates the account).
export default function AwaitingApproval({email}: {email: string | null}) {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [signingOut, setSigningOut] = useState(false);

  function checkAgain() {
    // If an admin activated the account, the re-rendered login page
    // redirects to the dashboard.
    startTransition(() => router.refresh());
  }

  async function handleSignOut() {
    setSigningOut(true);
    await signOutAction();
    router.refresh();
    setSigningOut(false);
  }

  return (
    <div className="w-full max-w-sm rounded-lg border border-hairline bg-panel p-8 text-center">
      <span className="mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-full border border-amber/30 bg-amber/10">
        <Hourglass className="h-5 w-5 text-amber" strokeWidth={1.75} />
      </span>
      <h1 className="text-lg font-semibold">{t('awaiting.title')}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        {t('awaiting.body')}
      </p>
      {email ? (
        <p className="mt-4 font-mono text-xs text-faint" dir="ltr">
          {t('awaiting.signedInAs')} {email}
        </p>
      ) : null}

      <div className="mt-6 space-y-2">
        <button
          type="button"
          onClick={checkAgain}
          disabled={pending}
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {t('awaiting.checkAgain')}
        </button>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-hairline px-3 py-2 text-sm text-muted transition-colors hover:text-ink disabled:opacity-50"
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
          {tCommon('actions.signOut')}
        </button>
      </div>
    </div>
  );
}
