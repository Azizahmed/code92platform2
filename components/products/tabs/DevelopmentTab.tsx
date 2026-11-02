import {getTranslations} from 'next-intl/server';

import ProductReleasesPanel from '@/components/products/ProductReleasesPanel';
import RepoConnectCard from '@/components/products/RepoConnectCard';
import StatusTimeline, {type TimelineEntry} from '@/components/products/StatusTimeline';
import StatusUpdateForm from '@/components/products/StatusUpdateForm';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import type {ProductRepoLink} from '@/lib/github';
import type {ReleaseOverview} from '@/lib/releases';
import type {ProductOverviewRow} from '@/components/products/types';

// The product's delivery: its releases, its repository, and its status updates.
export default async function DevelopmentTab({
  product,
  repo,
  canManage,
  canCreateRelease,
  githubConfigured,
  currentUserId,
  isAdmin,
  authorNames,
  locale
}: {
  product: ProductOverviewRow;
  repo: ProductRepoLink;
  canManage: boolean;
  canCreateRelease: boolean;
  githubConfigured: boolean;
  currentUserId: string;
  isAdmin: boolean;
  authorNames: Record<string, string>;
  locale: string;
}) {
  const t = await getTranslations('products');
  const insforge = await createInsForgeServerClient();

  const [{data: releases}, {data: updates}] = await Promise.all([
    insforge.database
      .from('release_overview')
      .select('*')
      .eq('product_id', product.id)
      .order('release_number', {ascending: true}),
    insforge.database
      .from('status_updates')
      .select('id, health, stage, summary, details, author_id, created_at')
      .eq('product_id', product.id)
      .order('created_at', {ascending: false})
  ]);

  const updateIds = (updates ?? []).map((update) => update.id as string);
  const {data: updateAttachments} =
    updateIds.length > 0
      ? await insforge.database
          .from('status_update_attachments')
          .select('id, status_update_id, storage_url, storage_key, file_name, mime_type, size_bytes, created_at')
          .in('status_update_id', updateIds)
          .order('created_at', {ascending: true})
      : {data: []};

  const attachmentsByUpdate = new Map<string, unknown[]>();
  for (const attachment of (updateAttachments ?? []) as unknown as {status_update_id: string}[]) {
    const list = attachmentsByUpdate.get(attachment.status_update_id) ?? [];
    list.push(attachment);
    attachmentsByUpdate.set(attachment.status_update_id, list);
  }

  const timeline = ((updates ?? []) as unknown as Omit<TimelineEntry, 'attachments'>[]).map((update) => ({
    ...update,
    attachments: (attachmentsByUpdate.get(update.id) ?? []) as TimelineEntry['attachments']
  }));

  return (
    <div className="space-y-6">
      <ProductReleasesPanel
        productId={product.id}
        releases={(releases ?? []) as unknown as ReleaseOverview[]}
        canCreate={canCreateRelease}
        canCreateReason={
          !canCreateRelease && (product.business_stage === 'idea' || product.business_stage === 'concept')
            ? 'gate'
            : null
        }
        locale={locale}
      />

      <RepoConnectCard
        productId={product.id}
        link={repo}
        canEdit={canManage}
        githubConfigured={githubConfigured}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-sm font-medium">{t('detail.timelineTitle')}</h2>
          <StatusTimeline
            updates={timeline}
            authorNames={authorNames}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            disabled={Boolean(product.archived_at)}
          />
        </div>
        <div>{product.archived_at ? null : <StatusUpdateForm productId={product.id} />}</div>
      </div>
    </div>
  );
}
