'use client';

import {Moon, Sun} from 'lucide-react';
import {useEffect, useState} from 'react';
import {useTranslations} from 'next-intl';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'code92-theme';

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

export default function ThemeSwitcher() {
  const t = useTranslations('common');
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = document.documentElement.classList.contains('light')
      ? 'light'
      : 'dark';
    setTheme(current);
  }, []);

  function selectTheme(nextTheme: Theme) {
    applyTheme(nextTheme);
    setTheme(nextTheme);
  }

  return (
    <div
      role="group"
      aria-label={t('theme.label')}
      className="flex rounded-md border border-hairline bg-bg/35 p-0.5"
    >
      <button
        type="button"
        onClick={() => selectTheme('light')}
        aria-pressed={theme === 'light'}
        title={t('theme.light')}
        className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs transition-colors ${
          theme === 'light'
            ? 'bg-raised font-medium text-ink'
            : 'text-faint hover:text-muted'
        }`}
      >
        <Sun className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span>{t('theme.light')}</span>
      </button>
      <button
        type="button"
        onClick={() => selectTheme('dark')}
        aria-pressed={theme === 'dark'}
        title={t('theme.dark')}
        className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs transition-colors ${
          theme === 'dark'
            ? 'bg-raised font-medium text-ink'
            : 'text-faint hover:text-muted'
        }`}
      >
        <Moon className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span>{t('theme.dark')}</span>
      </button>
    </div>
  );
}
