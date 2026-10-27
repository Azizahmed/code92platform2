'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';

import {createTaskAction, patchTaskAction} from '@/lib/actions/tasks';
import {useServerAction} from '@/lib/use-server-action';

export type ProjectTaskRow = {
  id: string;
  title: string;
  status: 'pending' | 'completed';
  due_date: string | null;
  assignee_name: string | null;
};

// The project's work. The same task model as a product's, scoped to the project
// rather than to a product or a release.
export default function ProjectTasks({
  projectId,
  tasks,
  canEdit
}: {
  projectId: string;
  tasks: ProjectTaskRow[];
  canEdit: boolean;
}) {
  const t = useTranslations('projects');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();
  const open = tasks.filter((task) => task.status === 'pending');
  const done = tasks.filter((task) => task.status === 'completed');

  return (
    <section className="space-y-3">
      {tasks.length === 0 ? <p className="text-xs text-faint">{t('tasks.empty')}</p> : null}
      <ul className="space-y-1.5">
        {[...open, ...done].map((task) => (
          <li key={task.id} className="flex items-center gap-2.5 rounded-md border border-hairline px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={task.status === 'completed'}
              disabled={!canEdit || pending}
              aria-label={task.title}
              onChange={(event) =>
                void run(async () => {
                  const result = await patchTaskAction(task.id, {
                    status: event.target.checked ? 'completed' : 'pending'
                  });
                  if (!result.ok) setError(result.error);
                })
              }
              className="accent-accent"
            />
            <span className={`min-w-0 flex-1 truncate ${task.status === 'completed' ? 'text-faint line-through' : 'text-ink'}`}>
              {task.title}
            </span>
            {task.assignee_name ? <span className="shrink-0 text-faint">{task.assignee_name}</span> : null}
            {task.due_date ? <span className="shrink-0 font-mono text-[10px] text-faint">{task.due_date}</span> : null}
          </li>
        ))}
      </ul>

      {canEdit ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const text = title.trim();
            if (!text) return;
            setError(null);
            void run(async () => {
              const result = await createTaskAction({
                productId: null,
                parentTaskId: null,
                title: text,
                notes: null,
                dueDate: null,
                assigneeId: null,
                projectId
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setTitle('');
            });
          }}
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={240}
            placeholder={t('tasks.placeholder')}
            aria-label={t('tasks.add')}
            className="min-w-0 flex-1 rounded-md border border-hairline bg-bg px-2.5 py-1.5 text-xs outline-none placeholder:text-faint focus:border-accent/50"
          />
          <button type="submit" disabled={pending || title.trim().length === 0} className="rounded-md border border-hairline px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40">
            {t('tasks.add')}
          </button>
        </form>
      ) : null}
      {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
    </section>
  );
}
