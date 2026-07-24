'use client';

import {Plus, X} from 'lucide-react';
import {useId, useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';

import {createTagAction, type KnowledgeTag} from '@/lib/actions/knowledge';

type Props = {
  allTags: KnowledgeTag[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
};

// Tags come from a shared table: typing an existing name selects it, a new
// name creates it for everyone. Autocomplete is a native <datalist> so it
// behaves correctly in both text directions with no extra dependency.
export default function TagPicker({
  allTags,
  selectedIds,
  onChange,
  disabled
}: Props) {
  const t = useTranslations('knowledge');
  const listId = useId();
  const [tags, setTags] = useState<KnowledgeTag[]>(allTags);
  const [draft, setDraft] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = selectedIds
    .map((id) => tags.find((tag) => tag.id === id))
    .filter((tag): tag is KnowledgeTag => tag != null);

  function add(name: string) {
    const trimmed = name.trim();
    if (!trimmed || disabled) return;
    setErrorKey(null);

    const existing = tags.find(
      (tag) => tag.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      if (!selectedIds.includes(existing.id)) {
        onChange([...selectedIds, existing.id]);
      }
      setDraft('');
      return;
    }

    startTransition(async () => {
      const result = await createTagAction(trimmed);
      if (!result.ok) {
        setErrorKey(result.error);
        return;
      }
      setTags((previous) =>
        previous.some((tag) => tag.id === result.tag.id)
          ? previous
          : [...previous, result.tag]
      );
      if (!selectedIds.includes(result.tag.id)) {
        onChange([...selectedIds, result.tag.id]);
      }
      setDraft('');
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.length === 0 ? (
          <span className="text-[11px] text-faint">{t('tags.none')}</span>
        ) : (
          selected.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1.5 rounded border border-hairline bg-raised px-2 py-1 font-mono text-[11px] text-muted"
            >
              {tag.name}
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  onChange(selectedIds.filter((id) => id !== tag.id))
                }
                aria-label={t('tags.remove', {name: tag.name})}
                className="text-faint transition-colors hover:text-danger disabled:opacity-50"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </span>
          ))
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          list={listId}
          maxLength={60}
          disabled={disabled || pending}
          placeholder={t('tags.placeholder')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Otherwise Enter would submit the surrounding form.
              event.preventDefault();
              add(draft);
            }
          }}
          className="w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent/50 disabled:opacity-50"
        />
        <datalist id={listId}>
          {tags
            .filter((tag) => !selectedIds.includes(tag.id))
            .map((tag) => (
              <option key={tag.id} value={tag.name} />
            ))}
        </datalist>
        <button
          type="button"
          disabled={disabled || pending || !draft.trim()}
          onClick={() => add(draft)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          {t('tags.add')}
        </button>
      </div>

      {errorKey ? (
        <p className="text-[11px] text-danger">{t(`errors.${errorKey}`)}</p>
      ) : null}
    </div>
  );
}
