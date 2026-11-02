'use client';

import {ChevronDown} from 'lucide-react';
import {useTranslations} from 'next-intl';

import Menu from '@/components/ui/Menu';
import {STATUS_STYLE, WORKFLOW_STATUSES, type WorkflowStatus} from '@/lib/task-ui';

// The one status chip every task list shows. Read-only when `onChange` is
// absent; otherwise a menu of the four statuses.
export default function StatusMenu({
  status,
  onChange,
  overdue = false,
  size = 'sm'
}: {
  status: WorkflowStatus;
  onChange?: (status: WorkflowStatus) => void;
  // An open task past its date shows "Overdue" in amber on the chip, but the
  // menu still offers the four real statuses.
  overdue?: boolean;
  size?: 'sm' | 'md';
}) {
  const t = useTranslations('tasks');
  const style = STATUS_STYLE[status];
  const showOverdue = overdue && status !== 'done' && status !== 'blocked';
  const chipClass = showOverdue ? 'border-amber/30 bg-amber/10 text-amber' : style.chip;
  const dotClass = showOverdue ? 'bg-amber' : style.dot;
  const padding = size === 'md' ? 'px-2.5 py-1.5 text-xs' : 'px-2 py-1 text-[11px]';

  const content = (
    <>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
      <span className="whitespace-nowrap">
        {showOverdue ? t('all.status.overdue') : t(`status.${status}`)}
      </span>
    </>
  );

  if (!onChange) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-md border ${padding} ${chipClass}`}>
        {content}
      </span>
    );
  }

  return (
    <Menu
      label={t('status.change')}
      width={190}
      triggerClassName={`inline-flex items-center gap-1.5 rounded-md border ${padding} ${chipClass} transition-colors hover:brightness-110`}
      trigger={
        <>
          {content}
          <ChevronDown className="h-3 w-3 opacity-60" strokeWidth={2} />
        </>
      }
      items={WORKFLOW_STATUSES.map((value) => ({
        key: value,
        label: t(`status.${value}`),
        selected: value === status,
        leading: <span aria-hidden="true" className={`ms-1 me-1 h-2 w-2 shrink-0 rounded-full ${STATUS_STYLE[value].dot}`} />,
        onSelect: () => onChange(value)
      }))}
    />
  );
}
