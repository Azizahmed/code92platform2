'use client';

import {CalendarDays} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {relativeDue, shortDay} from '@/lib/task-ui';

// "Today", "Tomorrow", "In 3 days", "2 days overdue" — with the calendar date
// in the tooltip. Completed tasks show the date quietly; overdue no longer
// applies to them.
export default function DueLabel({
  dueDate,
  today,
  locale,
  completed = false,
  showIcon = true,
  emptyLabel = false,
  className = ''
}: {
  dueDate: string | null;
  today: string;
  locale: string;
  completed?: boolean;
  showIcon?: boolean;
  // Show "No date" instead of nothing.
  emptyLabel?: boolean;
  className?: string;
}) {
  const t = useTranslations('tasks');
  const due = relativeDue(dueDate, today);

  if (due.kind === 'none') {
    return emptyLabel ? <span className={`text-faint ${className}`}>{t('due.none')}</span> : null;
  }

  const full = dueDate ? shortDay(dueDate, '0000', locale) : '';
  let label: string;
  let tone = 'text-muted';
  if (completed) {
    label = shortDay(dueDate!, today, locale);
    tone = 'text-faint';
  } else if (due.kind === 'overdue') {
    label = t('due.overdue', {count: due.days});
    tone = 'text-amber';
  } else if (due.kind === 'today') {
    label = t('due.today');
    tone = 'text-accent';
  } else if (due.kind === 'tomorrow') {
    label = t('due.tomorrow');
  } else if (due.kind === 'inDays') {
    label = t('due.inDays', {count: due.days});
  } else {
    label = shortDay(due.date, today, locale);
  }

  return (
    <span title={full} className={`inline-flex items-center gap-1 whitespace-nowrap ${tone} ${className}`}>
      {showIcon ? <CalendarDays className="h-3 w-3 shrink-0" strokeWidth={1.75} /> : null}
      {label}
    </span>
  );
}
