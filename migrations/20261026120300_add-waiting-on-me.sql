-- Release 0.2 — My work › Waiting on me, and the navigation badge.
--
-- my_waiting_on() lists what needs the caller's decision, drawn from existing
-- records rather than tasks. An item leaves the list on its own once the
-- underlying condition stops holding — there is no dismiss state to drift.
--
--   gate_ready         a lifecycle phase in progress on a product the caller
--                      can advance, with every required artifact filed: the
--                      evidence is in and the gate is waiting on a decision.
--                      Owners for low/medium risk; admins for high risk,
--                      mirroring advance_lifecycle_phase(). Phases that require
--                      nothing are not listed — "in progress" alone is work,
--                      not a pending decision.
--   proposal_pending   an agent proposal still pending, on a product the
--                      caller owns, or with no product in a channel the caller
--                      follows.
--   review_overdue     a product the caller owns whose next review has passed.
--   mention_unreplied  a mention of the caller in the last 30 days with no
--                      later message from the caller in that thread.
--   deal_stale         an open deal the caller owns that is stale.
--   deal_closing       an open deal the caller owns expected to close this
--                      week (Sunday–Saturday, Kuwait calendar), not stale.
--
-- SECURITY INVOKER: every row comes through the caller's own RLS, so private
-- channels and direct messages stay private and inactive members get nothing.

CREATE OR REPLACE FUNCTION public.my_waiting_on()
RETURNS TABLE (
  source TEXT,
  record_id UUID,
  context_id UUID,
  title TEXT,
  subtitle TEXT,
  due_on DATE
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH me AS (
    SELECT auth.uid() AS uid, public.is_admin() AS admin
  ),
  week AS (
    -- Kuwait work week starts Sunday; extract(dow) is 0 for Sunday.
    SELECT public.business_today()
             - extract(dow FROM public.business_today())::int AS starts
  ),
  current_phases AS (
    SELECT DISTINCT ON (lp.product_id, lp.phase)
      lp.id, lp.product_id, lp.phase, lp.state, lp.entered_at
    FROM public.product_lifecycle_phases lp
    ORDER BY lp.product_id, lp.phase, lp.cycle DESC
  )

  SELECT 'gate_ready', cp.id, p.id, p.name, cp.phase,
         (cp.entered_at AT TIME ZONE 'Asia/Kuwait')::date
  FROM current_phases cp
  JOIN public.products p ON p.id = cp.product_id, me
  WHERE cp.state = 'in_progress'
    AND p.archived_at IS NULL
    AND CASE WHEN p.risk_tier = 'high' THEN me.admin ELSE p.owner_id = me.uid END
    AND cardinality(public.lifecycle_required_artifacts(cp.phase, p.risk_tier)) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(public.lifecycle_required_artifacts(cp.phase, p.risk_tier)) AS req(t)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.phase_artifacts pa
        WHERE pa.phase_id = cp.id AND pa.artifact_type = req.t
      )
    )

  UNION ALL

  SELECT 'proposal_pending', ap.id, ap.channel_id,
         coalesce(tm.display_name, 'Agent'), ap.action,
         (ap.created_at AT TIME ZONE 'Asia/Kuwait')::date
  FROM public.agent_proposals ap
  LEFT JOIN public.products p ON p.id = ap.product_id
  LEFT JOIN public.team_members tm ON tm.user_id = ap.agent_id, me
  WHERE ap.status = 'pending'
    AND (
      (ap.product_id IS NOT NULL AND p.owner_id = me.uid)
      OR (ap.product_id IS NULL AND EXISTS (
        SELECT 1 FROM public.channel_members cm
        WHERE cm.channel_id = ap.channel_id AND cm.user_id = me.uid
      ))
    )

  UNION ALL

  SELECT 'review_overdue', p.id, p.id, p.name, NULL::text,
         (p.next_review_at AT TIME ZONE 'Asia/Kuwait')::date
  FROM public.products p, me
  WHERE p.owner_id = me.uid
    AND p.archived_at IS NULL
    AND p.next_review_at < now()

  UNION ALL

  SELECT 'mention_unreplied', m.id, m.channel_id,
         coalesce(author.display_name, 'Someone'), left(m.body, 140),
         (m.created_at AT TIME ZONE 'Asia/Kuwait')::date
  FROM public.message_mentions mm
  JOIN public.messages m ON m.id = mm.message_id
  LEFT JOIN public.team_members author ON author.user_id = m.author_id, me
  WHERE mm.mentioned_user_id = me.uid
    AND mm.created_at > now() - interval '30 days'
    AND m.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.messages reply
      WHERE reply.author_id = me.uid
        AND reply.created_at > m.created_at
        AND coalesce(reply.parent_id, reply.id) = coalesce(m.parent_id, m.id)
    )

  UNION ALL

  SELECT 'deal_stale', d.id, d.account_id, d.name, d.account_name,
         coalesce(d.next_action_date, (d.next_action_updated_at AT TIME ZONE 'Asia/Kuwait')::date)
  FROM public.deal_overview d, me
  WHERE d.owner_id = me.uid AND d.is_stale

  UNION ALL

  SELECT 'deal_closing', d.id, d.account_id, d.name, d.account_name, d.expected_close
  FROM public.deal_overview d, me, week
  WHERE d.owner_id = me.uid
    AND d.is_open
    AND NOT d.is_stale
    AND d.expected_close BETWEEN week.starts AND week.starts + 6

  ORDER BY 6 NULLS LAST, 4;
$$;

REVOKE ALL ON FUNCTION public.my_waiting_on() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_waiting_on() TO authenticated;

-- The badge and the My work counters in one round trip:
-- badge = waiting items + the caller's overdue open tasks.
CREATE OR REPLACE FUNCTION public.my_work_counts()
RETURNS TABLE (
  waiting INTEGER,
  overdue_tasks INTEGER,
  due_today_tasks INTEGER,
  badge INTEGER
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH w AS (SELECT count(*)::int AS n FROM public.my_waiting_on()),
  t AS (
    SELECT
      count(*) FILTER (WHERE due_date < public.business_today())::int AS overdue,
      count(*) FILTER (WHERE due_date = public.business_today())::int AS today
    FROM public.product_tasks
    WHERE assignee_id = auth.uid() AND status = 'pending'
  )
  SELECT w.n, t.overdue, t.today, w.n + t.overdue FROM w, t;
$$;

REVOKE ALL ON FUNCTION public.my_work_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_work_counts() TO authenticated;

-- Indexes for the branches that would otherwise scan.
CREATE INDEX IF NOT EXISTS products_owner_next_review_idx
ON public.products (owner_id, next_review_at)
WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS agent_proposals_product_pending_idx
ON public.agent_proposals (product_id)
WHERE status = 'pending';
