'use client';

import {useTranslations} from 'next-intl';
import {useEffect} from 'react';

import TaskEditorDialog, {type TaskEditorDefaults} from '@/components/tasks/TaskEditorDialog';
import type {TaskMemberOption} from '@/components/products/ProductTasksPanel';
import type {TaskProductOption} from '@/components/tasks/AllTasksBoard';
import type {ProductTask} from '@/lib/actions/tasks';

// The full task form in a modal: "More options" from quick add, and Edit from a
// row's menu. One shell for every screen, bottom sheet on phones.
export default function TaskEditorModal({
  task,
  products,
  members,
  defaults,
  lockProduct,
  onClose,
  onError
}: {
  task?: ProductTask;
  products: TaskProductOption[];
  members: TaskMemberOption[];
  defaults?: TaskEditorDefaults;
  lockProduct?: boolean;
  onClose: (createdTaskId?: string) => void;
  onError: (key: string) => void;
}) {
  const t = useTranslations('tasks');

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={task ? t('form.editTitle') : t('form.newTitle')}
      className="fixed inset-0 z-[60] flex items-end justify-center p-3 sm:items-center"
    >
      <button
        type="button"
        aria-label={t('form.cancel')}
        onClick={() => onClose()}
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />
      <div className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-hairline bg-panel p-5 shadow-2xl">
        <TaskEditorDialog
          key={task?.id ?? 'new'}
          task={task}
          products={products}
          members={members}
          defaults={defaults}
          lockProduct={lockProduct}
          bare
          onDone={onClose}
          onError={onError}
        />
      </div>
    </div>
  );
}
