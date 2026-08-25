import {Hash, Package} from 'lucide-react';
import {getTranslations, getLocale} from 'next-intl/server';

import CreateChannelForm from '@/components/channels/CreateChannelForm';
import {Link} from '@/i18n/navigation';
import {channelLabel, type Channel} from '@/lib/channels';
import {createInsForgeServerClient} from '@/lib/insforge/server';

// The rooms attached to this product: the one created with it, plus any opened
// against it since. Bound channels are what give an agent the product's context
// without anyone having to paste it, so they are worth surfacing on the product
// itself rather than only in the channel rail.
export default async function ProductChannelsPanel({
  productId
}: {
  productId: string;
}) {
  const t = await getTranslations('channels');
  const locale = await getLocale();

  const insforge = await createInsForgeServerClient();
  const {data} = await insforge.database
    .from('channels')
    .select('id, slug, name, name_ar, topic, kind, product_id, is_primary, archived_at, created_by, created_at')
    .eq('product_id', productId)
    .is('archived_at', null)
    .order('is_primary', {ascending: false})
    .order('slug', {ascending: true});

  const channels = (data ?? []) as unknown as Channel[];

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-ink">{t('title')}</h2>
        <CreateChannelForm productId={productId} compact />
      </header>

      {channels.length === 0 ? (
        <p className="rounded-lg border border-dashed border-hairline bg-panel px-4 py-6 text-center text-sm text-faint">
          {t('empty.noChannels')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {channels.map((channel) => (
            <li key={channel.id}>
              <Link
                href={`/channels/${channel.id}`}
                className="flex items-center gap-2 rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-muted transition-colors hover:text-ink"
              >
                {channel.is_primary ? (
                  <Package className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.75} />
                ) : (
                  <Hash className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={1.75} />
                )}
                <span className="truncate">{channelLabel(channel, locale)}</span>
                {channel.topic ? (
                  <span dir="auto" className="truncate text-xs text-faint">
                    {channel.topic}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
