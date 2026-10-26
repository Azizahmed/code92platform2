'use client';

import {useState, useTransition} from 'react';
import {Plus} from 'lucide-react';
import {useTranslations} from 'next-intl';

import {useRouter} from '@/i18n/navigation';
import {pushAfterAction} from '@/lib/navigation-guard';
import {createChannelAction} from '@/lib/actions/channels';
import {toChannelSlug} from '@/lib/channels';

// Creating a channel, in both places one gets created from: the channel rail
// (standing) and a product page (bound). The only difference is productId, so
// this is one component rather than two that drift.

export default function CreateChannelForm({
  productId,
  compact = false
}: {
  productId?: string;
  compact?: boolean;
}) {
  const t = useTranslations('channels');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const slug = toChannelSlug(name);

  function submit() {
    if (!slug) {
      setError('invalid_slug');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createChannelAction({
        name: name.trim(),
        topic: topic.trim() || undefined,
        productId
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName('');
      setTopic('');
      setOpen(false);
      // Straight into the room that was just opened, rather than leaving the
      // creator to find it in the rail.
      if (result.channelId) pushAfterAction(router, `/channels/${result.channelId}`);
      else router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded border border-hairline bg-raised text-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
        }`}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        {t('create.button')}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-panel p-3">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-faint">
          {t('create.name')}
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          dir="auto"
          autoFocus
          className="rounded border border-hairline bg-bg px-2.5 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-faint">
          {t('create.topic')}
        </span>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          dir="auto"
          className="rounded border border-hairline bg-bg px-2.5 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
        />
      </label>

      {slug ? (
        <p className="font-mono text-[10px] text-faint" dir="ltr">
          {t('create.slugPreview', {slug})}
        </p>
      ) : null}

      {error ? (
        <p className="text-xs text-danger">{t(`errors.${error}`)}</p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !name.trim()}
          className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
        >
          {t('create.submit')}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded border border-hairline bg-raised px-3 py-1.5 text-xs text-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {t('create.cancel')}
        </button>
      </div>
    </div>
  );
}
