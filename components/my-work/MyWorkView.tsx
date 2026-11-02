'use client';

import {useTranslations} from 'next-intl';
import {useState} from 'react';

import AllTasksBoard, {type AllTaskItem} from '@/components/tasks/AllTasksBoard';
import WaitingList from '@/components/my-work/WaitingList';

export type WaitingSource =
  | 'business_gate_pending'
  | 'release_spec_approval'
  | 'release_stage_ready'
  | 'proposal_pending'
  | 'review_overdue'
  | 'mention_unreplied'
  | 'deal_stale'
  | 'deal_closing';

// Row of public.my_waiting_on().
export type WaitingItem = {
  source: WaitingSource;
  record_id: string;
  context_id: string | null;
  title: string;
  subtitle: string | null;
  due_on: string | null;
};

export type Option = {id: string; name: string};
export type MemberOption = {userId: string; displayName: string};

type Tab = 'assigned' | 'waiting';

// My work is the personal inbox: the decisions and replies waiting on me, and
// my own tasks. The task tab is the same board as All tasks, scoped to me —
// one task screen with one set of controls, not two that drift apart.
export default function MyWorkView({
  initialTab,
  tasks,
  waiting,
  products,
  members,
  today,
  locale,
  currentUserId,
  openNew = false
}: {
  initialTab: Tab;
  tasks: AllTaskItem[];
  waiting: WaitingItem[];
  products: Option[];
  members: MemberOption[];
  today: string;
  locale: string;
  currentUserId: string;
  openNew?: boolean;
}) {
  const t = useTranslations('myWork');
  const [tab, setTab] = useState<Tab>(initialTab);
  const openCount = tasks.filter((task) => task.status === 'pending').length;

  function chooseTab(next: Tab) {
    setTab(next);
    // Keep the tab shareable without a server round trip.
    const url = new URL(window.location.href);
    if (next === 'assigned') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  }

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label={t('title')} className="flex gap-1 border-b border-hairline">
        {(['assigned', 'waiting'] as Tab[]).map((value) => {
          const count = value === 'assigned' ? openCount : waiting.length;
          const selected = tab === value;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => chooseTab(value)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors ${
                selected ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {t(`tabs.${value}`)}
              <span
                className={`rounded px-1.5 font-mono text-[10px] ${
                  value === 'waiting' && count > 0 ? 'bg-amber/10 text-amber' : 'bg-raised text-faint'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {tab === 'waiting' ? (
        <WaitingList items={waiting} today={today} locale={locale} />
      ) : (
        <AllTasksBoard
          tasks={tasks}
          products={products}
          members={members}
          currentUserId={currentUserId}
          locale={locale}
          today={today}
          mode="mine"
          openNew={openNew}
        />
      )}
    </div>
  );
}
