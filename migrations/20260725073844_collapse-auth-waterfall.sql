-- Collapse the per-request auth waterfall into a single round trip.
--
-- Before: every page render and every server action made two SEQUENTIAL
-- network calls to the backend before any page data could be fetched --
-- auth.getCurrentUser() (GET /api/auth/sessions/current) purely to learn the
-- caller's id, and only then a team_members lookup keyed by that id.
--
-- The id could not be dropped client-side: the team_members SELECT policy is
-- "is_active_member() OR user_id = auth.uid()", so an active member can read
-- the whole roster and an unfiltered select would return an arbitrary row
-- rather than the caller's own.
--
-- get_me() resolves identity server-side from auth.uid(), so the caller no
-- longer has to know its own id first. Two sequential round trips become one.
--
-- LEFT JOIN, not INNER: a signed-in user with no team_members row must still
-- resolve (is_active = false) so the app can render the "awaiting approval"
-- state instead of treating them as signed out.

CREATE OR REPLACE FUNCTION public.get_me()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  display_name TEXT,
  role TEXT,
  is_active BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT
    u.id,
    u.email,
    tm.display_name,
    tm.role,
    COALESCE(tm.is_active, false)
  FROM auth.users u
  LEFT JOIN public.team_members tm ON tm.user_id = u.id
  WHERE u.id = (SELECT auth.uid());
$$;

-- SECURITY DEFINER reads auth.users, so keep it off anon entirely. It is
-- self-scoped by auth.uid() and returns at most the caller's own row.
REVOKE ALL ON FUNCTION public.get_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_me() TO authenticated;

-- Supports the cross-product trends feed in app/[locale]/trends/page.tsx,
-- which orders by created_at DESC with no product_id predicate. The existing
-- product_trends_product_recent_idx leads with product_id and cannot serve
-- that ordering.
--
-- NOTE: preventative only. product_trends is currently empty, so this fixes
-- nothing measurable today; it matters once the scheduled trend-scan pipeline
-- starts filling the table.
CREATE INDEX IF NOT EXISTS product_trends_recent_idx
ON public.product_trends (created_at DESC)
WHERE dismissed_at IS NULL;
