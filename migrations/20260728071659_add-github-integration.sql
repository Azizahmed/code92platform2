-- GitHub integration: connect each product to exactly one repository in the
-- code92-dev organization, and mirror its lifecycle record into that repo so the
-- governance evidence lives beside the code it governs.
--
-- Credential handling is the constraint that shapes this whole file. The Next.js
-- app only ever builds a per-user client (lib/insforge/server.ts), so every query
-- it runs is under the caller's RLS. A GitHub token in a normally-granted table
-- would therefore have to be SELECTable by admins — and anything an admin's
-- session can read, that admin's browser can read straight from PostgREST using
-- the public anon key. An org token carrying repo write is far too strong for
-- that.
--
-- So github_connection carries NO grants to anon or authenticated at all. Only
-- the github-sync edge function, holding the service API key, ever touches it,
-- and the token is stored AES-GCM encrypted under a key that lives in that
-- function's environment and never in this database. Clients read connection
-- STATUS through a SECURITY DEFINER function that structurally cannot return the
-- ciphertext.

-- ============================================================
-- github_connection
-- ============================================================
-- Singleton: one org connection for the whole workspace. The BOOLEAN primary key
-- with CHECK (id) is the standard one-row guard — a second INSERT collides on the
-- PK rather than silently creating a rival configuration.

CREATE TABLE public.github_connection (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  org TEXT NOT NULL CHECK (char_length(btrim(org)) BETWEEN 1 AND 39),
  token_ciphertext TEXT,
  token_iv TEXT,
  token_last_four TEXT
    CHECK (token_last_four IS NULL OR char_length(token_last_four) = 4),
  token_expires_at TIMESTAMPTZ,
  token_can_write BOOLEAN NOT NULL DEFAULT FALSE,
  validated_at TIMESTAMPTZ,
  validation_error TEXT,
  connected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Ciphertext and IV are useless apart; never store one without the other.
  CONSTRAINT github_connection_token_complete CHECK (
    num_nonnulls(token_ciphertext, token_iv) IN (0, 2)
  )
);

CREATE TRIGGER github_connection_updated_at
BEFORE UPDATE ON public.github_connection
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

ALTER TABLE public.github_connection ENABLE ROW LEVEL SECURITY;

-- No policies and no grants, deliberately: there is no client path to this table
-- in any role. Read that as the security boundary, not as an oversight.
REVOKE ALL ON public.github_connection FROM anon, authenticated;

INSERT INTO public.github_connection (id, org)
VALUES (TRUE, 'code92-dev')
ON CONFLICT (id) DO NOTHING;

-- What an admin is allowed to see about the connection. Every column of
-- github_connection EXCEPT token_ciphertext and token_iv, so the credential
-- cannot leak through this path even if the function is called directly.
-- Returns zero rows for non-admins.
CREATE OR REPLACE FUNCTION public.github_connection_status()
RETURNS TABLE (
  org TEXT,
  is_configured BOOLEAN,
  token_last_four TEXT,
  token_expires_at TIMESTAMPTZ,
  token_can_write BOOLEAN,
  validated_at TIMESTAMPTZ,
  validation_error TEXT,
  connected_by UUID,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT
    c.org,
    c.token_ciphertext IS NOT NULL,
    c.token_last_four,
    c.token_expires_at,
    c.token_can_write,
    c.validated_at,
    c.validation_error,
    c.connected_by,
    c.updated_at
  FROM public.github_connection c
  WHERE public.is_admin();
$$;

GRANT EXECUTE ON FUNCTION public.github_connection_status() TO authenticated;

-- Product owners are not admins but still need to know whether connecting a repo
-- is even possible, so they get this one bit — and nothing else.
CREATE OR REPLACE FUNCTION public.github_is_configured()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.is_active_member() AND EXISTS (
    SELECT 1 FROM public.github_connection WHERE token_ciphertext IS NOT NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.github_is_configured() TO authenticated;

-- ============================================================
-- products.github_*
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN github_repo TEXT UNIQUE
    CHECK (github_repo IS NULL OR github_repo ~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'),
  ADD COLUMN github_repo_id BIGINT UNIQUE,
  ADD COLUMN github_default_branch TEXT,
  ADD COLUMN github_linked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN github_linked_at TIMESTAMPTZ;

-- github_repo_id is what the sync actually trusts. A repo rename on GitHub
-- changes the full name but never the id, so pinning the id means a rename can
-- be detected and repaired rather than silently repointing a product at whatever
-- now occupies the old name.
ALTER TABLE public.products
  ADD CONSTRAINT products_github_link_complete CHECK (
    num_nonnulls(github_repo, github_repo_id) IN (0, 2)
  );

-- Readable by members, writable by NO client. The edge function checks that the
-- repo is private and owned by the org before writing these columns; a column
-- UPDATE grant here would let a client fabricate a link that GitHub never
-- confirmed. UNIQUE on both columns is what stops two products claiming one repo.
GRANT SELECT (
  github_repo, github_repo_id, github_default_branch, github_linked_by,
  github_linked_at
) ON public.products TO authenticated;

-- ============================================================
-- phase_artifacts.github_*
-- ============================================================
-- Mirror state per artifact. 'pending' is the resting state for anything not yet
-- pushed, which is also what lets a failure stay visible and retryable instead of
-- being silently lost — and what a future scheduled drain would select on.

ALTER TABLE public.phase_artifacts
  ADD COLUMN github_path TEXT,
  ADD COLUMN github_commit_sha TEXT,
  ADD COLUMN github_synced_at TIMESTAMPTZ,
  ADD COLUMN github_sync_error TEXT,
  ADD COLUMN github_sync_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (github_sync_state IN ('pending', 'synced', 'failed', 'skipped'));

CREATE INDEX phase_artifacts_github_sync_state_idx
ON public.phase_artifacts (github_sync_state)
WHERE github_sync_state IN ('pending', 'failed');

-- phase_artifacts held a TABLE-level INSERT grant, which would now silently cover
-- the columns added above — letting a client insert a row that claims to be
-- already synced, carrying a commit SHA that was never pushed. Re-grant INSERT
-- column-scoped so the sync columns are writable only by the edge function.
-- SELECT stays table-level so the new columns are readable.
REVOKE INSERT ON public.phase_artifacts FROM authenticated;
GRANT INSERT (
  phase_id, artifact_type, title, storage_url, storage_key, file_name,
  mime_type, size_bytes, url, knowledge_item_id, notes, generated_by,
  agent_run_id, uploader_id
) ON public.phase_artifacts TO authenticated;

-- ============================================================
-- github_sync_log
-- ============================================================
-- Append-only audit of every GitHub write, following phase_transitions: the
-- record of what was pushed, by whom, and what failed is evidence, so clients
-- get SELECT and nothing else.

CREATE TABLE public.github_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: deleting an artifact must not erase the record that
  -- it was once pushed to a repo.
  artifact_id UUID REFERENCES public.phase_artifacts(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (
    action IN (
      'save_credentials', 'link', 'unlink',
      'push_artifact', 'delete_artifact', 'push_manifest'
    )
  ),
  repo TEXT,
  path TEXT,
  commit_sha TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  error TEXT,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX github_sync_log_product_idx
ON public.github_sync_log (product_id, created_at DESC);

CREATE INDEX github_sync_log_created_idx
ON public.github_sync_log (created_at DESC);

ALTER TABLE public.github_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read github sync log"
ON public.github_sync_log FOR SELECT TO authenticated
USING (public.is_active_member());

REVOKE ALL ON public.github_sync_log FROM anon, authenticated;
GRANT SELECT ON public.github_sync_log TO authenticated;
