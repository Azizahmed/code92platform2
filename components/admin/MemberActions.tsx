'use client';

import {useState, useTransition} from 'react';
import {ShieldCheck, ShieldOff, UserCheck, UserX} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {setMemberAction} from '@/lib/actions/admin';

type Props = {
  userId: string;
  role: 'admin' | 'member';
  isActive: boolean;
};

const buttonClass =
  'inline-flex items-center gap-1 rounded-md border border-hairline px-2 py-1 text-xs text-muted transition-colors hover:text-ink disabled:opacity-50';

// Per-row member actions. RPC errors (e.g. last-active-admin protection)
// surface as localized messages under the row's buttons.
export default function MemberActions({userId, role, isActive}: Props) {
  const t = useTranslations('admin');
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  function apply(newRole: 'admin' | 'member', newActive: boolean) {
    startTransition(async () => {
      const result = await setMemberAction({
        target: userId,
        newRole,
        newActive
      });
      setErrorKey(result.ok ? null : result.error);
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => apply(role, !isActive)}
          className={`${buttonClass} ${
            isActive ? 'hover:border-danger/40 hover:text-danger' : 'hover:border-accent/40 hover:text-accent'
          }`}
        >
          {isActive ? (
            <>
              <UserX className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('members.deactivate')}
            </>
          ) : (
            <>
              <UserCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('members.activate')}
            </>
          )}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => apply(role === 'admin' ? 'member' : 'admin', isActive)}
          className={buttonClass}
        >
          {role === 'admin' ? (
            <>
              <ShieldOff className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('members.makeMember')}
            </>
          ) : (
            <>
              <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('members.makeAdmin')}
            </>
          )}
        </button>
      </div>
      {errorKey ? (
        <span className="text-xs text-danger">
          {t.has(`errors.${errorKey}`)
            ? t(`errors.${errorKey}`)
            : t('errors.generic')}
        </span>
      ) : null}
    </div>
  );
}
