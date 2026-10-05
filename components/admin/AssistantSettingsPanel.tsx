'use client';

import {useState, useTransition} from 'react';
import {Bot, Loader2} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {clearAssistantSettingsAction, getAssistantSettingsAction,
  saveAssistantSettingsAction, testAssistantSettingsAction} from '@/lib/actions/assistant-settings';
import type {AssistantSettingsResult, AssistantSettingsStatus} from '@/lib/assistant/settings-schema';

const INPUT = 'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none focus:border-accent/50 disabled:opacity-50';
const BUTTON = 'rounded-md border border-hairline px-3 py-2 text-xs text-muted hover:bg-raised disabled:opacity-40';

export default function AssistantSettingsPanel({status}: {status: AssistantSettingsStatus | null}) {
  const t = useTranslations('assistant.setup');
  const [current, setCurrent] = useState(status);
  const [baseUrl, setBaseUrl] = useState(status?.baseUrl ?? '');
  const [model, setModel] = useState(status?.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(operation: () => Promise<AssistantSettingsResult>, success: string, refresh = false) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await operation();
        if (!result.ok) {setError(result.error); return;}
        if (refresh) {
          setApiKey('');
          const next = await getAssistantSettingsAction();
          setCurrent(next);
          setBaseUrl(next?.baseUrl ?? '');
          setModel(next?.model ?? '');
        }
        setMessage(t(success));
      } catch {setError('unavailable');}
    });
  }

  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium"><Bot className="h-4 w-4 text-muted" />{t('title')}</h2>
      <span className={`rounded border px-2 py-0.5 text-[11px] ${current?.hasKey ? 'border-accent/30 bg-accent/10 text-accent' : 'border-hairline text-muted'}`}>
        {t(current?.source === 'admin' ? 'configured' : current?.source === 'environment' ? 'environment' : 'notConfigured')}
      </span>
    </div>
    <div className="space-y-4 rounded-lg border border-hairline bg-panel p-4">
      <p className="text-sm leading-relaxed text-muted">{t('intro')}</p>
      {!current?.available ? <p role="alert" className="text-xs text-danger">{t('errors.unavailable')}</p> : null}
      <form onSubmit={(event) => {event.preventDefault(); run(() => saveAssistantSettingsAction({baseUrl, model, apiKey}), 'saved', true);}}
        className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5"><span className="text-xs text-muted">{t('baseUrl')}</span>
            <input type="url" dir="ltr" required maxLength={2048} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://provider.example/v1" disabled={pending || !current?.available} className={INPUT} />
          </label>
          <label className="block space-y-1.5"><span className="text-xs text-muted">{t('model')}</span>
            <input dir="ltr" required maxLength={200} value={model} onChange={(event) => setModel(event.target.value)}
              autoComplete="off" spellCheck={false} disabled={pending || !current?.available} className={INPUT} />
          </label>
        </div>
        <p className="text-[11px] leading-relaxed text-faint">{t('urlHint')}</p>
        <label className="block space-y-1.5"><span className="text-xs text-muted">{t('apiKey')}</span>
          <input type="password" dir="ltr" autoComplete="off" spellCheck={false} maxLength={4096}
            required={current?.source !== 'admin'} value={apiKey} onChange={(event) => setApiKey(event.target.value)}
            placeholder={current?.source === 'admin' ? t('keySaved') : ''}
            disabled={pending || !current?.available} className={INPUT} />
        </label>
        <p className="text-[11px] leading-relaxed text-faint">{t('keyHint')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending || !current?.available}
            className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-xs font-medium text-bg disabled:opacity-40">
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{t('save')}
          </button>
          <button type="button" disabled={pending || !current?.hasKey} className={BUTTON}
            onClick={() => run(testAssistantSettingsAction, 'testOk')}>{t('test')}</button>
          {current?.source === 'admin' ? <button type="button" disabled={pending} className={BUTTON}
            onClick={() => run(clearAssistantSettingsAction, 'cleared', true)}>{t('clear')}</button> : null}
        </div>
        <p className="text-[11px] text-faint">{t('testHint')}</p>
      </form>
      {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
      {message ? <p role="status" className="text-xs text-accent">{message}</p> : null}
    </div>
  </section>;
}
