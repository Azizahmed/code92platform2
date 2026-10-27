'use client';

import {useState} from 'react';
import {X} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {Link} from '@/i18n/navigation';
import {linkProjectKnowledgeAction} from '@/lib/actions/projects';
import {useServerAction} from '@/lib/use-server-action';

export type Deliverable = {id: string; title: string};

// Knowledge items that are the project's outputs: the report, the design, the
// handover notes. Linking is what makes them findable from the project.
export default function ProjectDeliverables({
  projectId,
  linked,
  options,
  canEdit
}: {
  projectId: string;
  linked: Deliverable[];
  options: Deliverable[];
  canEdit: boolean;
}) {
  const t = useTranslations('projects');
  const [pick, setPick] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();
  const linkedIds = new Set(linked.map((item) => item.id));
  const available = options.filter((item) => !linkedIds.has(item.id));

  return (
    <section className="space-y-3">
      {linked.length === 0 ? (
        <p className="text-xs text-faint">{t('deliverables.empty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {linked.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 rounded-md border border-hairline px-3 py-2 text-xs">
              <Link href={`/knowledge/${item.id}`} className="min-w-0 truncate text-ink hover:text-accent">{item.title}</Link>
              {canEdit ? (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={t('deliverables.unlink')}
                  onClick={() => void run(async () => {
                    const result = await linkProjectKnowledgeAction(projectId, item.id, false);
                    if (!result.ok) setError(result.error);
                  })}
                  className="rounded p-1 text-faint transition-colors hover:bg-raised hover:text-danger"
                >
                  <X className="h-3 w-3" strokeWidth={1.75} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit && available.length > 0 ? (
        <div className="flex gap-2">
          <select value={pick} onChange={(event) => setPick(event.target.value)} aria-label={t('deliverables.pick')} className="min-w-0 flex-1 rounded-md border border-hairline bg-bg px-2.5 py-1.5 text-xs outline-none focus:border-accent/50">
            <option value="">{t('deliverables.pick')}</option>
            {available.map((item) => (
              <option key={item.id} value={item.id}>{item.title}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={!pick || pending}
            onClick={() => void run(async () => {
              const result = await linkProjectKnowledgeAction(projectId, pick, true);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setPick('');
            })}
            className="rounded-md border border-hairline px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
          >
            {t('deliverables.link')}
          </button>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
    </section>
  );
}
