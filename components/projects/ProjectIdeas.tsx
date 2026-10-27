'use client';

import {useState} from 'react';
import {useRouter} from '@/i18n/navigation';
import {useTranslations} from 'next-intl';

import CaptureIdeaDialog from '@/components/projects/CaptureIdeaDialog';
import {Link} from '@/i18n/navigation';
import {pushAfterAction} from '@/lib/navigation-guard';

export type IdeaRow = {id: string; name: string; business_stage: string};

// Products that came out of this engagement, and the button that starts another.
export default function ProjectIdeas({
  projectId,
  ideas,
  canCapture
}: {
  projectId: string;
  ideas: IdeaRow[];
  canCapture: boolean;
}) {
  const t = useTranslations('projects');
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <section className="space-y-3">
      {ideas.length === 0 ? <p className="text-xs text-faint">{t('ideas.empty')}</p> : null}
      <ul className="space-y-1.5">
        {ideas.map((idea) => (
          <li key={idea.id} className="flex items-center justify-between gap-2 rounded-md border border-hairline px-3 py-2 text-xs">
            <Link href={`/products/${idea.id}`} className="min-w-0 truncate text-ink hover:text-accent">{idea.name}</Link>
            <span className="shrink-0 text-faint">{t(`ideas.stage.${idea.business_stage}`)}</span>
          </li>
        ))}
      </ul>
      {canCapture ? (
        <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-accent/40 px-2.5 py-1.5 text-xs text-accent transition-colors hover:bg-accent/10">
          {t('idea.action')}
        </button>
      ) : null}
      {open ? (
        <CaptureIdeaDialog
          projectId={projectId}
          onClose={() => setOpen(false)}
          onCaptured={(productId) => pushAfterAction(router, `/products/${productId}`)}
        />
      ) : null}
    </section>
  );
}
