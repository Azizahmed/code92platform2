import {getLocale} from 'next-intl/server';

import LocaleSwitcher from '@/components/LocaleSwitcher';
import {redirect} from '@/i18n/navigation';
import {getOwnMembership, getSessionUser} from '@/lib/auth';

import AwaitingApproval from './AwaitingApproval';
import AuthCard from './AuthCard';

export default async function LoginPage() {
  const [user, member] = await Promise.all([
    getSessionUser(),
    getOwnMembership()
  ]);

  // Active members have no business here — send them to the dashboard.
  if (user && member?.is_active) {
    redirect({href: '/', locale: await getLocale()});
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="absolute end-4 top-4 w-36">
        <LocaleSwitcher />
      </div>
      {user ? <AwaitingApproval email={user.email} /> : <AuthCard />}
    </div>
  );
}
