'use client';

import {Plus} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {useRef, useState} from 'react';

import {quickCaptureTaskAction} from '@/lib/actions/my-work';
import {useServerAction} from '@/lib/use-server-action';

type Option = {id: string; name: string};

// Title, optional product (General by default), optional due date. The task
// is always assigned to the caller.
export default function QuickCapture({products}: {products: Option[]}) {
  const t = useTranslations('myWork');
  const [title, setTitle] = useState('');
  const [productId, setProductId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useServerAction();
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setError(null);
    void run(async () => {
      const result = await quickCaptureTaskAction({
        title,
        productId: productId || null,
        dueDate: dueDate || null
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTitle('');
      setDueDate('');
      inputRef.current?.focus();
    });
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-hairline bg-panel p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">{t('capture.title')}</span>
          <Plus className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" strokeWidth={1.75} />
          <input
            ref={inputRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={240}
            placeholder={t('capture.placeholder')}
            className="w-full rounded-md border border-hairline bg-bg py-2 ps-9 pe-3 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50"
          />
        </label>
        <div className="flex gap-2">
          <label className="min-w-0 flex-1 sm:flex-none">
            <span className="sr-only">{t('capture.product')}</span>
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              className="w-full rounded-md border border-hairline bg-bg px-2.5 py-2 text-xs text-muted outline-none transition-colors focus:border-accent/50 sm:w-40"
            >
              <option value="">{t('general')}</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">{t('capture.dueDate')}</span>
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="rounded-md border border-hairline bg-bg px-2.5 py-2 font-mono text-xs text-muted outline-none transition-colors focus:border-accent/50"
            />
          </label>
          <button
            type="submit"
            disabled={pending || !title.trim()}
            className="shrink-0 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {pending ? t('capture.adding') : t('capture.add')}
          </button>
        </div>
      </div>
      {error ? <p className="mt-2 text-xs text-danger">{t(`errors.${error}`)}</p> : null}
    </form>
  );
}
