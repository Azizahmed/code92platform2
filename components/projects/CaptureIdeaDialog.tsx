'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';

import Dialog from '@/components/Dialog';
import {captureProjectIdeaAction} from '@/lib/actions/projects';
import {useServerAction} from '@/lib/use-server-action';

// An idea that came out of a project becomes a product at Idea. Nothing else
// happens: whether it is worth a record is the team's decision, made by capturing it.
export default function CaptureIdeaDialog({
  projectId,
  onClose,
  onCaptured
}: {
  projectId: string;
  onClose: () => void;
  onCaptured: (productId: string) => void;
}) {
  const t = useTranslations('projects');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();
  const valid = name.trim().length > 0 && problem.trim().length > 0;

  return (
    <Dialog title={t('idea.title')} subtitle={t('idea.hint')} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          setError(null);
          void run(async () => {
            const result = await captureProjectIdeaAction({projectId, name, problem});
            if (!result.ok || !result.id) {
              setError(result.ok ? 'generic' : result.error);
              return;
            }
            onCaptured(result.id);
          });
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('idea.name')}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} required autoFocus className="w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none focus:border-accent/50" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{t('idea.problem')}</span>
          <textarea value={problem} onChange={(event) => setProblem(event.target.value)} rows={4} maxLength={5000} required className="w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none focus:border-accent/50" />
        </label>
        {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-hairline px-3 py-2 text-xs text-muted hover:bg-raised hover:text-ink">{t('actions.cancel')}</button>
          <button type="submit" disabled={pending || !valid} className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg disabled:opacity-40">
            {pending ? t('idea.capturing') : t('idea.capture')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
