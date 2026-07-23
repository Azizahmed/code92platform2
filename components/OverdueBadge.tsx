import {AlertTriangle} from 'lucide-react';
import {useTranslations} from 'next-intl';

export default function OverdueBadge() {
  const t = useTranslations('common');

  return (
    <span className="inline-flex items-center gap-1 rounded border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[11px] font-medium text-amber">
      <AlertTriangle className="h-3 w-3" strokeWidth={2} />
      {t('overdue')}
    </span>
  );
}
