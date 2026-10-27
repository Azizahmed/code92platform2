'use client';

import {useState} from 'react';
import {X} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {setProjectMemberAction} from '@/lib/actions/projects';
import {useServerAction} from '@/lib/use-server-action';

export type TeamOption = {id: string; name: string};

// Who works on the engagement. Anyone active on the team can add a colleague.
export default function ProjectTeam({
  projectId,
  members,
  options,
  canEdit
}: {
  projectId: string;
  members: TeamOption[];
  options: TeamOption[];
  canEdit: boolean;
}) {
  const t = useTranslations('projects');
  const [pick, setPick] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();
  const memberIds = new Set(members.map((m) => m.id));
  const available = options.filter((option) => !memberIds.has(option.id));

  return (
    <section className="space-y-3">
      {members.length === 0 ? <p className="text-xs text-faint">{t('team.empty')}</p> : null}
      <ul className="flex flex-wrap gap-1.5">
        {members.map((member) => (
          <li key={member.id} className="inline-flex items-center gap-1 rounded-md border border-hairline px-2 py-1 text-xs text-muted">
            {member.name}
            {canEdit ? (
              <button
                type="button"
                disabled={pending}
                aria-label={t('team.remove')}
                onClick={() => void run(async () => {
                  const result = await setProjectMemberAction(projectId, member.id, false);
                  if (!result.ok) setError(result.error);
                })}
                className="rounded p-0.5 text-faint hover:text-danger"
              >
                <X className="h-3 w-3" strokeWidth={1.75} />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit && available.length > 0 ? (
        <div className="flex gap-2">
          <select value={pick} onChange={(event) => setPick(event.target.value)} aria-label={t('team.pick')} className="min-w-0 flex-1 rounded-md border border-hairline bg-bg px-2.5 py-1.5 text-xs outline-none focus:border-accent/50">
            <option value="">{t('team.pick')}</option>
            {available.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={!pick || pending}
            onClick={() => void run(async () => {
              const result = await setProjectMemberAction(projectId, pick, true);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setPick('');
            })}
            className="rounded-md border border-hairline px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
          >
            {t('team.add')}
          </button>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
    </section>
  );
}
