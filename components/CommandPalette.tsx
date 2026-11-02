'use client';

import {
  BookOpen,
  CheckCircle2,
  Circle,
  CornerDownLeft,
  FolderKanban,
  Handshake,
  Hash,
  Inbox,
  LayoutDashboard,
  ListTodo,
  MessagesSquare,
  Package,
  Plus,
  Rocket,
  Scale,
  Search,
  Settings2,
  type LucideIcon
} from 'lucide-react';
import {useLocale, useTranslations} from 'next-intl';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {useRouter} from '@/i18n/navigation';
import {commandSearchAction, type SearchHit} from '@/lib/actions/search';
import {openTaskDrawer} from '@/lib/task-drawer';

type Entry = {
  id: string;
  label: string;
  detail?: string | null;
  icon: LucideIcon;
  group: 'actions' | 'pages' | 'results';
  run: () => void;
  done?: boolean;
};

export const OPEN_PALETTE_EVENT = 'code92:open-palette';

// Ctrl/⌘ K from anywhere: jump to a page, a product, a project, a channel or a
// task, or start a new task — without hunting through the navigation.
export default function CommandPalette() {
  const t = useTranslations('ui');
  const tNav = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const requestId = useRef(0);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setHits([]);
    setActive(0);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Debounced lookup; a late answer to an older query is dropped.
  useEffect(() => {
    if (!open) return;
    const text = query.trim();
    if (text.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++requestId.current;
    const timer = window.setTimeout(async () => {
      const result = await commandSearchAction(text, locale);
      if (id !== requestId.current) return;
      setHits(result.ok ? result.hits : []);
      setLoading(false);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, open, locale]);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router]
  );

  const entries = useMemo<Entry[]>(() => {
    const text = query.trim().toLocaleLowerCase(locale);
    const matches = (label: string) => !text || label.toLocaleLowerCase(locale).includes(text);

    const actions: Entry[] = [
      {id: 'new-task', label: t('palette.newTask'), icon: Plus, group: 'actions', run: () => go('/tasks?new=1')},
      {id: 'new-my-task', label: t('palette.newMyTask'), icon: Plus, group: 'actions', run: () => go('/my-work?new=1')}
    ];
    const pages: Entry[] = (
      [
        ['/', 'dashboard', LayoutDashboard],
        ['/my-work', 'myWork', Inbox],
        ['/tasks', 'tasks', ListTodo],
        ['/channels', 'channels', MessagesSquare],
        ['/sales', 'sales', Handshake],
        ['/products', 'products', Package],
        ['/projects', 'projects', FolderKanban],
        ['/releases', 'releases', Rocket],
        ['/knowledge', 'knowledge', BookOpen],
        ['/governance', 'governance', Scale],
        ['/settings', 'settings', Settings2]
      ] as const
    ).map(([href, key, icon]) => ({
      id: `page-${key}`,
      label: key === 'projects' ? t('palette.projects') : tNav(`nav.${key}`),
      icon,
      group: 'pages' as const,
      run: () => go(href)
    }));

    const results: Entry[] = hits.map((hit) => {
      const icon = {task: ListTodo, product: Package, project: FolderKanban, channel: Hash}[hit.kind];
      return {
        id: `${hit.kind}-${hit.id}`,
        label: hit.title,
        detail: hit.kind === 'task' ? hit.detail ?? t('palette.kinds.task') : t(`palette.kinds.${hit.kind}`),
        icon: hit.kind === 'task' ? (hit.done ? CheckCircle2 : Circle) : icon,
        done: hit.kind === 'task' ? hit.done : undefined,
        group: 'results' as const,
        run: () => {
          if (hit.kind === 'task') {
            close();
            openTaskDrawer(hit.id);
          } else if (hit.kind === 'product') go(`/products/${hit.id}`);
          else if (hit.kind === 'project') go(`/projects/${hit.id}`);
          else go(`/channels/${hit.id}`);
        }
      };
    });

    return [...results, ...actions.filter((entry) => matches(entry.label)), ...pages.filter((entry) => matches(entry.label))];
  }, [query, locale, t, tNav, hits, go, close]);

  useEffect(() => setActive(0), [query, hits]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({block: 'nearest'});
  }, [active]);

  if (!open) return null;

  let lastGroup: Entry['group'] | null = null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('palette.label')}
      className="fixed inset-0 z-[75] flex items-start justify-center p-3 pt-[12vh]"
    >
      <button
        type="button"
        aria-label={t('confirm.cancel')}
        onClick={close}
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-hairline bg-panel shadow-2xl">
        <div className="flex items-center gap-3 border-b border-hairline px-4">
          <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={1.75} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((value) => Math.min(value + 1, entries.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((value) => Math.max(value - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                entries[active]?.run();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                close();
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={entries[active] ? `palette-${entries[active].id}` : undefined}
            placeholder={t('palette.placeholder')}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
          {loading ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-faint border-t-transparent" /> : null}
          <kbd className="hidden rounded border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-faint sm:block">Esc</kbd>
        </div>
        <ul id="command-palette-list" ref={listRef} role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
          {entries.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-faint">{loading ? t('palette.searching') : t('palette.empty')}</li>
          ) : null}
          {entries.map((entry, index) => {
            const Icon = entry.icon;
            const header = entry.group !== lastGroup ? t(`palette.groups.${entry.group}`) : null;
            lastGroup = entry.group;
            return (
              <li key={entry.id} role="presentation">
                {header ? (
                  <div className="px-2.5 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-widest text-faint">{header}</div>
                ) : null}
                <button
                  id={`palette-${entry.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={entry.run}
                  className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-start text-sm transition-colors ${
                    index === active ? 'bg-raised text-ink' : 'text-muted'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${entry.done ? 'text-accent' : 'text-faint'}`}
                    strokeWidth={1.75}
                  />
                  <span className={`min-w-0 flex-1 truncate ${entry.done ? 'line-through' : ''}`}>{entry.label}</span>
                  {entry.detail ? <span className="max-w-[40%] shrink-0 truncate text-xs text-faint">{entry.detail}</span> : null}
                  {index === active ? (
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-faint rtl:-scale-x-100" strokeWidth={1.75} />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-4 border-t border-hairline px-4 py-2 text-[11px] text-faint">
          <span>
            <kbd className="font-mono">↑↓</kbd> {t('palette.hintMove')}
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> {t('palette.hintOpen')}
          </span>
        </div>
      </div>
    </div>
  );
}
