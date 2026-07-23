'use client';

import {useLocale, useTranslations} from 'next-intl';

import {Link, usePathname} from '@/i18n/navigation';
import {routing} from '@/i18n/routing';

export default function LocaleSwitcher() {
  const t = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <div
      role="group"
      aria-label={t('language.label')}
      className="flex rounded-md border border-hairline p-0.5"
    >
      {routing.locales.map((l) => (
        <Link
          key={l}
          href={pathname}
          locale={l}
          className={`flex-1 rounded px-2.5 py-1 text-center text-xs transition-colors ${
            l === locale
              ? 'bg-raised font-medium text-ink'
              : 'text-faint hover:text-muted'
          }`}
        >
          {t(`language.${l}`)}
        </Link>
      ))}
    </div>
  );
}
