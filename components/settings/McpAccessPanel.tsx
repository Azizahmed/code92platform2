'use client';

import {useState, useTransition} from 'react';
import {Check, Copy, Loader2, Plug} from 'lucide-react';
import {useLocale, useTranslations} from 'next-intl';

import {createMcpTokenAction, revokeMcpTokenAction} from '@/lib/actions/mcp-tokens';
import {MCP_GRANTABLE_PERMISSIONS, type McpGrantablePermission} from '@/lib/mcp/permissions';
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
  const [permissions, setPermissions] = useState<ReadonlySet<McpGrantablePermission>>(new Set());
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
        const result = await createMcpTokenAction({name, permissions: [...permissions], expiresInDays});
        if (!result.ok) {setError(result.error); return;}
        setCreated(result.token);
        setName('');
        setPermissions(new Set());
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
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5"><span className="text-xs text-muted">{t('name')}</span>
            <input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)}
              placeholder={t('namePlaceholder')} disabled={pending || !available} className={INPUT} />
          </label>
          <label className="block space-y-1.5"><span className="text-xs text-muted">{t('expires')}</span>
            <select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value) as 30 | 90 | 365)}
              disabled={pending || !available} className={INPUT}>
              {([30, 90, 365] as const).map((days) => <option key={days} value={days}>{t('days', {count: days})}</option>)}
            </select>
          </label>
        </div>

        <fieldset className="space-y-2" disabled={pending || !available}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <legend className="text-xs text-muted">{t('permissionsLabel')}</legend>
            <div className="flex gap-2">
              <button type="button" className={BUTTON} onClick={() => setPermissions(new Set())}>{t('presetRead')}</button>
              <button type="button" className={BUTTON}
                onClick={() => setPermissions(new Set(MCP_GRANTABLE_PERMISSIONS))}>{t('presetFull')}</button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-start gap-3 rounded-md border border-hairline p-3 opacity-70">
              <input type="checkbox" checked disabled className="mt-0.5 h-4 w-4 shrink-0 accent-accent" />
              <span className="min-w-0">
                <span className="block text-sm">{t('permissions.read.label')}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-faint">{t('permissions.read.hint')}</span>
              </span>
            </label>
            {MCP_GRANTABLE_PERMISSIONS.map((permission) => <label key={permission}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-raised/40 ${
                permission === 'delete' && permissions.has(permission) ? 'border-danger/40' : 'border-hairline'}`}>
              <input type="checkbox" checked={permissions.has(permission)} className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                onChange={(event) => setPermissions((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(permission); else next.delete(permission);
                  return next;
                })} />
              <span className="min-w-0">
                <span className={`block text-sm ${permission === 'delete' ? 'text-danger' : ''}`}>
                  {t(`permissions.${permission}.label`)}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-faint">{t(`permissions.${permission}.hint`)}</span>
              </span>
            </label>)}
          </div>
        </fieldset>
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
                {token.permissions.map((permission) => <span key={permission}
                  className={`rounded border px-1.5 py-0.5 text-[10px] ${permission === 'delete'
                    ? 'border-danger/40 text-danger' : 'border-hairline text-muted'}`}>
                  {t(`permissions.${permission}.label`)}</span>)}
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
