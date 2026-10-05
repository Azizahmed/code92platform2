'use client';

import {useLocale, useTranslations} from 'next-intl';

const formatters = new Map<string, {
  absolute: Intl.DateTimeFormat;
  relative: Intl.RelativeTimeFormat;
}>();
const DIVISIONS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 60 * 60 * 24 * 365], ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7], ['day', 60 * 60 * 24],
  ['hour', 60 * 60], ['minute', 60]
];

function forLocale(locale: string) {
  let cached = formatters.get(locale);
  if (!cached) {
    cached = {
      absolute: new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeStyle: 'short'}),
      relative: new Intl.RelativeTimeFormat(locale, {numeric: 'auto'})
    };
    formatters.set(locale, cached);
  }
  return cached;
}

// Locale-aware relative timestamps ("3 days ago" / "قبل 3 أيام") rendered
// in IBM Plex Mono, per the console typography rules.
export default function RelativeTime({date}: {date: string | Date}) {
  const locale = useLocale();
  const t = useTranslations('common');

  const then = new Date(date);
  const diffSeconds = Math.round((then.getTime() - Date.now()) / 1000);

  const formatter = forLocale(locale);
  const absolute = formatter.absolute.format(then);

  let text: string;
  if (Math.abs(diffSeconds) < 45) {
    text = t('time.justNow');
  } else {
    let unit: Intl.RelativeTimeFormatUnit = 'second';
    let value = diffSeconds;
    for (const [name, secondsInUnit] of DIVISIONS) {
      if (Math.abs(diffSeconds) >= secondsInUnit) {
        unit = name;
        value = Math.round(diffSeconds / secondsInUnit);
        break;
      }
    }
    text = formatter.relative.format(value, unit);
  }

  return (
    <time
      dateTime={then.toISOString()}
      title={absolute}
      className="font-mono text-xs text-muted"
    >
      {text}
    </time>
  );
}
