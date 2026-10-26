import {History} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import {requireActiveMember} from '@/lib/auth';
import {formatDay} from '@/lib/dates';
import {CURRENT_VERSION, RELEASES} from '@/lib/platform-releases';

export default async function ChangelogPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  await requireActiveMember();
  const t = await getTranslations('changelog');
  const lang = locale === 'ar' ? 'ar' : 'en';

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-accent" strokeWidth={1.75} />
          <h1 className="text-xl font-semibold">{t('title')}</h1>
        </div>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </header>

      <ol className="space-y-5">
        {RELEASES.map((release) => (
          <li key={release.version} id={`v${release.version}`} className="scroll-mt-20 rounded-lg border border-hairline bg-panel">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-5 py-3">
              <div className="flex items-center gap-2">
                <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-accent">
                  v{release.version}
                </span>
                <h2 className="text-sm font-medium">{release.title[lang]}</h2>
                {release.version === CURRENT_VERSION ? (
                  <span className="text-[10px] uppercase tracking-widest text-faint">{t('current')}</span>
                ) : null}
              </div>
              <span className="font-mono text-xs text-faint">{t('released', {date: formatDay(release.date, locale)})}</span>
            </header>
            <ul className="list-disc space-y-1.5 py-4 pe-5 ps-9 text-sm leading-relaxed text-muted marker:text-faint">
              {release.items[lang].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
