import {useTranslations} from 'next-intl';

export type Stage =
  | 'idea'
  | 'development'
  | 'beta'
  | 'live'
  | 'paused'
  | 'sunset';

export default function StageChip({stage}: {stage: Stage}) {
  const t = useTranslations('common');

  return (
    <span className="inline-flex items-center rounded border border-hairline bg-raised px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
      {t(`stages.${stage}`)}
    </span>
  );
}
