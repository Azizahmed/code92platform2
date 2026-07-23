import {Construction} from 'lucide-react';
import {useTranslations} from 'next-intl';

// Placeholder for sections owned by later milestones — keeps nav links
// functional without stubbing their real content.
export default function PlaceholderSection({title}: {title: string}) {
  const t = useTranslations('common');

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">{title}</h1>
      </header>
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-24 text-center">
        <Construction className="h-6 w-6 text-faint" strokeWidth={1.5} />
        <div className="text-sm font-medium">{t('placeholder.title')}</div>
        <p className="max-w-md text-sm leading-relaxed text-muted">
          {t('placeholder.body')}
        </p>
      </div>
    </section>
  );
}
