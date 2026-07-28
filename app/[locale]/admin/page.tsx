import {getLocale} from 'next-intl/server';

import {redirect} from '@/i18n/navigation';

// The admin console is now a section of /settings, reached from the control
// panel. Kept as a redirect rather than deleted so existing links and
// bookmarks still land somewhere useful.
export default async function AdminPage() {
  const locale = await getLocale();
  redirect({href: '/settings', locale});
}
