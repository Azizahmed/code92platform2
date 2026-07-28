'use client';

import {useTranslations} from 'next-intl';

import LocaleSwitcher from '@/components/LocaleSwitcher';
import ThemeSwitcher from '@/components/ThemeSwitcher';

// Language and appearance, rendered full-width on the settings page. These are
// the same two controls the quick control panel carries — one component owns
// each control, so the two surfaces cannot drift apart.
export default function SettingsPreferences() {
  const t = useTranslations('settings');

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section className="space-y-2 rounded-lg border border-hairline bg-panel p-4">
        <div>
          <h2 className="text-sm font-medium">{t('language.title')}</h2>
          <p className="mt-0.5 text-xs text-muted">{t('language.hint')}</p>
        </div>
        <LocaleSwitcher />
      </section>

      <section className="space-y-2 rounded-lg border border-hairline bg-panel p-4">
        <div>
          <h2 className="text-sm font-medium">{t('appearance.title')}</h2>
          <p className="mt-0.5 text-xs text-muted">{t('appearance.hint')}</p>
        </div>
        <ThemeSwitcher />
      </section>
    </div>
  );
}
