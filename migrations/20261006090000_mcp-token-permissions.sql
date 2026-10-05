-- MCP tokens carry a set of permissions chosen at creation instead of a
-- read/write scope. Every token can read; each further permission unlocks one
-- group of tools (see lib/mcp/permissions.ts — change both together). The
-- token still never exceeds its owner: tools run under the owner's RLS, so a
-- permission only decides which of the owner's own abilities a client may use.

ALTER TABLE public.mcp_access_tokens
  ADD COLUMN permissions TEXT[] NOT NULL DEFAULT ARRAY['read']::TEXT[];

UPDATE public.mcp_access_tokens
SET permissions = CASE scope
  WHEN 'write' THEN ARRAY['read', 'tasks', 'products', 'knowledge']::TEXT[]
  ELSE ARRAY['read']::TEXT[]
END;

ALTER TABLE public.mcp_access_tokens
  ADD CONSTRAINT mcp_access_tokens_permissions_known CHECK (
    permissions <@ ARRAY['read', 'tasks', 'products', 'lifecycle', 'knowledge',
      'releases', 'channels', 'attachments', 'delete']::TEXT[]
    AND 'read' = ANY (permissions)
  );

DROP FUNCTION public.resolve_mcp_access_token(TEXT);
DROP FUNCTION public.create_mcp_access_token(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ);
ALTER TABLE public.mcp_access_tokens DROP COLUMN scope;

-- Column grants are explicit, so the new column needs its own.
GRANT SELECT (permissions) ON public.mcp_access_tokens TO authenticated;

CREATE OR REPLACE FUNCTION public.create_mcp_access_token(
  p_name TEXT,
  p_token_hash TEXT,
  p_token_prefix TEXT,
  p_permissions TEXT[],
  p_expires_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_active_member() THEN
    RAISE EXCEPTION 'not an active member' USING ERRCODE = '42501';
  END IF;
  IF p_expires_at <= now() OR p_expires_at > now() + INTERVAL '366 days' THEN
    RAISE EXCEPTION 'invalid expiry' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('mcp_access_tokens:' || (SELECT auth.uid())::text, 0));
  IF (
    SELECT count(*) FROM public.mcp_access_tokens
    WHERE user_id = (SELECT auth.uid()) AND revoked_at IS NULL AND expires_at > now()
  ) >= 10 THEN
    RAISE EXCEPTION 'token limit reached' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.mcp_access_tokens (user_id, name, token_hash, token_prefix, permissions, expires_at)
  VALUES ((SELECT auth.uid()), btrim(p_name), p_token_hash, p_token_prefix,
    ARRAY(SELECT DISTINCT unnest(p_permissions || ARRAY['read']::TEXT[]) ORDER BY 1), p_expires_at)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_mcp_access_token(TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_mcp_access_token(TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ) TO authenticated;

-- Resolution by hash (every MCP request) or by id (an upload link minted by a
-- token, so revoking the token also kills its outstanding links). Exactly one
-- argument is used. Restricted to project_admin, as before.
CREATE OR REPLACE FUNCTION public.resolve_mcp_access_token(
  p_token_hash TEXT DEFAULT NULL,
  p_token_id UUID DEFAULT NULL
)
RETURNS TABLE (token_id UUID, user_id UUID, permissions TEXT[], display_name TEXT)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF (p_token_hash IS NULL) = (p_token_id IS NULL) THEN
    RAISE EXCEPTION 'pass exactly one of hash or id' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH found AS (
    SELECT t.id, t.user_id, t.permissions, m.display_name
    FROM public.mcp_access_tokens t
    JOIN public.team_members m ON m.user_id = t.user_id AND m.is_active
    WHERE (t.token_hash = p_token_hash OR t.id = p_token_id)
      AND t.revoked_at IS NULL
      AND t.expires_at > now()
  ), touched AS (
    UPDATE public.mcp_access_tokens t
    SET last_used_at = now()
    FROM found
    WHERE t.id = found.id
      AND (t.last_used_at IS NULL OR t.last_used_at < now() - INTERVAL '1 minute')
    RETURNING t.id
  )
  SELECT found.id, found.user_id, found.permissions, found.display_name FROM found;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_mcp_access_token(TEXT, UUID) FROM PUBLIC, anon, authenticated;
