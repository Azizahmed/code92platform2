// Shared GitHub-integration vocabulary.
//
// No 'use server' here on purpose: client components import these constants, and
// every export from a server-action module becomes a callable endpoint. Same
// split as lib/lifecycle.ts vs lib/actions/lifecycle.ts.

export const GITHUB_ORG = 'code92-dev';

export const SYNC_STATES = ['pending', 'synced', 'failed', 'skipped'] as const;
export type SyncState = (typeof SYNC_STATES)[number];

// Mirrors the ActionError codes raised in functions/github-sync.ts. Anything not
// in this list is reported as 'generic' rather than shown raw — a backend
// message must never reach the UI untranslated.
export const GITHUB_ERROR_CODES = [
  'invalid',
  'forbidden',
  'not_found',
  'archived',
  'not_configured',
  'token_invalid',
  'org_unreachable',
  'github_error',
  'repo_not_in_org',
  'repo_public',
  'repo_no_write',
  'repo_taken',
  'storage_error',
  'generic'
] as const;

export type GithubErrorCode = (typeof GITHUB_ERROR_CODES)[number];

export function isGithubErrorCode(value: unknown): value is GithubErrorCode {
  return (
    typeof value === 'string' &&
    (GITHUB_ERROR_CODES as readonly string[]).includes(value)
  );
}

export type GithubConnectionStatus = {
  org: string;
  is_configured: boolean;
  token_last_four: string | null;
  token_expires_at: string | null;
  token_can_write: boolean;
  validated_at: string | null;
  validation_error: string | null;
  connected_by: string | null;
  updated_at: string;
};

export type OrgRepo = {
  id: number;
  full_name: string;
  name: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  updated_at: string;
  can_write: boolean;
  claimed_by: string | null;
};

export type ProductRepoLink = {
  github_repo: string | null;
  github_repo_id: number | null;
  github_default_branch: string | null;
  github_linked_by: string | null;
  github_linked_at: string | null;
};

// How long before a token expires the settings panel starts warning. Fine-grained
// PATs always expire, so this is the difference between a planned rotation and a
// morning where nothing syncs.
export const TOKEN_EXPIRY_WARNING_DAYS = 14;

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((then - Date.now()) / 86_400_000);
}

export function repoUrl(fullName: string): string {
  return `https://github.com/${fullName}`;
}

export function repoFileUrl(
  fullName: string,
  branch: string | null,
  path: string
): string {
  return `https://github.com/${fullName}/blob/${branch || 'main'}/${path}`;
}
