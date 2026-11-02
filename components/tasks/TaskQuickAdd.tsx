'use client';

import {CalendarDays, Package, Plus, SlidersHorizontal, UserRound} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useRef, useState} from 'react';

import type {TaskEditorDefaults} from '@/components/tasks/TaskEditorDialog';
import {useToast} from '@/components/ui/ToastProvider';
import {useRouter} from '@/i18n/navigation';
import {drainNotificationEmailsAction} from '@/lib/actions/notifications';
import {createTaskAction} from '@/lib/actions/tasks';
import {businessDate} from '@/lib/dates';
import {openTaskDrawer} from '@/lib/task-drawer';

type Option = {id: string; name: string};
type Member = {userId: string; displayName: string};

const CHIP =
  'h-9 rounded-md border border-hairline bg-bg px-2.5 text-xs text-muted outline-none transition-colors focus:border-accent/50 hover:border-accent/30';

// The one way to add a task, on every screen: type a title, press Enter.
// Owner, date and product are optional chips beside it; everything else
// (notes, files) lives behind "More options" or in the task panel later.
export default function TaskQuickAdd({
  members,
  products,
  productId,
  projectId = null,
  parentTaskId = null,
  defaultAssigneeId = null,
  placeholder,
  compact = false,
  autoFocus = false,
  onMoreOptions,
  onCreated
}: {
  members: Member[];
  // Offered as a chip only when the product is not fixed by the page.
  products?: Option[];
  // undefined = choosable (General by default); a string or null = fixed.
  productId?: string | null;
  projectId?: string | null;
  parentTaskId?: string | null;
  defaultAssigneeId?: string | null;
  placeholder?: string;
  // One line, smaller: subtasks and project lists.
  compact?: boolean;
  autoFocus?: boolean;
  onMoreOptions?: (draft: TaskEditorDefaults) => void;
  onCreated?: (taskId: string) => void;
}) {
  const t = useTranslations('tasks');
  const toast = useToast();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId ?? '');
  const [dueDate, setDueDate] = useState('');
  const [chosenProduct, setChosenProduct] = useState('');
  const [pending, setPending] = useState(false);
  const productFixed = productId !== undefined || Boolean(projectId) || Boolean(parentTaskId);
  const effectiveProduct = productFixed ? productId ?? null : chosenProduct || null;
  const today = businessDate();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = title.trim();
    if (!text || pending) return;
    setPending(true);
    const result = await createTaskAction({
      productId: projectId ? null : effectiveProduct,
      parentTaskId,
      title: text,
      notes: null,
      dueDate: dueDate || null,
      assigneeId: assigneeId || null,
      projectId
    });
    setPending(false);
    if (!result.ok) {
      toast({message: t(`errors.${result.error}`), tone: 'error'});
      return;
    }
    // Assigning someone notifies them; push any emails that asked for it.
    if (assigneeId) void drainNotificationEmailsAction();
    setTitle('');
    setDueDate('');
    inputRef.current?.focus();
    onCreated?.(result.taskId);
    toast({
      message: t('feedback.created'),
      actions: [{label: t('feedback.open'), onClick: () => openTaskDrawer(result.taskId)}]
    });
    setTimeout(() => router.refresh(), 0);
  }

  return (
    <form
      onSubmit={submit}
      className={compact ? 'space-y-2' : 'rounded-lg border border-hairline bg-panel p-2.5'}
    >
      <div
        className={
          compact ? 'flex flex-col gap-2' : 'flex flex-col gap-2 lg:flex-row lg:items-center'
        }
      >
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t('form.title')}</span>
          <Plus
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent"
            strokeWidth={2}
          />
          <input
            ref={inputRef}
            autoFocus={autoFocus}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={240}
            placeholder={placeholder ?? t('quickAdd.placeholder')}
            className={`w-full rounded-md border border-hairline bg-bg ps-9 pe-3 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50 ${
              compact ? 'h-9' : 'h-10'
            }`}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">{t('form.assignee')}</span>
            <UserRound className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" strokeWidth={1.75} />
            <select
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              className={`${CHIP} max-w-[11rem] ps-8`}
            >
              <option value="">{t('form.unassigned')}</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </label>

          <label className="relative">
            <span className="sr-only">{t('form.dueDate')}</span>
            <CalendarDays className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" strokeWidth={1.75} />
            <input
              type="date"
              value={dueDate}
              min={today}
              onChange={(event) => setDueDate(event.target.value)}
              className={`${CHIP} w-[9.5rem] ps-8 font-mono ${dueDate ? 'text-ink' : ''}`}
            />
          </label>

          {!productFixed && products ? (
            <label className="relative">
              <span className="sr-only">{t('form.product')}</span>
              <Package className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" strokeWidth={1.75} />
              <select
                value={chosenProduct}
                onChange={(event) => setChosenProduct(event.target.value)}
                className={`${CHIP} max-w-[11rem] ps-8`}
              >
                <option value="">{t('form.generalTask')}</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {onMoreOptions ? (
            <button
              type="button"
              onClick={() =>
                onMoreOptions({
                  title: title.trim(),
                  assigneeId: assigneeId || null,
                  dueDate: dueDate || null,
                  productId: projectId ? null : effectiveProduct,
                  parentTaskId,
                  projectId
                })
              }
              title={t('quickAdd.more')}
              className={`${CHIP} inline-flex items-center gap-1.5`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">{t('quickAdd.more')}</span>
            </button>
          ) : null}

          <button
            type="submit"
            disabled={pending || !title.trim()}
            className="h-9 shrink-0 rounded-md bg-accent px-3.5 text-xs font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {pending ? t('form.creating') : t('quickAdd.add')}
          </button>
        </div>
      </div>
    </form>
  );
}
