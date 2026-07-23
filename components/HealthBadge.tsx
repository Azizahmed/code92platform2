import {useTranslations} from 'next-intl';

export type Health = 'green' | 'yellow' | 'red' | 'unknown';

const DOT_STYLES: Record<Health, string> = {
  green: 'bg-accent shadow-[0_0_8px_rgba(52,211,153,0.55)]',
  yellow: 'bg-amber shadow-[0_0_8px_rgba(251,191,36,0.5)]',
  red: 'bg-danger shadow-[0_0_8px_rgba(248,113,113,0.5)]',
  unknown: 'bg-faint'
};

export default function HealthBadge({health}: {health: Health}) {
  const t = useTranslations('common');

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_STYLES[health]}`} />
      {t(`health.${health}`)}
    </span>
  );
}
