'use client';

import {useLocale, useTranslations} from 'next-intl';

// Locale-aware relative timestamps ("3 days ago" / "قبل 3 أيام") rendered
// in IBM Plex Mono, per the console typography rules.
export default function RelativeTime({date}: {date: string | Date}) {
  const locale = useLocale();
  const t = useTranslations('common');

  const then = new Date(date);
  const diffSeconds = Math.round((then.getTime() - Date.now()) / 1000);

  const absolute = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(then);

  let text: string;
  if (Math.abs(diffSeconds) < 45) {
    text = t('time.justNow');
  } else {
    const divisions: [Intl.RelativeTimeFormatUnit, number][] = [
      ['year', 60 * 60 * 24 * 365],
      ['month', 60 * 60 * 24 * 30],
      ['week', 60 * 60 * 24 * 7],
      ['day', 60 * 60 * 24],
      ['hour', 60 * 60],
      ['minute', 60]
    ];
    const rtf = new Intl.RelativeTimeFormat(locale, {numeric: 'auto'});
    let unit: Intl.RelativeTimeFormatUnit = 'second';
    let value = diffSeconds;
    for (const [name, secondsInUnit] of divisions) {
      if (Math.abs(diffSeconds) >= secondsInUnit) {
        unit = name;
        value = Math.round(diffSeconds / secondsInUnit);
        break;
      }
    }
    text = rtf.format(value, unit);
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
