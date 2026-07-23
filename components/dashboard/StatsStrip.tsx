import {Boxes, CalendarClock, HeartPulse, TrendingUp} from 'lucide-react';
import {useTranslations} from 'next-intl';

type Props = {
  total: number;
  overdue: number;
  green: number;
  yellow: number;
  red: number;
  unknown: number;
  trends: number;
};

const HEALTH_DOTS = [
  {key: 'green', dot: 'bg-accent'},
  {key: 'yellow', dot: 'bg-amber'},
  {key: 'red', dot: 'bg-danger'},
  {key: 'unknown', dot: 'bg-faint'}
] as const;

function Tile({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-panel px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-widest text-faint">
        {label}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export default function StatsStrip({
  total,
  overdue,
  green,
  yellow,
  red,
  unknown,
  trends
}: Props) {
  const t = useTranslations('dashboard.stats');
  const tc = useTranslations('common');
  const counts: Record<(typeof HEALTH_DOTS)[number]['key'], number> = {
    green,
    yellow,
    red,
    unknown
  };

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label={t('products')}>
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-faint" strokeWidth={1.75} />
          <span className="font-mono text-xl font-semibold text-ink">
            {total}
          </span>
        </div>
      </Tile>

      <Tile label={t('overdue')}>
        <div className="flex items-center gap-2">
          <CalendarClock
            className={`h-4 w-4 ${overdue > 0 ? 'text-amber' : 'text-faint'}`}
            strokeWidth={1.75}
          />
          <span
            className={`font-mono text-xl font-semibold ${
              overdue > 0 ? 'text-amber' : 'text-ink'
            }`}
          >
            {overdue}
          </span>
        </div>
      </Tile>

      <Tile label={t('health')}>
        <div className="flex items-center gap-3">
          <HeartPulse className="h-4 w-4 shrink-0 text-faint" strokeWidth={1.75} />
          {HEALTH_DOTS.map(({key, dot}) => (
            <span
              key={key}
              title={tc(`health.${key}`)}
              className="inline-flex items-center gap-1.5"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
              <span className="font-mono text-sm font-medium text-ink">
                {counts[key]}
              </span>
            </span>
          ))}
        </div>
      </Tile>

      <Tile label={t('trends')}>
        <div className="flex items-center gap-2">
          <TrendingUp
            className={`h-4 w-4 ${trends > 0 ? 'text-accent' : 'text-faint'}`}
            strokeWidth={1.75}
          />
          <span
            className={`font-mono text-xl font-semibold ${
              trends > 0 ? 'text-accent' : 'text-ink'
            }`}
          >
            {trends}
          </span>
        </div>
      </Tile>
    </div>
  );
}
