-- Release 0.3 — the projections the new screens read.
--
--   latest_gate_outcome()   the decision that currently counts for a gate
--   product_overview        recreated: business track in, lifecycle out
--   governance_gate_log     every gate, stage and release decision in one list
--   dashboard_strips()      the four counts at the top of the dashboard
--   dashboard_attention()   what needs a look, below the strips
--   my_waiting_on()         rewritten: gate_ready is replaced by the three kinds
--                           the loop produces

-- ============================================================
-- latest_gate_outcome
-- ============================================================

CREATE OR REPLACE FUNCTION public.latest_gate_outcome(p_product_id UUID, p_gate INTEGER)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT d.decision
  FROM public.product_gate_decisions d
  WHERE d.product_id = p_product_id AND d.gate = p_gate
  ORDER BY d.created_at DESC, d.id DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.latest_gate_outcome(UUID, INTEGER) TO authenticated;

-- ============================================================
-- product_overview — business track in, lifecycle out
-- ============================================================
-- Dropped and recreated: a view cannot lose columns in place, and three lifecycle
-- columns are going. Every column that stays keeps its name.

DROP VIEW public.product_overview;

CREATE VIEW public.product_overview
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.name,
  p.slug,
  p.description,
  p.description_ar,
  p.category,
  p.stage,
  p.health,
  p.owner_id,
  tm.display_name AS owner_name,
  p.review_interval_days,
  p.next_review_at,
  p.last_status_update_at,
  p.last_trend_scan_at,
  p.trend_scan_enabled,
  p.archived_at,
  p.created_at,
  (p.next_review_at IS NOT NULL AND p.next_review_at < now()) AS is_overdue,
  GREATEST(0::numeric, EXTRACT(epoch FROM now() - COALESCE(p.last_status_update_at, p.created_at)) / 86400::numeric)::integer AS staleness_days,
  lu.summary AS last_update_summary,
  lu.author_name AS last_update_author,
  (SELECT count(*)::integer
     FROM public.product_trends pt
    WHERE pt.product_id = p.id
      AND pt.dismissed_at IS NULL
      AND pt.created_at > (now() - '7 days'::interval)) AS trend_count_7d,
  p.logo_url,
  p.risk_tier,
  p.business_stage,
  p.origination,
  p.ownership,
  p.code92_equity_pct,
  p.operator_name,
  p.operator_user_id,
  p.operator_contact_id,
  p.business_owner_id,
  bo.display_name AS business_owner_name,
  p.sector,
  (g1.decision = 'go') AS gate1_go,
  (g2.decision = 'go') AS gate2_go,
  cr.id AS current_release_id,
  cr.version AS current_release_version,
  cr.stage AS current_release_stage,
  cr.status AS current_release_status,
  coalesce(ck.done, 0) AS checklist_done,
  coalesce(ck.total, 0) AS checklist_total
FROM public.products p
LEFT JOIN public.team_members tm ON tm.user_id = p.owner_id
LEFT JOIN public.team_members bo ON bo.user_id = p.business_owner_id
LEFT JOIN LATERAL (
  SELECT su.summary, tum.display_name AS author_name
  FROM public.status_updates su
  LEFT JOIN public.team_members tum ON tum.user_id = su.author_id
  WHERE su.product_id = p.id
  ORDER BY su.created_at DESC
  LIMIT 1
) lu ON true
LEFT JOIN LATERAL (
  SELECT d.decision FROM public.product_gate_decisions d
  WHERE d.product_id = p.id AND d.gate = 1
  ORDER BY d.created_at DESC, d.id DESC LIMIT 1
) g1 ON true
LEFT JOIN LATERAL (
  SELECT d.decision FROM public.product_gate_decisions d
  WHERE d.product_id = p.id AND d.gate = 2
  ORDER BY d.created_at DESC, d.id DESC LIMIT 1
) g2 ON true
-- The current release is the newest one that has not been cancelled.
LEFT JOIN LATERAL (
  SELECT r.id, r.version, r.stage, r.status
  FROM public.product_releases r
  WHERE r.product_id = p.id AND r.status <> 'cancelled'
  ORDER BY r.release_number DESC NULLS LAST
  LIMIT 1
) cr ON true
-- Checklist progress is shown for the stage the product is in now.
LEFT JOIN LATERAL (
  SELECT count(*) FILTER (WHERE c.done)::int AS done, count(*)::int AS total
  FROM public.product_stage_checklist_items c
  WHERE c.product_id = p.id AND c.stage = p.business_stage
) ck ON true;

GRANT SELECT ON public.product_overview TO authenticated;

-- ============================================================
-- governance_gate_log
-- ============================================================
-- One read for /governance: business stage moves, gate decisions, release stage
-- moves, approvals and status changes, and the retired lifecycle's transitions.
-- A row says what moved (from_value → to_value), who moved it, the note or
-- reason, and what was missing at the time. security_invoker: each source table's
-- own RLS decides what a reader sees, and every one of them is team-wide.

CREATE VIEW public.governance_gate_log
WITH (security_invoker = true)
AS
SELECT
  bst.created_at AS occurred_at,
  'business_stage'::text AS kind,
  bst.product_id,
  p.name AS product_name,
  NULL::uuid AS release_id,
  NULL::text AS release_version,
  bst.from_stage AS from_value,
  bst.to_stage AS to_value,
  bst.actor_id,
  tm.display_name AS actor_name,
  bst.reason AS note,
  NULL::text AS waiver_reason,
  false AS self_approved,
  '{}'::text[] AS missing,
  NULL::integer AS gate,
  NULL::text AS decision
FROM public.business_stage_transitions bst
JOIN public.products p ON p.id = bst.product_id
LEFT JOIN public.team_members tm ON tm.user_id = bst.actor_id

UNION ALL

SELECT
  g.created_at,
  'gate_decision',
  g.product_id,
  p.name,
  NULL::uuid,
  NULL::text,
  NULL::text,
  NULL::text,
  g.decided_by,
  tm.display_name,
  g.note,
  NULL::text,
  false,
  '{}'::text[],
  g.gate::integer,
  g.decision
FROM public.product_gate_decisions g
JOIN public.products p ON p.id = g.product_id
LEFT JOIN public.team_members tm ON tm.user_id = g.decided_by

UNION ALL

SELECT
  t.created_at,
  CASE
    WHEN t.from_stage IS NOT NULL AND t.from_stage = t.to_stage THEN 'release_approval'
    WHEN t.from_stage IS NOT NULL OR t.to_stage IS NOT NULL THEN 'release_stage'
    ELSE 'release_status'
  END,
  t.product_id,
  p.name,
  t.release_id,
  r.version,
  coalesce(t.from_stage, t.from_status),
  coalesce(t.to_stage, t.to_status),
  t.actor_id,
  tm.display_name,
  t.note,
  t.waiver_reason,
  t.self_approved,
  coalesce(t.missing_checks, '{}') || coalesce(t.missing_artifacts, '{}'),
  NULL::integer,
  NULL::text
FROM public.release_transitions t
JOIN public.products p ON p.id = t.product_id
LEFT JOIN public.product_releases r ON r.id = t.release_id
LEFT JOIN public.team_members tm ON tm.user_id = t.actor_id

UNION ALL

SELECT
  pt.created_at,
  'lifecycle_retired',
  pt.product_id,
  p.name,
  NULL::uuid,
  NULL::text,
  pt.from_state,
  pt.to_state,
  pt.actor_id,
  tm.display_name,
  NULL::text,
  pt.waiver_reason,
  pt.self_approved,
  pt.missing_artifacts,
  NULL::integer,
  NULL::text
FROM public.phase_transitions pt
JOIN public.products p ON p.id = pt.product_id
LEFT JOIN public.team_members tm ON tm.user_id = pt.actor_id;

GRANT SELECT ON public.governance_gate_log TO authenticated;

-- ============================================================
-- dashboard_strips
-- ============================================================
-- One round trip for the four strips. Each count is a link in the UI to the
-- filtered view it counts, so the numbers here and the lists there must agree:
-- the same predicates, written once each.

CREATE OR REPLACE FUNCTION public.dashboard_strips()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'products', (
      SELECT jsonb_build_object(
        'idea',    count(*) FILTER (WHERE p.business_stage = 'idea'),
        'concept', count(*) FILTER (WHERE p.business_stage = 'concept'),
        'build',   count(*) FILTER (WHERE p.business_stage = 'build'),
        'venture', count(*) FILTER (WHERE p.business_stage = 'venture'),
        'company', count(*) FILTER (WHERE p.business_stage = 'company'),
        'board',   count(*) FILTER (WHERE p.business_stage = 'board'),
        'gate1Pending', count(*) FILTER (
          WHERE p.business_stage = 'concept'
            AND coalesce(public.latest_gate_outcome(p.id, 1), '') <> 'go'
        ),
        'gate2Pending', count(*) FILTER (
          WHERE p.business_stage = 'venture'
            AND coalesce(public.latest_gate_outcome(p.id, 2), '') <> 'go'
        )
      )
      FROM public.products p
      WHERE p.archived_at IS NULL
    ),
    'releases', (
      SELECT jsonb_build_object(
        'plan',     count(*) FILTER (WHERE r.stage = 'plan'),
        'design',   count(*) FILTER (WHERE r.stage = 'design'),
        'build',    count(*) FILTER (WHERE r.stage = 'build'),
        'test',     count(*) FILTER (WHERE r.stage = 'test'),
        'deploy',   count(*) FILTER (WHERE r.stage = 'deploy'),
        'maintain', count(*) FILTER (WHERE r.stage = 'maintain'),
        'overdue',  count(*) FILTER (
          WHERE r.target_date < public.business_today()
            AND r.status IN ('planned', 'in_progress', 'ready')
        )
      )
      FROM public.product_releases r
      JOIN public.products p ON p.id = r.product_id
      WHERE p.archived_at IS NULL
        AND r.status IN ('planned', 'in_progress', 'ready', 'released')
    ),
    'projects', (
      SELECT jsonb_build_object(
        'kickoff',   count(*) FILTER (WHERE pr.phase = 'kickoff'),
        'discovery', count(*) FILTER (WHERE pr.phase = 'discovery'),
        'delivery',  count(*) FILTER (WHERE pr.phase = 'delivery'),
        'handover',  count(*) FILTER (WHERE pr.phase = 'handover'),
        'stale',     count(*) FILTER (WHERE pr.is_stale)
      )
      FROM public.project_overview pr
      WHERE pr.is_open
    ),
    'sales', (
      SELECT jsonb_build_object(
        'lead',           count(*) FILTER (WHERE d.stage = 'lead'),
        'meeting',        count(*) FILTER (WHERE d.stage = 'meeting'),
        'discovery_demo', count(*) FILTER (WHERE d.stage = 'discovery_demo'),
        'proposal',       count(*) FILTER (WHERE d.stage = 'proposal'),
        'negotiation',    count(*) FILTER (WHERE d.stage = 'negotiation'),
        -- The team prices in KWD. Other currencies are not summed into this.
        'openValueKwd',   coalesce(sum(d.value_amount) FILTER (
          WHERE d.is_open AND d.currency = 'KWD'
        ), 0),
        'closingThisMonth', count(*) FILTER (
          WHERE d.is_open
            AND d.expected_close >= date_trunc('month', public.business_today())::date
            AND d.expected_close < (date_trunc('month', public.business_today()) + interval '1 month')::date
        ),
        'stale', count(*) FILTER (WHERE d.is_stale)
      )
      FROM public.deal_overview d
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_strips() TO authenticated;

-- ============================================================
-- dashboard_attention
-- ============================================================
-- Everything that is waiting on someone, whoever that is. Unlike my_waiting_on()
-- this is the team's list, not one person's.

CREATE OR REPLACE FUNCTION public.dashboard_attention()
RETURNS TABLE (
  kind TEXT,
  record_id UUID,
  title TEXT,
  detail TEXT,
  due_on DATE
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT 'gate_pending', p.id, p.name,
         CASE WHEN p.business_stage = 'concept' THEN 'Gate 1' ELSE 'Gate 2' END,
         NULL::date
  FROM public.products p
  WHERE public.is_active_member()
    AND p.archived_at IS NULL
    AND (
      (p.business_stage = 'concept' AND coalesce(public.latest_gate_outcome(p.id, 1), '') <> 'go')
      OR (p.business_stage = 'venture' AND coalesce(public.latest_gate_outcome(p.id, 2), '') <> 'go')
    )

  UNION ALL

  SELECT 'release_overdue', r.id, p.name || ' · ' || r.version, r.stage, r.target_date
  FROM public.product_releases r
  JOIN public.products p ON p.id = r.product_id
  WHERE public.is_active_member()
    AND p.archived_at IS NULL
    AND r.target_date < public.business_today()
    AND r.status IN ('planned', 'in_progress', 'ready')

  UNION ALL

  SELECT 'project_stale', pr.id, pr.name, pr.account_name, NULL::date
  FROM public.project_overview pr
  WHERE pr.is_stale

  UNION ALL

  SELECT 'product_no_business_owner', p.id, p.name, NULL::text, NULL::date
  FROM public.products p
  WHERE public.is_active_member()
    AND p.archived_at IS NULL
    AND p.business_owner_id IS NULL

  UNION ALL

  SELECT 'product_no_operator', p.id, p.name, p.business_stage, NULL::date
  FROM public.products p
  WHERE public.is_active_member()
    AND p.archived_at IS NULL
    AND p.business_stage IN ('build', 'venture', 'company', 'board')
    AND p.operator_name IS NULL

  ORDER BY 1, 3;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_attention() TO authenticated;

-- ============================================================
-- my_waiting_on — rewritten for the loop
-- ============================================================
-- gate_ready (the retired lifecycle) is replaced by three kinds:
--
--   business_gate_pending  a founder's decision is due at Gate 1 or Gate 2.
--                          Founders only.
--   release_spec_approval  a release's spec waits at Design for the owner's
--                          approval. The owner or an admin.
--   release_stage_ready    a release's current stage has everything it needs and
--                          can be closed now. The owner or an admin. Uses the same
--                          gap list as move_release_stage(), so an item here means
--                          the move will succeed.
--
-- The other kinds are unchanged from 0.2.

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
    SELECT auth.uid() AS uid,
           public.is_admin() AS admin,
           public.is_founder() AS founder
  ),
  week AS (
    -- Kuwait work week starts Sunday; extract(dow) is 0 for Sunday.
    SELECT public.business_today()
             - extract(dow FROM public.business_today())::int AS starts
  )

  SELECT 'business_gate_pending', p.id, p.id, p.name,
         CASE WHEN p.business_stage = 'concept' THEN 'Gate 1' ELSE 'Gate 2' END,
         NULL::date
  FROM public.products p, me
  WHERE me.founder
    AND p.archived_at IS NULL
    AND (
      (p.business_stage = 'concept' AND coalesce(public.latest_gate_outcome(p.id, 1), '') <> 'go')
      OR (p.business_stage = 'venture' AND coalesce(public.latest_gate_outcome(p.id, 2), '') <> 'go')
    )

  UNION ALL

  SELECT 'release_spec_approval', r.id, r.product_id, p.name || ' · ' || r.version, 'Design',
         r.target_date
  FROM public.product_releases r
  JOIN public.products p ON p.id = r.product_id, me
  WHERE (p.owner_id = me.uid OR me.admin)
    AND p.archived_at IS NULL
    AND r.stage = 'design'
    AND r.spec_approved_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.release_artifact_requirements q
      WHERE q.release_id = r.id AND q.artifact_key = 'spec' AND q.is_required
    )

  UNION ALL

  SELECT 'release_stage_ready', r.id, r.product_id, p.name || ' · ' || r.version,
         initcap(r.stage), r.target_date
  FROM public.product_releases r
  JOIN public.products p ON p.id = r.product_id, me
  WHERE (p.owner_id = me.uid OR me.admin)
    AND p.archived_at IS NULL
    AND r.stage <> 'maintain'
    AND r.status NOT IN ('cancelled', 'rolled_back')
    AND cardinality(public.release_stage_gaps(r.id)) = 0

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
