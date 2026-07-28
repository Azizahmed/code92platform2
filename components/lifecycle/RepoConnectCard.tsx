'use client';

import {useState, useTransition} from 'react';
import {ExternalLink, GitBranch, Lock, Search} from 'lucide-react';
import {useTranslations} from 'next-intl';

import RelativeTime from '@/components/RelativeTime';
import {
  linkProductRepoAction,
  listOrgReposAction,
  unlinkProductRepoAction
} from '@/lib/actions/github';
import {
  GITHUB_ORG,
  repoUrl,
  type OrgRepo,
  type ProductRepoLink
} from '@/lib/github';

const LIFECYCLE_DIR = 'docs/lifecycle';

// The product's link to its repository. Picking from a live list rather than
// typing a name proves the token works at the moment of linking, and makes a
// typo impossible — the id is what gets stored, so a later rename on GitHub
// cannot silently repoint the product.
export default function RepoConnectCard({
  productId,
  link,
  canEdit,
  githubConfigured
}: {
  productId: string;
  link: ProductRepoLink;
  canEdit: boolean;
  githubConfigured: boolean;
}) {
  const t = useTranslations('github');

  const [picking, setPicking] = useState(false);
  const [repos, setRepos] = useState<OrgRepo[] | null>(null);
  const [filter, setFilter] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openPicker() {
    setErrorKey(null);
    setPicking(true);
    if (repos) return;

    startTransition(async () => {
      const result = await listOrgReposAction(productId);
      if (!result.ok) {
        setErrorKey(result.error);
        setPicking(false);
        return;
      }
      // Only private repos are linkable, so never offer the others.
      setRepos((result.repos ?? []).filter((repo) => repo.private));
    });
  }

  function link_(repoId: number) {
    setErrorKey(null);
    startTransition(async () => {
      const result = await linkProductRepoAction({productId, repoId});
      if (!result.ok) {
        setErrorKey(result.error);
        return;
      }
      setPicking(false);
    });
  }

  function unlink() {
    setErrorKey(null);
    startTransition(async () => {
      const result = await unlinkProductRepoAction(productId);
      if (!result.ok) setErrorKey(result.error);
    });
  }

  const visible = (repos ?? []).filter((repo) =>
    filter.trim() === ''
      ? true
      : repo.full_name.toLowerCase().includes(filter.trim().toLowerCase())
  );

  return (
    <div className="rounded-lg border border-hairline bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <GitBranch className="h-4 w-4 text-muted" strokeWidth={1.75} />
            {t('repo.title')}
          </h3>

          {link.github_repo ? (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={repoUrl(link.github_repo)}
                  target="_blank"
                  rel="noreferrer"
                  dir="ltr"
                  className="inline-flex items-center gap-1.5 font-mono text-xs text-accent hover:underline"
                >
                  {link.github_repo}
                  <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                </a>
                <span className="inline-flex items-center gap-1 rounded border border-hairline bg-raised px-1.5 py-0.5 text-[10px] text-faint">
                  <Lock className="h-2.5 w-2.5" strokeWidth={2} />
                  private
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-faint">
                {link.github_linked_at ? (
                  <span>
                    {t('repo.linkedOn')} <RelativeTime date={link.github_linked_at} />
                  </span>
                ) : null}
                <a
                  href={`${repoUrl(link.github_repo)}/tree/${link.github_default_branch || 'main'}/${LIFECYCLE_DIR}`}
                  target="_blank"
                  rel="noreferrer"
                  dir="ltr"
                  className="hover:text-accent hover:underline"
                >
                  {t('repo.viewLifecycle')}
                </a>
              </div>
            </div>
          ) : (
            <p className="max-w-prose text-xs leading-relaxed text-muted">
              {githubConfigured ? t('repo.none') : t('repo.notConfigured')}
            </p>
          )}
        </div>

        {canEdit && githubConfigured ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openPicker}
              disabled={pending}
              className="rounded-md border border-hairline px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
            >
              {link.github_repo ? t('repo.change') : t('repo.connect')}
            </button>
            {link.github_repo ? (
              <button
                type="button"
                onClick={unlink}
                disabled={pending}
                className="rounded-md border border-hairline px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-50"
              >
                {pending ? t('repo.unlinking') : t('repo.unlink')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {picking ? (
        <div className="mt-4 space-y-3 rounded-md border border-hairline bg-bg/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium">{t('repo.pickTitle')}</div>
              <p className="mt-0.5 text-[11px] text-faint">
                {t('repo.pickHint', {org: GITHUB_ORG})}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPicking(false)}
              className="rounded-md border border-hairline px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              {t('repo.cancel')}
            </button>
          </div>

          {repos === null ? (
            <p className="py-6 text-center text-xs text-muted">
              {t('repo.loading')}
            </p>
          ) : repos.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted">
              {t('repo.empty', {org: GITHUB_ORG})}
            </p>
          ) : (
            <>
              <label className="flex items-center gap-2 rounded-md border border-hairline bg-bg px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={1.75} />
                <input
                  type="text"
                  dir="ltr"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-faint"
                />
              </label>

              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {visible.map((repo) => {
                  const claimedByOther =
                    repo.claimed_by !== null && repo.id !== link.github_repo_id;
                  const disabled = pending || claimedByOther || !repo.can_write;

                  return (
                    <li key={repo.id}>
                      <button
                        type="button"
                        onClick={() => link_(repo.id)}
                        disabled={disabled}
                        className={`flex w-full flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-start transition-colors ${
                          disabled
                            ? 'cursor-not-allowed border-hairline opacity-50'
                            : 'border-hairline hover:border-accent/40 hover:bg-accent/5'
                        }`}
                      >
                        <span
                          dir="ltr"
                          className="w-full truncate font-mono text-xs text-ink"
                        >
                          {repo.full_name}
                        </span>
                        <span className="flex flex-wrap items-center gap-2 text-[10px] text-faint">
                          {repo.description ? (
                            <span className="truncate">{repo.description}</span>
                          ) : null}
                          {claimedByOther ? (
                            <span className="text-amber">
                              {t('repo.claimed', {product: repo.claimed_by!})}
                            </span>
                          ) : null}
                          {!repo.can_write ? (
                            <span className="text-danger">{t('repo.noWrite')}</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      ) : null}

      {errorKey ? (
        <p className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(`errors.${errorKey}`)}
        </p>
      ) : null}
    </div>
  );
}
