import {notFound} from 'next/navigation';
import {Hash, Package} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

import MessageStream, {
  type MessageAuthor
} from '@/components/channels/MessageStream';
import {requireActiveMember} from '@/lib/auth';
import {getChannelViewAction} from '@/lib/actions/channels';
import {channelLabel} from '@/lib/channels';
import {createInsForgeServerClient} from '@/lib/insforge/server';

export default async function ChannelPage({
  params
}: {
  params: Promise<{locale: string; id: string}>;
}) {
  const {locale, id} = await params;
  const {member} = await requireActiveMember();
  const t = await getTranslations('channels');

  const view = await getChannelViewAction(id);
  if (!view.channel) notFound();

  // Everyone who appears in this channel — humans for their names, agents for
  // their handles. One query rather than a lookup per message.
  const insforge = await createInsForgeServerClient();
  const [{data: members}, {data: agents}] = await Promise.all([
    insforge.database.from('team_members').select('user_id, display_name, kind'),
    insforge.database.from('agents').select('user_id, handle')
  ]);

  const handleByUser = new Map(
    ((agents ?? []) as Array<{user_id: string; handle: string}>).map((a) => [
      a.user_id,
      a.handle
    ])
  );

  const authors: MessageAuthor[] = (
    (members ?? []) as Array<{
      user_id: string;
      display_name: string;
      kind: 'human' | 'agent';
    }>
  ).map((m) => ({
    user_id: m.user_id,
    display_name: m.display_name,
    kind: m.kind,
    handle: handleByUser.get(m.user_id) ?? null
  }));

  const isProduct = view.channel.kind === 'product';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2.5 border-b border-hairline px-4 py-3 md:px-6">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-hairline bg-raised text-faint">
          {isProduct ? (
            <Package className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <Hash className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-ink">
            {channelLabel(view.channel, locale)}
          </h1>
          {view.channel.topic ? (
            <p dir="auto" className="truncate text-xs text-faint">
              {view.channel.topic}
            </p>
          ) : null}
        </div>
        {view.channel.archived_at ? (
          <span className="ms-auto shrink-0 rounded border border-hairline bg-raised px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-faint">
            {t('channel.archived')}
          </span>
        ) : null}
      </header>

      <MessageStream
        channelId={view.channel.id}
        initialMessages={view.messages}
        initialProposals={view.proposals}
        authors={authors}
        currentUserId={member.user_id}
        isAdmin={member.role === 'admin'}
      />
    </div>
  );
}
