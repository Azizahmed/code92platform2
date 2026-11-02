'use client';

import {useState} from 'react';
import {Plus} from 'lucide-react';
import {useTranslations} from 'next-intl';

import Dialog from '@/components/Dialog';
import {createCycleReleaseAction} from '@/lib/actions/releases';
import {useServerAction} from '@/lib/use-server-action';

// A cycle is a release after the MVP: a version, a one-line goal and a target.
// The stages and the artifacts it needs come from the policy, not from here.
export default function NewCycleButton({
  productId,
  products,
  defaultTargetDate
}: {
  productId?: string;
  products?: {id: string; name: string}[];
  defaultTargetDate: string;
}) {
  const t = useTranslations('releases');
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(productId ?? '');
  const [version, setVersion] = useState('');
  const [goal, setGoal] = useState('');
  const [targetDate, setTargetDate] = useState(defaultTargetDate);
  const [criteria, setCriteria] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();

  const valid = chosen.length > 0 && version.trim().length > 0 && goal.trim().length > 0;
  const input =
    'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50';

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setError(null);
    void run(async () => {
      const result = await createCycleReleaseAction({
        productId: chosen,
        version: version.trim(),
        goal: goal.trim(),
        targetDate: targetDate || null,
        successCriteria: criteria.trim() || null
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 px-3 py-2 text-xs text-accent transition-colors hover:bg-accent/10"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        {t('cycle.newAction')}
      </button>

      {open ? (
        <Dialog title={t('cycle.title')} subtitle={t('cycle.subtitle')} onClose={() => setOpen(false)} wide>
          <form onSubmit={submit} className="space-y-4">
            {products ? (
              <label className="block space-y-1.5">
                <span className="text-xs text-muted">{t('cycle.product')}</span>
                <select value={chosen} onChange={(event) => setChosen(event.target.value)} required className={input}>
                  <option value="">{t('cycle.pickProduct')}</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>{product.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs text-muted">{t('cycle.version')}</span>
                <input
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  maxLength={60}
                  required
                  dir="ltr"
                  placeholder="1.1.0"
                  className={input}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs text-muted">{t('cycle.targetDate')}</span>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(event) => setTargetDate(event.target.value)}
                  className={input}
                />
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs text-muted">{t('cycle.goal')}</span>
              <input
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                maxLength={240}
                required
                placeholder={t('cycle.goalPlaceholder')}
                className={input}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs text-muted">{t('cycle.criteria')}</span>
              <textarea
                value={criteria}
                onChange={(event) => setCriteria(event.target.value)}
                rows={3}
                maxLength={5000}
                className={input}
              />
            </label>
            {error ? (
              <p role="alert" className="text-xs text-danger">
                {t(`errors.${error}`)}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                {t('actions.cancel')}
              </button>
              <button
                type="submit"
                disabled={pending || !valid}
                className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg transition-opacity disabled:opacity-40"
              >
                {pending ? t('cycle.creating') : t('cycle.create')}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}
