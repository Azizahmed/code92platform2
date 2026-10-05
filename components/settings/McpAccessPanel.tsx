'use client';

import {useState, useTransition} from 'react';
import {Check, Copy, Loader2, Plug} from 'lucide-react';
import {useLocale, useTranslations} from 'next-intl';

import {createMcpTokenAction, revokeMcpTokenAction} from '@/lib/actions/mcp-tokens';
import type {McpTokenRow} from '@/lib/mcp/token-types';

const INPUT = 'w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none focus:border-accent/50 disabled:opacity-50';
const BUTTON = 'rounded-md border border-hairline px-3 py-2 text-xs text-muted hover:bg-raised disabled:opacity-40';

function CopyBlock({label, value}: {label: string; value: string}) {
  const t = useTranslations('settings.mcp');
  const [copied, setCopied] = useState(false);
  return <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted">{label}</span>
      <button type="button" className="flex items-center gap-1 text-[11px] text-muted hover:text-ink"
        onClick={() => {void navigator.clipboard.writeText(value).then(() => setCopied(true));}}>
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? t('copied') : t('copy')}
      </button>
    </div>
    <pre dir="ltr" className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-hairline bg-bg p-3 text-start font-mono text-[11px] leading-relaxed">{value}</pre>
  </div>;
}

export default function McpAccessPanel({tokens, endpoint, available}: {
  tokens: McpTokenRow[];
  endpoint: string;
  available: boolean;
}) {
  const t = useTranslations('settings.mcp');
  const locale = useLocale();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [expiresInDays, setExpiresInDays] = useState<30 | 90 | 365>(90);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const date = new Intl.DateTimeFormat(locale, {dateStyle: 'medium'});
  const now = Date.now();

  function create() {
    setError(null);
    setCreated(null);
    startTransition(async () => {
      try {
        const result = await createMcpTokenAction({name, scope, expiresInDays});
        if (!result.ok) {setError(result.error); return;}
        setCreated(result.token);
        setName('');
      } catch {setError('failed');}
    });
  }

  function revoke(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        if (!(await revokeMcpTokenAction(id)).ok) setError('failed');
      } catch {setError('failed');}
    });
  }

  const config = (token: string) => JSON.stringify({mcpServers: {code92: {
    type: 'http', url: endpoint, headers: {Authorization: `Bearer ${token}`}
  }}}, null, 2);

  return <section className="space-y-3">
    <h2 className="flex items-center gap-2 text-sm font-medium"><Plug className="h-4 w-4 text-muted" />{t('title')}</h2>
    <div className="space-y-4 rounded-lg border border-hairline bg-panel p-4">
      <p className="text-sm leading-relaxed text-muted">{t('intro')}</p>
      {!available ? <p role="alert" className="text-xs text-danger">{t('unavailable')}</p> : null}
      <CopyBlock label={t('endpoint')} value={endpoint} />

      <form className="space-y-3" onSubmit={(event) => {event.preventDefault(); create();}}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-1.5"><span className="text-xs text-muted">{t('name')}</span>
            <input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)}
              placeholder={t('namePlaceholder')} disabled={pending || !available} className={INPUT} />
          </label>
          <label className="block space-y-1.5"><span className="text-xs text-muted">{t('scope')}</span>
            <select value={scope} onChange={(event) => setScope(event.target.value as 'read' | 'write')}
              disabled={pending || !available} className={INPUT}>
              <option value="read">{t('scopeRead')}</option>
              <option value="write">{t('scopeWrite')}</option>
            </select>
          </label>
          <label className="block space-y-1.5"><span className="text-xs text-muted">{t('expires')}</span>
            <select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value) as 30 | 90 | 365)}
              disabled={pending || !available} className={INPUT}>
              {([30, 90, 365] as const).map((days) => <option key={days} value={days}>{t('days', {count: days})}</option>)}
            </select>
          </label>
        </div>
        <p className="text-[11px] leading-relaxed text-faint">{t('scopeHint')}</p>
        <button type="submit" disabled={pending || !available || !name.trim()}
          className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-xs font-medium text-bg disabled:opacity-40">
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{t('create')}
        </button>
      </form>

      {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}

      {created ? <div className="space-y-3 rounded-md border border-accent/30 bg-accent/5 p-3">
        <p role="status" className="text-xs font-medium text-accent">{t('createdOnce')}</p>
        <CopyBlock label={t('token')} value={created} />
        <CopyBlock label={t('claudeCode')}
          value={`claude mcp add --transport http code92 ${endpoint} --header "Authorization: Bearer ${created}"`} />
        <CopyBlock label={t('jsonConfig')} value={config(created)} />
      </div> : null}

      {tokens.length ? <ul className="divide-y divide-hairline rounded-md border border-hairline">
        {tokens.map((token) => {
          const state = token.revoked_at ? 'revoked' : Date.parse(token.expires_at) <= now ? 'expired' : 'active';
          return <li key={token.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm">{token.name}</span>
                <span dir="ltr" className="font-mono text-[11px] text-faint">{token.token_prefix}…</span>
                <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-muted">
                  {t(token.scope === 'write' ? 'scopeWrite' : 'scopeRead')}</span>
                {state !== 'active' ? <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-faint">
                  {t(state)}</span> : null}
              </div>
              <p className="text-[11px] text-faint">
                {t('meta', {
                  created: date.format(new Date(token.created_at)),
                  expires: date.format(new Date(token.expires_at)),
                  used: token.last_used_at ? date.format(new Date(token.last_used_at)) : t('never')
                })}
              </p>
            </div>
            {state === 'active' ? <button type="button" disabled={pending} className={BUTTON}
              onClick={() => revoke(token.id)}>{t('revoke')}</button> : null}
          </li>;
        })}
      </ul> : <p className="text-xs text-faint">{t('empty')}</p>}
    </div>
  </section>;
}
