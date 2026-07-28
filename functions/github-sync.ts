// github-sync: every GitHub read and write for the product lifecycle.
//
// This function exists because of a credential constraint, not for convenience.
// The Next.js app only builds per-user clients, so anything it can read, a
// browser can read. The org PAT therefore lives nowhere the app can reach it: it
// is stored AES-GCM encrypted in public.github_connection (a table with no
// grants to any client role) under a key held only in this function's
// environment as GITHUB_TOKEN_KEY.
//
// Callers are re-authorized here on every action from their own JWT. Nothing
// about identity or permission is taken from the request body.

// The SDK arrives through Deno's npm: specifier and this directory is excluded
// from tsconfig.json, so no local types exist for these clients. `any` is an
// accurate description of what is knowable here, not a shortcut — writing
// hand-made interfaces would be decoration nothing can verify.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient, createAdminClient } from 'npm:@insforge/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const GITHUB_API = 'https://api.github.com';
const ARTIFACT_BUCKET = 'lifecycle-artifacts';
const LIFECYCLE_DIR = 'docs/lifecycle';
const MANIFEST_PATH = `${LIFECYCLE_DIR}/LIFECYCLE.md`;

// Numeric prefixes so the phases sort in lifecycle order in GitHub's file
// browser rather than alphabetically.
const PHASES = [
  { key: 'ideation', dir: '01-ideation', label: 'Ideation' },
  { key: 'requirements', dir: '02-requirements', label: 'Requirements' },
  { key: 'plan', dir: '03-plan', label: 'Plan' },
  { key: 'code_test', dir: '04-code-test', label: 'Code & Testing' },
  { key: 'deploy', dir: '05-deploy', label: 'Deploy' },
  { key: 'monitor', dir: '06-monitor', label: 'Monitor' },
];

const PHASE_BY_KEY = new Map(PHASES.map((p) => [p.key, p]));

// ============================================================
// Plumbing
// ============================================================

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// A stable machine-readable code so the app maps to a translated string instead
// of pattern-matching English prose.
function errorResponse(code: string, message: string, status = 400): Response {
  return jsonResponse({ error: { code, message } }, status);
}

class ActionError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked: String.fromCharCode(...bytes) blows the argument limit well below
  // the 25 MB artifacts this has to carry.
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'artifact'
  );
}

function extensionOf(fileName: string | null): string {
  if (!fileName) return '';
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName);
  return match ? `.${match[1].toLowerCase()}` : '';
}

// ============================================================
// Token storage
// ============================================================

async function aesKey(): Promise<CryptoKey> {
  const raw = Deno.env.get('GITHUB_TOKEN_KEY');
  if (!raw) {
    throw new ActionError('not_configured', 'GITHUB_TOKEN_KEY secret is not set', 500);
  }
  const bytes = base64ToBytes(raw);
  if (bytes.length !== 32) {
    throw new ActionError(
      'not_configured',
      'GITHUB_TOKEN_KEY must be 32 bytes, base64-encoded',
      500,
    );
  }
  return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

async function encryptToken(plain: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await aesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function decryptToken(ciphertext: string, iv: string): Promise<string> {
  const key = await aesKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}

type Connection = { org: string; token: string };

// Loads and decrypts the stored PAT. Every GitHub-touching action starts here,
// so an unconfigured workspace fails with one clear code rather than a 401 from
// GitHub that the UI would have to guess at.
async function loadConnection(admin: any): Promise<Connection> {
  const { data, error } = await admin.database
    .from('github_connection')
    .select('org, token_ciphertext, token_iv')
    .eq('id', true)
    .limit(1);
  if (error) throw new ActionError('generic', `connection lookup failed: ${error.message}`, 500);

  const row = data?.[0];
  if (!row?.token_ciphertext || !row?.token_iv) {
    throw new ActionError('not_configured', 'no GitHub credential has been saved yet');
  }
  return { org: row.org, token: await decryptToken(row.token_ciphertext, row.token_iv) };
}

// ============================================================
// Authorization — re-derived from the caller's JWT on every call
// ============================================================

type Caller = { userId: string; role: string };

async function resolveCaller(req: Request, admin: any, baseUrl: string): Promise<Caller | null> {
  const header = req.headers.get('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  try {
    const userClient = createClient({ baseUrl, accessToken: token });
    const { data } = await userClient.auth.getCurrentUser();
    const userId = data?.user?.id;
    if (!userId) return null;

    const { data: members } = await admin.database
      .from('team_members')
      .select('role, is_active')
      .eq('user_id', userId)
      .limit(1);
    const member = members?.[0];
    if (!member || member.is_active !== true) return null;
    return { userId, role: member.role };
  } catch {
    return null;
  }
}

function requireAdmin(caller: Caller): void {
  if (caller.role !== 'admin') {
    throw new ActionError('forbidden', 'this action requires an admin', 403);
  }
}

// Owner-or-admin on a non-archived product — the same rule the lifecycle gates
// use, so linking and mirroring cannot be done by someone who could not advance
// the phase in the first place.
async function requireProduct(admin: any, caller: Caller, productId: string): Promise<any> {
  if (!productId || typeof productId !== 'string') {
    throw new ActionError('invalid', 'productId is required');
  }
  const { data, error } = await admin.database
    .from('products')
    .select('id, name, slug, owner_id, archived_at, risk_tier, stage, health, github_repo, github_repo_id, github_default_branch')
    .eq('id', productId)
    .limit(1);
  if (error) throw new ActionError('generic', `product lookup failed: ${error.message}`, 500);

  const product = data?.[0];
  if (!product) throw new ActionError('not_found', 'product not found', 404);
  if (product.archived_at) throw new ActionError('archived', 'product is archived');
  if (product.owner_id !== caller.userId && caller.role !== 'admin') {
    throw new ActionError('forbidden', 'only the product owner or an admin can do this', 403);
  }
  return product;
}

async function logSync(
  admin: any,
  entry: Record<string, unknown>,
): Promise<void> {
  // Audit must never be the reason a successful push reports failure.
  try {
    await admin.database.from('github_sync_log').insert([entry]);
  } catch {
    /* ignore */
  }
}

// ============================================================
// GitHub API
// ============================================================

async function gh(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'code92-platform',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function ghJson(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const res = await gh(token, path, init);
  if (!res.ok) {
    const text = (await res.text()).slice(0, 400);
    throw new ActionError('github_error', `GitHub ${init.method || 'GET'} ${path} → ${res.status}: ${text}`);
  }
  return await res.json();
}

// Validates a PAT without storing it. Returns what the settings panel shows.
async function validateToken(token: string, org: string) {
  const userRes = await gh(token, '/user');
  if (!userRes.ok) {
    throw new ActionError(
      'token_invalid',
      `GitHub rejected the token (HTTP ${userRes.status})`,
    );
  }
  // Fine-grained PATs report expiry in a response header; classic ones do not.
  const expiryHeader = userRes.headers.get('github-authentication-token-expiration');

  const orgRes = await gh(token, `/orgs/${org}`);
  if (!orgRes.ok) {
    throw new ActionError(
      'org_unreachable',
      `The token cannot see the ${org} organization (HTTP ${orgRes.status}). ` +
        `Check that the token's resource owner is ${org} and that the org has approved it.`,
    );
  }

  // Fine-grained tokens do not send x-oauth-scopes, so write capability is read
  // off an actual repo's permissions instead.
  let canWrite = false;
  const repos = await listOrgRepos(token, org);
  for (const repo of repos) {
    if (repo.permissions?.push) {
      canWrite = true;
      break;
    }
  }

  let expiresAt: string | null = null;
  if (expiryHeader) {
    const parsed = new Date(expiryHeader);
    if (!isNaN(parsed.getTime())) expiresAt = parsed.toISOString();
  }

  return { expiresAt, canWrite, repoCount: repos.length };
}

async function listOrgRepos(token: string, org: string): Promise<any[]> {
  const all: any[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await gh(token, `/orgs/${org}/repos?per_page=100&sort=updated&page=${page}`);
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw new ActionError('github_error', `listing ${org} repos failed (HTTP ${res.status}): ${text}`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

// ============================================================
// Commits — Git Data API
// ============================================================
// Deliberately not the Contents API: this handles files above 1 MB, and it lets
// an artifact and the regenerated manifest land in ONE commit instead of two.

type FileChange = { path: string; base64?: string; remove?: boolean };

async function commitFiles(
  token: string,
  repo: string,
  branch: string,
  changes: FileChange[],
  message: string,
): Promise<string> {
  let baseCommitSha: string | null = null;
  let baseTreeSha: string | null = null;

  const refRes = await gh(token, `/repos/${repo}/git/ref/heads/${branch}`);
  if (refRes.ok) {
    const ref = await refRes.json();
    baseCommitSha = ref.object.sha;
    const commit = await ghJson(token, `/repos/${repo}/git/commits/${baseCommitSha}`);
    baseTreeSha = commit.tree.sha;
  } else if (refRes.status !== 404 && refRes.status !== 409) {
    // 404/409 both mean "empty repository"; anything else is a real failure.
    const text = (await refRes.text()).slice(0, 300);
    throw new ActionError('github_error', `reading ${branch} failed (HTTP ${refRes.status}): ${text}`);
  }

  const tree: any[] = [];
  for (const change of changes) {
    if (change.remove) {
      // A null sha in a tree entry is how the Git Data API expresses deletion.
      tree.push({ path: change.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const blob = await ghJson(token, `/repos/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: change.base64, encoding: 'base64' }),
    });
    tree.push({ path: change.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const treePayload: Record<string, unknown> = { tree };
  if (baseTreeSha) treePayload.base_tree = baseTreeSha;
  const newTree = await ghJson(token, `/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify(treePayload),
  });

  const commit = await ghJson(token, `/repos/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      tree: newTree.sha,
      parents: baseCommitSha ? [baseCommitSha] : [],
    }),
  });

  if (baseCommitSha) {
    await ghJson(token, `/repos/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha }),
    });
  } else {
    await ghJson(token, `/repos/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
  }

  return commit.sha;
}

// ============================================================
// Manifest
// ============================================================

function stateLabel(state: string): string {
  switch (state) {
    case 'complete':
      return '✅ Complete';
    case 'in_progress':
      return '🔵 In progress';
    case 'blocked':
      return '🔴 Blocked';
    default:
      return '⚪ Not started';
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
}

async function buildManifest(admin: any, product: any): Promise<string> {
  const { data: phases } = await admin.database
    .from('product_lifecycle_phases')
    .select('id, phase, state, entered_at, completed_at, notes')
    .eq('product_id', product.id)
    .eq('cycle', 1);

  const phaseRows = phases ?? [];
  const phaseIds = phaseRows.map((p: any) => p.id);

  const { data: artifacts } = phaseIds.length
    ? await admin.database
        .from('phase_artifacts')
        .select('id, phase_id, artifact_type, title, file_name, url, github_path, created_at')
        .in('phase_id', phaseIds)
    : { data: [] };

  const { data: transitions } = await admin.database
    .from('phase_transitions')
    .select('phase, from_state, to_state, missing_artifacts, waiver_reason, self_approved, created_at')
    .eq('product_id', product.id)
    .order('created_at', { ascending: false })
    .limit(25);

  const byPhase = new Map<string, any[]>();
  for (const artifact of artifacts ?? []) {
    const list = byPhase.get(artifact.phase_id) ?? [];
    list.push(artifact);
    byPhase.set(artifact.phase_id, list);
  }

  const lines: string[] = [];
  lines.push(`# ${product.name} — Implementation Lifecycle`);
  lines.push('');
  lines.push(
    '_Generated by the Code 92 platform. Edits made directly in this repository ' +
      'will be overwritten on the next sync._',
  );
  lines.push('');
  lines.push(`- **Risk tier:** ${product.risk_tier}`);
  lines.push(`- **Stage:** ${product.stage}`);
  lines.push(`- **Health:** ${product.health}`);
  lines.push('');
  lines.push('## Phases');
  lines.push('');
  lines.push('| # | Phase | State | Entered | Completed | Artifacts |');
  lines.push('| --- | --- | --- | --- | --- | --- |');

  PHASES.forEach((phase, index) => {
    const row = phaseRows.find((p: any) => p.phase === phase.key);
    const count = row ? (byPhase.get(row.id) ?? []).length : 0;
    lines.push(
      `| ${index + 1} | ${phase.label} | ${row ? stateLabel(row.state) : stateLabel('not_started')} | ` +
        `${formatDate(row?.entered_at ?? null)} | ${formatDate(row?.completed_at ?? null)} | ${count} |`,
    );
  });

  lines.push('');
  lines.push('## Evidence');

  for (const phase of PHASES) {
    const row = phaseRows.find((p: any) => p.phase === phase.key);
    const items = row ? (byPhase.get(row.id) ?? []) : [];
    lines.push('');
    lines.push(`### ${phase.label}`);
    if (row?.notes) {
      lines.push('');
      lines.push(`> ${String(row.notes).replace(/\n/g, '\n> ')}`);
    }
    lines.push('');
    if (items.length === 0) {
      lines.push('_No artifacts filed._');
      continue;
    }
    for (const item of items) {
      const label = `**${item.artifact_type}** — ${item.title}`;
      if (item.github_path) {
        // Relative link so it resolves inside the repo's file browser.
        const relative = item.github_path.replace(`${LIFECYCLE_DIR}/`, '');
        lines.push(`- ${label} → [\`${item.file_name}\`](${relative})`);
      } else if (item.url) {
        lines.push(`- ${label} → <${item.url}>`);
      } else {
        lines.push(`- ${label} _(knowledge base item — not mirrored)_`);
      }
    }
  }

  lines.push('');
  lines.push('## Gate log');
  lines.push('');
  const transitionRows = transitions ?? [];
  if (transitionRows.length === 0) {
    lines.push('_No transitions recorded._');
  } else {
    lines.push('| When | Phase | Change | Missing | Waiver |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const t of transitionRows) {
      const phase = PHASE_BY_KEY.get(t.phase)?.label ?? t.phase;
      const change = t.from_state ? `${t.from_state} → ${t.to_state}` : `→ ${t.to_state}`;
      const missing = (t.missing_artifacts ?? []).join(', ') || '—';
      const waiver = t.waiver_reason ? String(t.waiver_reason).replace(/\|/g, '\\|') : '—';
      const selfApproved = t.self_approved ? ' ⚠️ self-approved' : '';
      lines.push(
        `| ${formatDate(t.created_at)} | ${phase} | ${change}${selfApproved} | ${missing} | ${waiver} |`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

function manifestChange(markdown: string): FileChange {
  return { path: MANIFEST_PATH, base64: bytesToBase64(new TextEncoder().encode(markdown)) };
}

// ============================================================
// Actions
// ============================================================

async function actionSaveCredentials(admin: any, caller: Caller, body: any) {
  requireAdmin(caller);

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (token.length < 20) {
    throw new ActionError('invalid', 'that does not look like a GitHub token');
  }

  const { data: existing } = await admin.database
    .from('github_connection')
    .select('org')
    .eq('id', true)
    .limit(1);
  const org = existing?.[0]?.org ?? 'code92-dev';

  // Validate BEFORE storing: a token that cannot reach the org is never written.
  const validation = await validateToken(token, org);
  const encrypted = await encryptToken(token);

  const { error } = await admin.database
    .from('github_connection')
    .update({
      token_ciphertext: encrypted.ciphertext,
      token_iv: encrypted.iv,
      token_last_four: token.slice(-4),
      token_expires_at: validation.expiresAt,
      token_can_write: validation.canWrite,
      validated_at: new Date().toISOString(),
      validation_error: null,
      connected_by: caller.userId,
    })
    .eq('id', true);
  if (error) throw new ActionError('generic', `saving the credential failed: ${error.message}`, 500);

  await logSync(admin, {
    action: 'save_credentials',
    status: 'ok',
    actor_id: caller.userId,
  });

  return { ok: true, org, ...validation };
}

async function actionTestConnection(admin: any, caller: Caller) {
  requireAdmin(caller);
  const { org, token } = await loadConnection(admin);

  try {
    const validation = await validateToken(token, org);
    await admin.database
      .from('github_connection')
      .update({
        token_expires_at: validation.expiresAt,
        token_can_write: validation.canWrite,
        validated_at: new Date().toISOString(),
        validation_error: null,
      })
      .eq('id', true);
    return { ok: true, org, ...validation };
  } catch (e) {
    const message = (e as Error).message;
    // Record the failure so the panel shows why without needing a re-test.
    await admin.database
      .from('github_connection')
      .update({ validated_at: new Date().toISOString(), validation_error: message })
      .eq('id', true);
    throw e;
  }
}

async function actionListRepos(admin: any, caller: Caller, body: any) {
  await requireProduct(admin, caller, body.productId);
  const { org, token } = await loadConnection(admin);

  const repos = await listOrgRepos(token, org);

  // Flag repos already claimed by another product so the picker can disable them
  // rather than letting the UNIQUE constraint surface as a raw error.
  const { data: linked } = await admin.database
    .from('products')
    .select('id, name, github_repo_id')
    .not('github_repo_id', 'is', null);
  const claimed = new Map<number, string>(
    (linked ?? []).map((p: any) => [Number(p.github_repo_id), p.name]),
  );

  return {
    ok: true,
    org,
    repos: repos.map((r: any) => ({
      id: r.id,
      full_name: r.full_name,
      name: r.name,
      private: r.private,
      default_branch: r.default_branch,
      description: r.description,
      updated_at: r.updated_at,
      can_write: Boolean(r.permissions?.push),
      claimed_by: claimed.get(r.id) ?? null,
    })),
  };
}

async function actionLinkRepo(admin: any, caller: Caller, body: any) {
  const product = await requireProduct(admin, caller, body.productId);
  const { org, token } = await loadConnection(admin);

  const repoId = Number(body.repoId);
  if (!Number.isFinite(repoId) || repoId <= 0) {
    throw new ActionError('invalid', 'repoId is required');
  }

  // Resolve by numeric id, not by name: the id is what the link pins, and it is
  // what makes a later rename detectable instead of silently repointing.
  const repo = await ghJson(token, `/repositories/${repoId}`);

  if (repo.owner?.login?.toLowerCase() !== org.toLowerCase()) {
    throw new ActionError(
      'repo_not_in_org',
      `${repo.full_name} belongs to ${repo.owner?.login}, not ${org}`,
    );
  }
  if (!repo.private) {
    throw new ActionError(
      'repo_public',
      `${repo.full_name} is public. Lifecycle artifacts include threat models and ` +
        `pentest reports, so only private repositories can be linked.`,
    );
  }
  if (!repo.permissions?.push) {
    throw new ActionError('repo_no_write', `the token cannot write to ${repo.full_name}`);
  }

  const { error } = await admin.database
    .from('products')
    .update({
      github_repo: repo.full_name,
      github_repo_id: repo.id,
      github_default_branch: repo.default_branch,
      github_linked_by: caller.userId,
      github_linked_at: new Date().toISOString(),
    })
    .eq('id', product.id);

  if (error) {
    // The UNIQUE constraints are the real guard against two products sharing one
    // repo; the picker's claimed_by flag is only a courtesy.
    const taken = /unique|duplicate/i.test(error.message);
    throw new ActionError(
      taken ? 'repo_taken' : 'generic',
      taken ? `${repo.full_name} is already linked to another product` : error.message,
      taken ? 400 : 500,
    );
  }

  await logSync(admin, {
    product_id: product.id,
    action: 'link',
    repo: repo.full_name,
    status: 'ok',
    actor_id: caller.userId,
  });

  return {
    ok: true,
    repo: { full_name: repo.full_name, id: repo.id, default_branch: repo.default_branch },
  };
}

async function actionUnlinkRepo(admin: any, caller: Caller, body: any) {
  const product = await requireProduct(admin, caller, body.productId);
  if (!product.github_repo) return { ok: true, repo: null };

  const { error } = await admin.database
    .from('products')
    .update({
      github_repo: null,
      github_repo_id: null,
      github_default_branch: null,
      github_linked_by: null,
      github_linked_at: null,
    })
    .eq('id', product.id);
  if (error) throw new ActionError('generic', error.message, 500);

  // Files already pushed are left in place on purpose: unlinking is an
  // administrative act here, not a request to destroy history over there.
  await logSync(admin, {
    product_id: product.id,
    action: 'unlink',
    repo: product.github_repo,
    status: 'ok',
    actor_id: caller.userId,
  });

  return { ok: true, repo: null };
}

async function actionPushArtifact(admin: any, caller: Caller, body: any) {
  const artifactId = typeof body.artifactId === 'string' ? body.artifactId : '';
  if (!artifactId) throw new ActionError('invalid', 'artifactId is required');

  const { data: artifacts, error: artifactErr } = await admin.database
    .from('phase_artifacts')
    .select('id, phase_id, artifact_type, title, storage_key, file_name, url, knowledge_item_id')
    .eq('id', artifactId)
    .limit(1);
  if (artifactErr) throw new ActionError('generic', artifactErr.message, 500);
  const artifact = artifacts?.[0];
  if (!artifact) throw new ActionError('not_found', 'artifact not found', 404);

  const { data: phases } = await admin.database
    .from('product_lifecycle_phases')
    .select('id, product_id, phase')
    .eq('id', artifact.phase_id)
    .limit(1);
  const phaseRow = phases?.[0];
  if (!phaseRow) throw new ActionError('not_found', 'lifecycle phase not found', 404);

  const product = await requireProduct(admin, caller, phaseRow.product_id);
  if (!product.github_repo) {
    await admin.database
      .from('phase_artifacts')
      .update({ github_sync_state: 'skipped', github_sync_error: null })
      .eq('id', artifact.id);
    return { ok: true, skipped: 'no_repo' };
  }

  const { token } = await loadConnection(admin);
  const branch = product.github_default_branch || 'main';

  try {
    const changes: FileChange[] = [];
    let path: string | null = null;

    // Link-only and knowledge-citation artifacts have no file to commit. They
    // still belong in the manifest, so they take the same path minus the blob.
    if (artifact.storage_key) {
      const { data: blob, error: downloadErr } = await admin.storage
        .from(ARTIFACT_BUCKET)
        .download(artifact.storage_key);
      if (downloadErr || !blob) {
        throw new ActionError(
          'storage_error',
          `could not read the uploaded file: ${downloadErr?.message ?? 'unknown'}`,
        );
      }

      const phaseDir = PHASE_BY_KEY.get(phaseRow.phase)?.dir ?? phaseRow.phase;
      path =
        `${LIFECYCLE_DIR}/${phaseDir}/` +
        `${artifact.artifact_type}-${slugify(artifact.title)}-${artifact.id.slice(0, 8)}` +
        `${extensionOf(artifact.file_name)}`;

      const bytes = new Uint8Array(await blob.arrayBuffer());
      changes.push({ path, base64: bytesToBase64(bytes) });

      // Record the path BEFORE building the manifest so the generated evidence
      // list can link the file in the same commit that introduces it.
      await admin.database
        .from('phase_artifacts')
        .update({ github_path: path })
        .eq('id', artifact.id);
    }

    const markdown = await buildManifest(admin, product);
    changes.push(manifestChange(markdown));

    const sha = await commitFiles(
      token,
      product.github_repo,
      branch,
      changes,
      `docs(lifecycle): ${path ? 'add' : 'record'} ${artifact.artifact_type} "${artifact.title}"`,
    );

    await admin.database
      .from('phase_artifacts')
      .update({
        github_commit_sha: sha,
        github_synced_at: new Date().toISOString(),
        github_sync_state: path ? 'synced' : 'skipped',
        github_sync_error: null,
      })
      .eq('id', artifact.id);

    await logSync(admin, {
      product_id: product.id,
      artifact_id: artifact.id,
      action: 'push_artifact',
      repo: product.github_repo,
      path,
      commit_sha: sha,
      status: 'ok',
      actor_id: caller.userId,
    });

    return { ok: true, path, commit_sha: sha };
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    await admin.database
      .from('phase_artifacts')
      .update({ github_sync_state: 'failed', github_sync_error: message })
      .eq('id', artifact.id);
    await logSync(admin, {
      product_id: product.id,
      artifact_id: artifact.id,
      action: 'push_artifact',
      repo: product.github_repo,
      status: 'error',
      error: message,
      actor_id: caller.userId,
    });
    throw e;
  }
}

async function actionDeleteArtifact(admin: any, caller: Caller, body: any) {
  const product = await requireProduct(admin, caller, body.productId);
  if (!product.github_repo) return { ok: true, skipped: 'no_repo' };

  const path = typeof body.path === 'string' ? body.path : '';
  if (!path.startsWith(`${LIFECYCLE_DIR}/`)) {
    // Hard boundary: this action can only ever remove files the mirror created.
    throw new ActionError('invalid', 'path is outside the lifecycle directory');
  }

  const { token } = await loadConnection(admin);
  const markdown = await buildManifest(admin, product);

  const sha = await commitFiles(
    token,
    product.github_repo,
    product.github_default_branch || 'main',
    [{ path, remove: true }, manifestChange(markdown)],
    `docs(lifecycle): remove ${path.split('/').pop()}`,
  );

  await logSync(admin, {
    product_id: product.id,
    action: 'delete_artifact',
    repo: product.github_repo,
    path,
    commit_sha: sha,
    status: 'ok',
    actor_id: caller.userId,
  });

  return { ok: true, commit_sha: sha };
}

async function actionPushManifest(admin: any, caller: Caller, body: any) {
  const product = await requireProduct(admin, caller, body.productId);
  if (!product.github_repo) return { ok: true, skipped: 'no_repo' };

  const { token } = await loadConnection(admin);
  const markdown = await buildManifest(admin, product);

  const sha = await commitFiles(
    token,
    product.github_repo,
    product.github_default_branch || 'main',
    [manifestChange(markdown)],
    'docs(lifecycle): update lifecycle status',
  );

  await logSync(admin, {
    product_id: product.id,
    action: 'push_manifest',
    repo: product.github_repo,
    path: MANIFEST_PATH,
    commit_sha: sha,
    status: 'ok',
    actor_id: caller.userId,
  });

  return { ok: true, commit_sha: sha };
}

// ============================================================
// Entry point
// ============================================================

export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return errorResponse('invalid', 'POST only', 405);
  }

  const baseUrl = Deno.env.get('INSFORGE_BASE_URL')!;
  const admin = createAdminClient({ baseUrl, apiKey: Deno.env.get('API_KEY')! });

  const caller = await resolveCaller(req, admin, baseUrl);
  if (!caller) return errorResponse('forbidden', 'Unauthorized', 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse('invalid', 'body must be JSON');
  }

  try {
    switch (body?.action) {
      case 'save_credentials':
        return jsonResponse(await actionSaveCredentials(admin, caller, body));
      case 'test_connection':
        return jsonResponse(await actionTestConnection(admin, caller));
      case 'list_repos':
        return jsonResponse(await actionListRepos(admin, caller, body));
      case 'link_repo':
        return jsonResponse(await actionLinkRepo(admin, caller, body));
      case 'unlink_repo':
        return jsonResponse(await actionUnlinkRepo(admin, caller, body));
      case 'push_artifact':
        return jsonResponse(await actionPushArtifact(admin, caller, body));
      case 'delete_artifact':
        return jsonResponse(await actionDeleteArtifact(admin, caller, body));
      case 'push_manifest':
        return jsonResponse(await actionPushManifest(admin, caller, body));
      default:
        return errorResponse('invalid', `unknown action: ${body?.action}`);
    }
  } catch (e) {
    if (e instanceof ActionError) {
      return errorResponse(e.code, e.message, e.status);
    }
    return errorResponse('generic', (e as Error).message.slice(0, 500), 500);
  }
}
