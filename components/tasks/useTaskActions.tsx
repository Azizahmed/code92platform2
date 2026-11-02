'use client';

import {useTranslations} from 'next-intl';
import {useCallback, useEffect, useMemo, useState} from 'react';

import TaskCompletionDialog from '@/components/tasks/TaskCompletionDialog';
import {useConfirm} from '@/components/ui/ConfirmProvider';
import {useToast} from '@/components/ui/ToastProvider';
import {useRouter} from '@/i18n/navigation';
import {setTaskWorkflowStatusAction} from '@/lib/actions/my-work';
import {drainNotificationEmailsAction} from '@/lib/actions/notifications';
import {deleteTaskAction, patchTaskAction} from '@/lib/actions/tasks';
import {removeStoredImages} from '@/lib/media-upload';
import {openTaskDrawer} from '@/lib/task-drawer';
import {workflowOf, type WorkflowStatus} from '@/lib/task-ui';

// The fields every task action needs, whichever screen the row came from.
export type ActionableTask = {
  id: string;
  title: string;
  status: 'pending' | 'completed';
  workflow_status?: WorkflowStatus | null;
  release_id?: string | null;
  completion_note?: string | null;
};

type Override = {workflow_status: WorkflowStatus} | 'deleted';

// Optimistic changes laid over the server's list until its next render lands.
// Plain state rather than useOptimistic: the actions run outside a transition
// (see lib/use-server-action.ts), and the overrides must survive until the
// refreshed props arrive.
export function useTaskOverrides<T extends ActionableTask & {parent_task_id?: string | null}>(tasks: T[]) {
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  useEffect(() => setOverrides({}), [tasks]);

  const items = useMemo(() => {
    if (Object.keys(overrides).length === 0) return tasks;
    const deleted = new Set(
      Object.entries(overrides)
        .filter(([, value]) => value === 'deleted')
        .map(([id]) => id)
    );
    return tasks
      .filter((task) => !deleted.has(task.id) && !(task.parent_task_id && deleted.has(task.parent_task_id)))
      .map((task) => {
        const override = overrides[task.id];
        if (!override || override === 'deleted') return task;
        return {
          ...task,
          workflow_status: override.workflow_status,
          status: override.workflow_status === 'done' ? ('completed' as const) : ('pending' as const)
        };
      });
  }, [tasks, overrides]);

  const set = useCallback((taskId: string, value: Override | null) => {
    setOverrides((current) => {
      const next = {...current};
      if (value === null) delete next[taskId];
      else next[taskId] = value;
      return next;
    });
  }, []);

  return [items, set] as const;
}

type NoteRequest = {task: ActionableTask; mode: 'complete' | 'note'};

// Complete, reopen, change status, delete — with the same feedback on every
// screen: completing is one click with Undo; a note can be added from the
// toast; tasks inside a release still ask for the note up front, because the
// release record is where that evidence is read. Deleting asks first.
export function useTaskActions({
  onOverride,
  onError,
  onChanged
}: {
  // Optimistic hook for the list showing the task.
  onOverride?: (taskId: string, value: Override | null) => void;
  onError?: (key: string) => void;
  // Called after any successful change (the side panel reloads itself).
  onChanged?: () => void;
} = {}) {
  const t = useTranslations('tasks');
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const [noteRequest, setNoteRequest] = useState<NoteRequest | null>(null);
  const [savingNote, setSavingNote] = useState(false);

  // Actions revalidate the task pages they know about; a refresh also covers
  // the dashboard, a project or a release page showing the same task.
  // Deferred a tick so it is not entangled with the action's own response.
  const settled = useCallback(() => {
    onChanged?.();
    setTimeout(() => router.refresh(), 0);
  }, [onChanged, router]);

  const fail = useCallback(
    (key: string) => {
      onError?.(key);
      toast({message: t(`errors.${key}`), tone: 'error'});
    },
    [onError, toast, t]
  );

  const setStatus = useCallback(
    async (task: ActionableTask, status: WorkflowStatus, options: {quiet?: boolean} = {}) => {
      const previous = workflowOf(task);
      if (previous === status) return true;
      onOverride?.(task.id, {workflow_status: status});
      const result = await setTaskWorkflowStatusAction(task.id, status);
      if (!result.ok) {
        onOverride?.(task.id, null);
        fail(result.error === 'notFound' ? 'notFound' : 'generic');
        return false;
      }
      settled();
      if (!options.quiet && status === 'done') {
        toast({
          message: t('feedback.completed'),
          actions: [
            {
              label: t('feedback.undo'),
              onClick: () => void setStatus({...task, workflow_status: 'done', status: 'completed'}, previous, {quiet: true})
            },
            {
              label: t('feedback.addNote'),
              onClick: () => setNoteRequest({task: {...task, status: 'completed'}, mode: 'note'})
            }
          ]
        });
      } else if (!options.quiet) {
        toast({message: t('feedback.statusChanged', {status: t(`status.${status}`)}), tone: 'info'});
      }
      return true;
    },
    [fail, onOverride, settled, t, toast]
  );

  const complete = useCallback(
    (task: ActionableTask) => {
      if (task.release_id) {
        setNoteRequest({task, mode: 'complete'});
        return;
      }
      void setStatus(task, 'done');
    },
    [setStatus]
  );

  const toggle = useCallback(
    (task: ActionableTask) => {
      if (task.status === 'completed') void setStatus(task, 'todo');
      else complete(task);
    },
    [complete, setStatus]
  );

  const remove = useCallback(
    async (task: ActionableTask) => {
      const ok = await confirm({
        title: t('task.deleteTitle'),
        body: t('task.deleteConfirm'),
        confirmLabel: t('task.delete')
      });
      if (!ok) return false;
      onOverride?.(task.id, 'deleted');
      const result = await deleteTaskAction(task.id);
      if (!result.ok) {
        onOverride?.(task.id, null);
        fail(result.error);
        return false;
      }
      // The rows went with the task; the stored files behind them did not.
      if (result.storageKeys?.length) void removeStoredImages(result.storageKeys);
      toast({message: t('feedback.deleted'), tone: 'info'});
      settled();
      return true;
    },
    [confirm, fail, onOverride, settled, t, toast]
  );

  async function saveNote(note: string | null) {
    if (!noteRequest) return;
    const {task, mode} = noteRequest;
    setSavingNote(true);
    if (mode === 'complete') onOverride?.(task.id, {workflow_status: 'done'});
    const result = await patchTaskAction(task.id, {
      ...(mode === 'complete' ? {status: 'completed' as const} : {}),
      completionNote: note
    });
    setSavingNote(false);
    setNoteRequest(null);
    if (!result.ok) {
      if (mode === 'complete') onOverride?.(task.id, null);
      fail(result.error);
      return;
    }
    if (mode === 'complete') void drainNotificationEmailsAction();
    toast({
      message: mode === 'complete' ? t('feedback.completed') : t('feedback.noteSaved'),
      ...(mode === 'complete'
        ? {
            actions: [
              {
                label: t('feedback.undo'),
                onClick: () =>
                  void setStatus({...task, workflow_status: 'done', status: 'completed'}, workflowOf(task), {quiet: true})
              }
            ]
          }
        : {})
    });
    settled();
  }

  const dialog = noteRequest ? (
    <TaskCompletionDialog
      taskTitle={noteRequest.task.title}
      initialNote={noteRequest.task.completion_note}
      pending={savingNote}
      allowSkip={noteRequest.mode === 'complete'}
      onCancel={() => setNoteRequest(null)}
      onConfirm={(note) => void saveNote(note)}
    />
  ) : null;

  return {
    setStatus,
    complete,
    toggle,
    remove,
    addNote: (task: ActionableTask) => setNoteRequest({task, mode: 'note'}),
    open: openTaskDrawer,
    dialog
  };
}
