import {MessagesSquare} from 'lucide-react';
import {getTranslations} from 'next-intl/server';

export default async function ChannelsIndexPage() {
  const t = await getTranslations('channels');

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-hairline bg-raised text-faint">
        <MessagesSquare className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <p className="text-sm text-muted">{t('empty.pickOne')}</p>
      <p className="max-w-sm text-xs text-faint">{t('subtitle')}</p>
    </div>
  );
}
