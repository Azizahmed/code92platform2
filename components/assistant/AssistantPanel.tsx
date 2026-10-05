'use client';

import {memo, useEffect, useRef, useState} from 'react';
import {Bot, Check, Loader2, Plus, Send, X} from 'lucide-react';
import {useLocale, useTranslations} from 'next-intl';
import Markdown from '@/components/knowledge/Markdown';
import {Link, usePathname, useRouter} from '@/i18n/navigation';
import {parseEventLine, type AssistantEvent, type ChatMessage, type ToolResult} from '@/lib/assistant/protocol';

type Activity = {id: string; tool: string; result?: ToolResult};
type Entry = ChatMessage & {id: string; activities?: Activity[]; error?: string};
const Answer = memo(function Answer({content}: {content: string}) {
  return <Markdown content={content} />;
});
const KNOWN_ERRORS = new Set(['notConfigured', 'forbidden', 'invalid', 'busy',
  'rateLimited', 'providerError', 'timeout', 'stepLimit', 'generic']);
const TOOL_NAMES = new Set(['list_records', 'search_knowledge', 'read_knowledge',
  'create_task', 'update_task', 'post_status_update', 'create_knowledge_note']);

export default function AssistantPanel({open, onClose}: {open: boolean; onClose: () => void}) {
  const t = useTranslations('assistant');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const nextEntryId = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    composerRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [open]);
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [entries, open]);

  async function send(text = draft) {
    const content = text.trim();
    if (!content || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setDraft('');
    // Only completed conversational messages go back to the provider; action
    // results are produced by the server, never trusted from the browser.
    const messages: ChatMessage[] = [...entries.filter((entry) => entry.content && !entry.error)
      .map(({role, content}) => ({role, content})), {role: 'user' as const, content}].slice(-20);
    while (messages.length > 1 && messages.reduce((size, message) => size + message.content.length, 0) > 60000) {
      messages.shift();
    }
    const id = `assistant-${nextEntryId.current++}`;
    const userEntryId = `user-${nextEntryId.current++}`;
    setEntries((current) => [...current,
      {id: userEntryId, role: 'user', content},
      {id, role: 'assistant', content: '', activities: []}]);
    const controller = new AbortController();
    requestRef.current = controller;
    let changed = false;
    let finished = false;
    const receive = (event: AssistantEvent) => {
      if (event.type === 'done') {finished = true; return;}
      if (event.type === 'result' && event.result.changed) changed = true;
      setEntries((current) => current.map((entry) => {
        if (entry.id !== id) return entry;
        if (event.type === 'answer') return {...entry, content: event.content};
        if (event.type === 'error') return {...entry, error: event.error};
        if (event.type === 'working') return {...entry, activities: [...(entry.activities ?? []), event]};
        if (event.type === 'result') return {...entry, activities: (entry.activities ?? [])
          .map((activity) => activity.id === event.id ? {...activity, result: event.result} : activity)};
        return entry;
      }));
    };
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({messages, locale, pathname}), signal: controller.signal
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        receive({type: 'error', error: body.error ?? 'generic'});
        return;
      }
      if (!response.body) throw new Error('empty stream');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let remainder = '';
      try {
        while (true) {
          const {done, value} = await reader.read();
          remainder += done ? decoder.decode() : decoder.decode(value, {stream: true});
          const lines = remainder.split('\n');
          remainder = lines.pop() ?? '';
          for (const line of lines) if (line.trim()) receive(parseEventLine(line));
          if (done) {
            if (remainder.trim()) receive(parseEventLine(remainder));
            break;
          }
        }
      } finally {reader.releaseLock();}
      if (!finished) throw new Error('interrupted stream');
    } catch {
      if (!controller.signal.aborted) receive({type: 'error', error: 'generic'});
    } finally {
      inFlight.current = false;
      requestRef.current = null;
      setPending(false);
      if (changed) router.refresh();
    }
  }

  return (
    <aside id="platform-assistant" aria-label={t('title')} hidden={!open}
      className={`${open ? 'flex' : 'hidden'} assistant-dock fixed inset-y-0 z-40 w-full max-w-[380px] flex-col border-s border-hairline bg-panel shadow-xl xl:shadow-none`}>
      <header className="flex h-[61px] shrink-0 items-center justify-between gap-3 border-b border-hairline px-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent"><Bot className="h-4 w-4" /></span>
          <div><h2 className="text-sm font-semibold">{t('title')}</h2><p className="text-[11px] text-faint">{t('subtitle')}</p></div>
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={() => {setEntries([]); setDraft(''); composerRef.current?.focus();}}
            disabled={pending} aria-label={t('newChat')} title={t('newChat')}
            className="rounded-md p-2 text-muted hover:bg-raised disabled:opacity-40"><Plus className="h-4 w-4" /></button>
          <button type="button" onClick={onClose} aria-label={t('close')}
            className="rounded-md p-2 text-muted hover:bg-raised"><X className="h-4 w-4" /></button>
        </div>
      </header>
      <div ref={scrollRef} role="log" aria-label={t('conversation')} aria-live="polite"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {entries.length === 0 ? (
          <div className="flex min-h-full flex-col justify-center gap-5 py-8">
            <div><h3 className="text-base font-medium">{t('welcome')}</h3><p className="mt-2 text-sm leading-relaxed text-muted">{t('welcomeBody')}</p></div>
            <div className="space-y-2">{(['overview', 'tasks', 'help'] as const).map((key) => (
              <button key={key} type="button" onClick={() => void send(t(`suggestions.${key}`))}
                className="w-full rounded-lg border border-hairline bg-bg px-3 py-2.5 text-start text-xs text-muted transition-colors hover:border-accent/30 hover:text-ink">{t(`suggestions.${key}`)}</button>
            ))}</div>
          </div>
        ) : (
          <ol className="space-y-5">{entries.map((entry) => (
            <li key={entry.id} className={entry.role === 'user' ? 'rounded-lg border border-hairline bg-raised px-3 py-2.5' : 'space-y-3'}>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-faint">{entry.role === 'user' ? t('you') : t('title')}</p>
              {entry.activities?.map((activity) => (
                <div key={activity.id} className="flex items-center gap-2 rounded-md border border-hairline bg-bg px-2.5 py-2 text-xs text-muted">
                  {!activity.result && pending ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    : activity.result?.ok ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" /> : <X className="h-3.5 w-3.5 shrink-0 text-danger" />}
                  <span className="flex-1">{TOOL_NAMES.has(activity.tool) ? t(`tools.${activity.tool}`) : t('working')}
                    {activity.result && !activity.result.ok ? ` · ${t('actionFailed')}` : null}
                    {!activity.result && !pending ? ` · ${t('interrupted')}` : null}
                  </span>
                  {activity.result?.ok && activity.result.changed && activity.result.href ? <Link href={activity.result.href} className="text-accent hover:underline">{t('view')}</Link> : null}
                </div>
              ))}
              {entry.content ? entry.role === 'assistant' ? <Answer content={entry.content} />
                : <p className="whitespace-pre-wrap break-words text-sm" dir="auto">{entry.content}</p> : null}
              {entry.error ? <p role="alert" className="text-xs leading-relaxed text-danger">{t(`errors.${KNOWN_ERRORS.has(entry.error) ? entry.error : 'generic'}`)}</p> : null}
              {pending && entry.id === entries.at(-1)?.id && !entry.content ? <p role="status" className="flex items-center gap-2 text-xs text-faint"><Loader2 className="h-3 w-3 animate-spin" />{t('working')}</p> : null}
            </li>
          ))}</ol>
        )}
      </div>
      <form onSubmit={(event) => {event.preventDefault(); void send();}}
        className="shrink-0 space-y-2 border-t border-hairline bg-panel p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <label htmlFor="assistant-composer" className="sr-only">{t('placeholder')}</label>
        <div className="rounded-lg border border-hairline bg-bg p-2 focus-within:border-accent/50">
          <textarea id="assistant-composer" ref={composerRef} value={draft} onChange={(event) => setDraft(event.target.value)}
            maxLength={12000} rows={3} placeholder={t('placeholder')} disabled={pending}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {event.preventDefault(); void send();}
            }}
            className="w-full resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-faint disabled:opacity-50" />
          <div className="flex items-center justify-between gap-2">
            <span className="px-1 text-[10px] text-faint">{t('inputHint')}</span>
            <button type="submit" disabled={pending || !draft.trim()} aria-label={t('send')}
              className="rounded-md bg-accent p-2 text-bg disabled:opacity-40"><Send className="h-3.5 w-3.5 rtl:rotate-180" /></button>
          </div>
        </div>
        <p className="px-1 text-[10px] leading-relaxed text-faint">{t('permissions')}</p>
      </form>
    </aside>
  );
}
