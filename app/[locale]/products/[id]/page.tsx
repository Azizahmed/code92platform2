import {ChevronLeft, ExternalLink, Pencil} from 'lucide-react';
import Image from 'next/image';
import {notFound} from 'next/navigation';
import {getFormatter, getTranslations} from 'next-intl/server';

import HealthBadge from '@/components/HealthBadge';
import OverdueBadge from '@/components/OverdueBadge';
import StageChip from '@/components/StageChip';
import StatusUpdateForm from '@/components/products/StatusUpdateForm';
import StatusTimeline, {
  type StatusUpdateAttachment,
  type TimelineEntry
} from '@/components/products/StatusTimeline';
import LifecycleSection from '@/components/lifecycle/LifecycleSection';
import RepoConnectCard from '@/components/lifecycle/RepoConnectCard';
import RiskTierChip from '@/components/lifecycle/RiskTierChip';
import ProductKnowledgePanel from '@/components/products/ProductKnowledgePanel';
import ProductTasksPanel, {
  type TaskMemberOption
} from '@/components/products/ProductTasksPanel';
import {Link} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';
import type {Product} from '@/lib/actions/products';
import type {
  ProductTask,
  TaskAttachment
} from '@/lib/actions/tasks';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {loadProductLifecycle} from '@/lib/lifecycle-queries';

export default async function ProductDetailPage({
  params
}: {
  params: Promise<{locale: string; id: string}>;
}) {
  const {locale, id} = await params;
  const {user, member} = await requireActiveMember();
  const [t, format] = await Promise.all([
    getTranslations('products'),
    getFormatter()
  ]);

  const insforge = await createInsForgeServerClient();
  const {data: product} = await insforge.database
    .from('products')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!product) notFound();

  const p = product as unknown as Product;
  const isAdmin = member.role === 'admin';
  const isOwner = p.owner_id === user.id;

  // Archived products stay viewable for owner/admin; everyone else gets 404.
  if (p.archived_at && !isOwner && !isAdmin) notFound();

  const [
    {data: members},
    {data: updates},
    {data: tasks},
    lifecycle,
    {data: knowledgeItems}
  ] = await Promise.all([
    insforge.database
      .from('team_members')
      .select('user_id, display_name')
      .eq('is_active', true)
      .order('display_name'),
    insforge.database
      .from('status_updates')
      .select('id, health, stage, summary, details, author_id, created_at')
      .eq('product_id', id)
      .order('created_at', {ascending: false}),
    insforge.database
      .from('product_tasks')
      .select(
        'id, product_id, parent_task_id, title, notes, due_date, assignee_id, status, position, created_by, completed_at, created_at, updated_at'
      )
      .eq('product_id', id)
      .order('position', {ascending: true})
      .order('created_at', {ascending: true}),
    loadProductLifecycle(id),
    // Options for citing an existing knowledge item as a phase artifact
    // instead of re-uploading the same document.
    insforge.database
      .from('knowledge_items')
      .select('id, title')
      .is('archived_at', null)
      .order('title')
  ]);

  // One bit — whether a credential exists at all — so a product owner who is not
  // an admin can be told to ask for setup instead of hitting an error.
  const {data: githubConfigured} = await insforge.database.rpc(
    'github_is_configured'
  );

  const taskIds = (tasks ?? []).map((task) => task.id as string);
  const updateIds = (updates ?? []).map((update) => update.id as string);
  const [{data: taskAttachments}, {data: updateAttachments}] =
    await Promise.all([
      taskIds.length > 0
        ? insforge.database
            .from('task_attachments')
            .select(
              'id, task_id, storage_url, storage_key, file_name, mime_type, size_bytes, created_at'
            )
            .in('task_id', taskIds)
            .order('created_at', {ascending: true})
        : Promise.resolve({data: []}),
      updateIds.length > 0
        ? insforge.database
            .from('status_update_attachments')
            .select(
              'id, status_update_id, storage_url, storage_key, file_name, mime_type, size_bytes, created_at'
            )
            .in('status_update_id', updateIds)
            .order('created_at', {ascending: true})
        : Promise.resolve({data: []})
    ]);

  const memberNames = new Map<string, string>(
    (members ?? []).map((m) => [m.user_id as string, m.display_name as string])
  );
  const taskAttachmentMap = new Map<string, TaskAttachment[]>();
  for (const attachment of (taskAttachments ?? []) as unknown as TaskAttachment[]) {
    const list = taskAttachmentMap.get(attachment.task_id) ?? [];
    list.push(attachment);
    taskAttachmentMap.set(attachment.task_id, list);
  }
  const workItems: ProductTask[] = (
    (tasks ?? []) as unknown as Omit<ProductTask, 'attachments'>[]
  ).map((task) => ({
    ...task,
    attachments: taskAttachmentMap.get(task.id) ?? []
  }));

  const updateAttachmentMap = new Map<string, StatusUpdateAttachment[]>();
  for (const attachment of (updateAttachments ??
    []) as unknown as StatusUpdateAttachment[]) {
    const list = updateAttachmentMap.get(attachment.status_update_id) ?? [];
    list.push(attachment);
    updateAttachmentMap.set(attachment.status_update_id, list);
  }
  const timeline: TimelineEntry[] = (
    (updates ?? []) as unknown as Omit<TimelineEntry, 'attachments'>[]
  ).map((update) => ({
    ...update,
    attachments: updateAttachmentMap.get(update.id) ?? []
  }));
  // StatusTimeline is a Client Component, so the lookup crosses the RSC
  // boundary and has to be a plain object — a Map is not serializable.
  const authorNames = Object.fromEntries(memberNames);
  const memberOptions: TaskMemberOption[] = (members ?? []).map((m) => ({
    userId: m.user_id as string,
    displayName: m.display_name as string
  }));
  const overdue =
    p.next_review_at !== null && new Date(p.next_review_at).getTime() < Date.now();
  const links = Object.entries(p.links ?? {});

  return (
    <section className="space-y-6">
      <div>
        <Link
          href="/products"
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2} />
          {t('detail.back')}
        </Link>
      </div>

      <header className="rounded-lg border border-hairline bg-panel p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            {p.logo_url ? (
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-hairline bg-raised">
                <Image
                  src={p.logo_url}
                  alt={p.name}
                  fill
                  unoptimized
                  sizes="56px"
                  className="object-cover"
                  priority
                />
              </div>
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-hairline bg-raised font-mono text-lg font-semibold text-faint">
                {p.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-semibold">{p.name}</h1>
                <StageChip stage={p.stage} />
                <HealthBadge health={p.health} />
                <RiskTierChip riskTier={p.risk_tier} />
                {p.archived_at ? (
                  <span className="rounded border border-hairline bg-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-faint">
                    {t('detail.archivedTag')}
                  </span>
                ) : null}
              </div>
              <div dir="ltr" className="font-mono text-xs text-faint">
                {p.slug}
              </div>
            </div>
          </div>
          {isOwner || isAdmin ? (
            <Link
              href={`/products/${p.id}/edit`}
              className="inline-flex items-center gap-2 rounded-md border border-hairline px-3 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <Pencil className="h-4 w-4" strokeWidth={1.75} />
              {t('detail.edit')}
            </Link>
          ) : null}
        </div>

        {p.description || p.description_ar ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {p.description ? (
              <p dir="ltr" className="text-start text-sm leading-relaxed text-muted">
                {p.description}
              </p>
            ) : null}
            {p.description_ar ? (
              <p dir="rtl" className="text-start text-sm leading-relaxed text-muted">
                {p.description_ar}
              </p>
            ) : null}
          </div>
        ) : null}

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-hairline pt-5 sm:grid-cols-4">
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">
              {t('detail.owner')}
            </dt>
            <dd className="mt-1 text-sm">{memberNames.get(p.owner_id) ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">
              {t('detail.category')}
            </dt>
            <dd className="mt-1 text-sm">{p.category ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">
              {t('detail.nextReview')}
            </dt>
            <dd className="mt-1 flex items-center gap-2 text-sm">
              {p.next_review_at ? (
                <time
                  dateTime={p.next_review_at}
                  className="font-mono text-xs text-muted"
                >
                  {format.dateTime(new Date(p.next_review_at), {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}
                </time>
              ) : (
                '—'
              )}
              {overdue && !p.archived_at ? <OverdueBadge /> : null}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-faint">
              {t('fields.reviewInterval')}
            </dt>
            <dd className="mt-1 text-sm text-muted">
              {t('detail.reviewEvery', {days: p.review_interval_days})}
            </dd>
          </div>
        </dl>

        {p.keywords.length > 0 || links.length > 0 ? (
          <div className="mt-5 flex flex-wrap items-start gap-6 border-t border-hairline pt-5">
            {p.keywords.length > 0 ? (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-faint">
                  {t('detail.keywords')}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.keywords.map((kw) => (
                    <span
                      key={kw}
                      className="rounded border border-hairline bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {links.length > 0 ? (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-faint">
                  {t('detail.links')}
                </div>
                <div className="mt-2 flex flex-wrap gap-3">
                  {links.map(([label, url]) => (
                    <a
                      key={label}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                      {label}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {p.archived_at ? (
        <p className="rounded-lg border border-amber/30 bg-amber/10 px-4 py-3 text-xs text-amber">
          {t('edit.archivedNotice')}
        </p>
      ) : null}

      <RepoConnectCard
        productId={p.id}
        link={{
          github_repo: p.github_repo,
          github_repo_id: p.github_repo_id,
          github_default_branch: p.github_default_branch,
          github_linked_by: p.github_linked_by,
          github_linked_at: p.github_linked_at
        }}
        canEdit={!p.archived_at && (isOwner || isAdmin)}
        githubConfigured={Boolean(githubConfigured)}
      />

      <LifecycleSection
        productId={p.id}
        riskTier={p.risk_tier}
        isAdmin={isAdmin}
        canEdit={
          !p.archived_at &&
          (isOwner || isAdmin) &&
          (p.risk_tier !== 'high' || isAdmin)
        }
        phases={lifecycle.phases}
        artifacts={lifecycle.artifacts}
        knowledgeOptions={(knowledgeItems ?? []).map((item) => ({
          id: item.id as string,
          title: item.title as string
        }))}
        memberNames={authorNames}
        repo={p.github_repo}
        repoBranch={p.github_default_branch}
      />

      <ProductTasksPanel
        productId={p.id}
        tasks={workItems}
        members={memberOptions}
        locale={locale}
        disabled={Boolean(p.archived_at)}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-sm font-medium">{t('detail.timelineTitle')}</h2>
          <StatusTimeline
            updates={timeline}
            authorNames={authorNames}
            currentUserId={user.id}
            isAdmin={isAdmin}
            disabled={Boolean(p.archived_at)}
          />

        </div>

        <div>{p.archived_at ? null : <StatusUpdateForm productId={p.id} />}</div>
      </div>

      <ProductKnowledgePanel productId={p.id} />
    </section>
  );
}
