-- Release 0.3 — the business track of a product.
--
-- A product moves through the Code92 funnel from the pitch deck:
--
--   Idea → Concept ‖ Gate 1 ‖ Build → Venture ‖ Gate 2 ‖ Company → Board
--
-- The two gates are the only hard blocks. Everything else in a stage is a
-- checklist that guides and never blocks. The stage is written only by
-- move_business_stage(), which enforces the gates. Gate decisions are written
-- only by record_gate_decision(), which enforces that a founder made them. Both
-- logs are append-only.
--
-- products.stage (the market stage: idea/beta/live/…) is kept for history and
-- no longer drives anything the UI shows.

-- ============================================================
-- Founders
-- ============================================================
-- Gate decisions are a founder's to make. The role (admin/member) says what a
-- person may administer; founder says whose judgement a gate records. The two
-- are independent. team_members has no UPDATE grant, so only admin_set_founder()
-- can set the flag.

ALTER TABLE public.team_members
  ADD COLUMN is_founder BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_founder()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.user_id = (SELECT auth.uid())
      AND tm.is_active
      AND tm.is_founder
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_founder() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_founder(
  target UUID,
  new_founder BOOLEAN
)
RETURNS public.team_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  result public.team_members;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'only admins can mark founders' USING ERRCODE = '42501';
  END IF;

  IF new_founder AND NOT EXISTS (
    SELECT 1 FROM public.team_members WHERE user_id = target AND is_active
  ) THEN
    RAISE EXCEPTION 'only an active member can be a founder' USING ERRCODE = '22023';
  END IF;

  UPDATE public.team_members
  SET is_founder = new_founder
  WHERE user_id = target
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'team member not found: %', target USING ERRCODE = 'P0002';
  END IF;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_founder(UUID, BOOLEAN) TO authenticated;

-- ============================================================
-- Vocabulary
-- ============================================================
-- Authoritative here, mirrored in lib/business-track.ts. Change both together.

CREATE OR REPLACE FUNCTION public.business_stage_index(p_stage TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_stage
    WHEN 'idea'    THEN 1
    WHEN 'concept' THEN 2
    WHEN 'build'   THEN 3
    WHEN 'venture' THEN 4
    WHEN 'company' THEN 5
    WHEN 'board'   THEN 6
  END;
$$;

CREATE OR REPLACE FUNCTION public.business_stage_at(p_index INTEGER)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_index
    WHEN 1 THEN 'idea'
    WHEN 2 THEN 'concept'
    WHEN 3 THEN 'build'
    WHEN 4 THEN 'venture'
    WHEN 5 THEN 'company'
    WHEN 6 THEN 'board'
  END;
$$;

-- ============================================================
-- products: business fields
-- ============================================================
-- Every business column is nullable on purpose. A product that was entered
-- before the funnel existed has no origination or ownership yet, and inventing
-- one would hide that. The attention list surfaces the gaps instead.

ALTER TABLE public.products
  ADD COLUMN business_stage TEXT NOT NULL DEFAULT 'idea'
    CHECK (business_stage IN ('idea', 'concept', 'build', 'venture', 'company', 'board')),
  ADD COLUMN origination TEXT
    CHECK (origination IS NULL OR origination IN ('discovery', 'operator_brought', 'bench_built')),
  ADD COLUMN ownership TEXT
    CHECK (ownership IS NULL OR ownership IN ('code92_full', 'co_owned', 'client')),
  -- Code92's share of the equity, in percent. Meaningful only when co-owned.
  ADD COLUMN code92_equity_pct NUMERIC(5, 2)
    CHECK (code92_equity_pct IS NULL OR code92_equity_pct BETWEEN 0 AND 100),
  ADD COLUMN operator_name TEXT
    CHECK (operator_name IS NULL OR char_length(btrim(operator_name)) BETWEEN 1 AND 200),
  ADD COLUMN operator_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN operator_contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN business_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN sector TEXT
    CHECK (sector IS NULL OR char_length(btrim(sector)) BETWEEN 1 AND 100),
  ADD CONSTRAINT products_equity_needs_co_owned CHECK (
    code92_equity_pct IS NULL OR ownership = 'co_owned'
  ),
  ADD CONSTRAINT products_co_owned_needs_equity CHECK (
    ownership IS DISTINCT FROM 'co_owned' OR code92_equity_pct IS NOT NULL
  );

CREATE INDEX products_business_stage_idx
ON public.products (business_stage)
WHERE archived_at IS NULL;

CREATE INDEX products_business_owner_id_idx
ON public.products (business_owner_id);

-- The INSERT grant on products is column-scoped and leaves business_stage out
-- (20260728072155), so a client cannot name a stage. This trigger is the second
-- lock: whatever writes a product, it starts at Idea, and Gate 1 cannot be
-- skipped by a writer that bypasses the grant.
CREATE OR REPLACE FUNCTION public.products_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.health := 'unknown';
  NEW.last_status_update_at := NULL;
  NEW.last_trend_scan_at := NULL;
  NEW.business_stage := 'idea';
  IF NEW.next_review_at IS NULL THEN
    NEW.next_review_at := now() + make_interval(days => NEW.review_interval_days);
  END IF;
  RETURN NEW;
END;
$$;

-- Business fields are written through this RPC rather than a column grant. The
-- business owner may edit them, but a column grant on products would also let
-- them edit the product's name, links and the rest, which only the owner may do.
CREATE OR REPLACE FUNCTION public.update_product_business(
  p_product_id UUID,
  p_origination TEXT,
  p_ownership TEXT,
  p_code92_equity_pct NUMERIC,
  p_operator_name TEXT,
  p_operator_user_id UUID,
  p_operator_contact_id UUID,
  p_business_owner_id UUID,
  p_sector TEXT
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  result public.products;
BEGIN
  IF NOT public.can_manage_business(p_product_id) THEN
    RAISE EXCEPTION
      'only the product owner, its business owner or an admin can change its business details'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.products
  SET origination = p_origination,
      ownership = p_ownership,
      code92_equity_pct = CASE WHEN p_ownership = 'co_owned' THEN p_code92_equity_pct END,
      operator_name = nullif(btrim(coalesce(p_operator_name, '')), ''),
      operator_user_id = p_operator_user_id,
      operator_contact_id = p_operator_contact_id,
      business_owner_id = p_business_owner_id,
      sector = nullif(btrim(coalesce(p_sector, '')), '')
  WHERE id = p_product_id
  RETURNING * INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_product_business(
  UUID, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID, UUID, TEXT
) TO authenticated;

-- ============================================================
-- Watchers
-- ============================================================
-- Same shape and rule as deal_watchers: watching is public within the team, and
-- you may only add or remove yourself.

CREATE TABLE public.product_watchers (
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, user_id)
);

CREATE INDEX product_watchers_user_id_idx ON public.product_watchers (user_id, created_at DESC);

ALTER TABLE public.product_watchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read product watchers"
ON public.product_watchers FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "watch a product yourself"
ON public.product_watchers FOR INSERT TO authenticated
WITH CHECK (public.is_active_member() AND user_id = (SELECT auth.uid()));

CREATE POLICY "unwatch a product yourself"
ON public.product_watchers FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.product_watchers FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.product_watchers TO authenticated;

-- ============================================================
-- Who may manage a product's business track
-- ============================================================
-- The owner, the business owner, or an admin — and never on an archived product.
-- Gate decisions have a stricter rule of their own (founders).

CREATE OR REPLACE FUNCTION public.can_manage_business(p_product_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.is_active_member() AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.archived_at IS NULL
      AND (
        p.owner_id = (SELECT auth.uid())
        OR p.business_owner_id = (SELECT auth.uid())
        OR public.is_admin()
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_business(UUID) TO authenticated;

-- ============================================================
-- product_gate_decisions (append-only)
-- ============================================================
-- Gate 1 is decided while a product is in Concept, Gate 2 while it is in
-- Venture. The latest decision for a gate is the one that counts, so a no-go
-- followed by a go is a normal history, not an error.

CREATE TABLE public.product_gate_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  gate SMALLINT NOT NULL CHECK (gate IN (1, 2)),
  decision TEXT NOT NULL CHECK (decision IN ('go', 'no_go')),
  decided_on DATE NOT NULL DEFAULT public.business_today(),
  decided_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  note TEXT NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 2000),
  -- PMF criteria and evidence are required for a Gate 2 go, and nothing else.
  pmf_criteria TEXT CHECK (pmf_criteria IS NULL OR char_length(pmf_criteria) <= 5000),
  evidence TEXT CHECK (evidence IS NULL OR char_length(evidence) <= 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_gate_decisions_pmf_complete CHECK (
    decision = 'no_go'
    OR gate = 1
    OR (btrim(coalesce(pmf_criteria, '')) <> '' AND btrim(coalesce(evidence, '')) <> '')
  )
);

CREATE INDEX product_gate_decisions_product_gate_idx
ON public.product_gate_decisions (product_id, gate, created_at DESC);

ALTER TABLE public.product_gate_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read gate decisions"
ON public.product_gate_decisions FOR SELECT TO authenticated
USING (public.is_active_member());

REVOKE ALL ON public.product_gate_decisions FROM anon, authenticated;
GRANT SELECT ON public.product_gate_decisions TO authenticated;

CREATE OR REPLACE FUNCTION public.record_gate_decision(
  p_product_id UUID,
  p_gate INTEGER,
  p_decision TEXT,
  p_note TEXT,
  p_pmf_criteria TEXT DEFAULT NULL,
  p_evidence TEXT DEFAULT NULL
)
RETURNS public.product_gate_decisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  prod public.products;
  result public.product_gate_decisions;
  note TEXT := nullif(btrim(coalesce(p_note, '')), '');
  criteria TEXT := nullif(btrim(coalesce(p_pmf_criteria, '')), '');
  proof TEXT := nullif(btrim(coalesce(p_evidence, '')), '');
BEGIN
  IF NOT public.is_founder() THEN
    RAISE EXCEPTION 'only founders can record a gate decision' USING ERRCODE = '42501';
  END IF;

  IF p_gate NOT IN (1, 2) THEN
    RAISE EXCEPTION 'unknown gate %', p_gate USING ERRCODE = '22023';
  END IF;

  IF p_decision NOT IN ('go', 'no_go') THEN
    RAISE EXCEPTION 'unknown decision %', p_decision USING ERRCODE = '22023';
  END IF;

  SELECT * INTO prod FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product not found' USING ERRCODE = 'P0002';
  END IF;

  IF prod.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot decide a gate on an archived product' USING ERRCODE = '22023';
  END IF;

  IF p_gate = 1 AND prod.business_stage <> 'concept' THEN
    RAISE EXCEPTION 'Gate 1 is decided while a product is in Concept (it is in %)',
      prod.business_stage USING ERRCODE = '22023';
  END IF;

  IF p_gate = 2 AND prod.business_stage <> 'venture' THEN
    RAISE EXCEPTION 'Gate 2 is decided while a product is in Venture (it is in %)',
      prod.business_stage USING ERRCODE = '22023';
  END IF;

  IF note IS NULL THEN
    RAISE EXCEPTION 'a note is required for a gate decision' USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'go' AND p_gate = 2 AND (criteria IS NULL OR proof IS NULL) THEN
    RAISE EXCEPTION 'PMF criteria and evidence are required to pass Gate 2'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.product_gate_decisions (
    product_id, gate, decision, decided_by, note, pmf_criteria, evidence
  ) VALUES (
    p_product_id, p_gate, p_decision, (SELECT auth.uid()), note,
    CASE WHEN p_gate = 2 THEN criteria END,
    CASE WHEN p_gate = 2 THEN proof END
  )
  RETURNING * INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_gate_decision(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT)
TO authenticated;

-- ============================================================
-- business_stage_transitions (append-only)
-- ============================================================

CREATE TABLE public.business_stage_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 1000),
  -- The decision that let a gate pass, when one did.
  gate_decision_id UUID REFERENCES public.product_gate_decisions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_stage_transitions_moves CHECK (from_stage <> to_stage)
);

CREATE INDEX business_stage_transitions_product_id_idx
ON public.business_stage_transitions (product_id, created_at DESC);

ALTER TABLE public.business_stage_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read business stage transitions"
ON public.business_stage_transitions FOR SELECT TO authenticated
USING (public.is_active_member());

REVOKE ALL ON public.business_stage_transitions FROM anon, authenticated;
GRANT SELECT ON public.business_stage_transitions TO authenticated;

-- ============================================================
-- move_business_stage — the only writer of products.business_stage
-- ============================================================
-- Passing Gate 1 (Concept → Build) also starts the development track: it calls
-- start_development(), which creates Release 0 if the product has none. That
-- function is defined with the release loop.

CREATE OR REPLACE FUNCTION public.move_business_stage(
  p_product_id UUID,
  p_to_stage TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  prod public.products;
  old_stage TEXT;
  reason TEXT := nullif(btrim(coalesce(p_reason, '')), '');
  from_index INTEGER;
  to_index INTEGER;
  gate_id UUID;
  gate_outcome TEXT;
BEGIN
  IF NOT public.can_manage_business(p_product_id) THEN
    RAISE EXCEPTION
      'only the product owner, its business owner or an admin can move a product between business stages'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO prod FROM public.products WHERE id = p_product_id FOR UPDATE;

  old_stage := prod.business_stage;
  from_index := public.business_stage_index(old_stage);
  to_index := public.business_stage_index(p_to_stage);

  IF to_index IS NULL THEN
    RAISE EXCEPTION 'unknown business stage %', p_to_stage USING ERRCODE = '22023';
  END IF;

  IF to_index = from_index THEN
    RAISE EXCEPTION 'product is already in stage %', p_to_stage USING ERRCODE = '22023';
  END IF;

  -- One step at a time. Skipping a stage would skip its gate.
  IF to_index > from_index + 1 THEN
    RAISE EXCEPTION 'move one stage at a time: % comes next',
      public.business_stage_at(from_index + 1) USING ERRCODE = '22023';
  END IF;

  IF to_index < from_index AND reason IS NULL THEN
    RAISE EXCEPTION 'reason required: moving a product backward' USING ERRCODE = '22023';
  END IF;

  IF reason IS NOT NULL AND char_length(reason) > 1000 THEN
    RAISE EXCEPTION 'reason too long' USING ERRCODE = '22023';
  END IF;

  IF to_index > from_index THEN
    IF prod.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'cannot move an archived product' USING ERRCODE = '22023';
    END IF;

    -- Gate 1: a named operator and a founder's go.
    IF p_to_stage = 'build' THEN
      IF prod.operator_name IS NULL THEN
        RAISE EXCEPTION 'operator required: Gate 1 needs a named operator'
          USING ERRCODE = '22023';
      END IF;

      SELECT id, decision INTO gate_id, gate_outcome
      FROM public.product_gate_decisions
      WHERE product_id = p_product_id AND gate = 1
      ORDER BY created_at DESC, id DESC
      LIMIT 1;

      IF gate_outcome IS DISTINCT FROM 'go' THEN
        RAISE EXCEPTION 'Gate 1 needs a go decision recorded by a founder'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    -- Gate 2: a founder's PMF go, with criteria and evidence.
    IF p_to_stage = 'company' THEN
      SELECT id, decision INTO gate_id, gate_outcome
      FROM public.product_gate_decisions
      WHERE product_id = p_product_id AND gate = 2
      ORDER BY created_at DESC, id DESC
      LIMIT 1;

      IF gate_outcome IS DISTINCT FROM 'go' THEN
        RAISE EXCEPTION 'Gate 2 needs a PMF go decision recorded by a founder'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  UPDATE public.products
  SET business_stage = p_to_stage
  WHERE id = p_product_id
  RETURNING * INTO prod;

  INSERT INTO public.business_stage_transitions (
    product_id, from_stage, to_stage, actor_id, reason, gate_decision_id
  ) VALUES (
    p_product_id, old_stage, p_to_stage, (SELECT auth.uid()), reason,
    CASE WHEN to_index > from_index THEN gate_id END
  );

  IF old_stage = 'concept' AND p_to_stage = 'build' THEN
    PERFORM public.start_development(p_product_id);
  END IF;

  RETURN prod;
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_business_stage(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- product_stage_checklist_items
-- ============================================================
-- Each stage carries its own checklist, seeded with defaults when a product is
-- created. Items are editable by whoever may manage the business track. The
-- defaults keep a key, so the UI can show them in the reader's language; an
-- item a person typed keeps its own text and has no key.

CREATE TABLE public.product_stage_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('idea', 'concept', 'build', 'venture', 'company', 'board')),
  label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 200),
  default_key TEXT CHECK (default_key IS NULL OR char_length(default_key) <= 60),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  done BOOLEAN NOT NULL DEFAULT false,
  done_at TIMESTAMPTZ,
  done_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT checklist_done_complete CHECK (done = (done_at IS NOT NULL)),
  CONSTRAINT checklist_done_by_complete CHECK (num_nonnulls(done_at, done_by) IN (0, 2))
);

CREATE INDEX product_stage_checklist_items_product_idx
ON public.product_stage_checklist_items (product_id, stage, position);

CREATE OR REPLACE FUNCTION public.business_checklist_defaults()
RETURNS TABLE (stage TEXT, label TEXT, default_key TEXT, sort_order INTEGER)
LANGUAGE sql
IMMUTABLE
AS $$
  VALUES
    ('idea',    'Problem statement',           'problem_statement',       0),
    ('idea',    'Source of the idea',          'source',                  1),
    ('idea',    'First-screen decision',       'first_screen_decision',   2),
    ('concept', 'Problem validated',           'problem_validated',       0),
    ('concept', 'Business case',               'business_case',           1),
    ('concept', 'Operator identified',         'operator_identified',     2),
    ('concept', 'Ownership agreed',            'ownership_agreed',        3),
    ('build',   'Go-to-market plan',           'gtm_plan',                0),
    ('build',   'Pricing',                     'pricing',                 1),
    ('build',   'First customer target',       'first_customer_target',   2),
    ('build',   'Contracts template',          'contracts_template',      3),
    ('venture', 'First customers',             'first_customers',         0),
    ('venture', 'Revenue tracking',            'revenue_tracking',        1),
    ('venture', 'PMF criteria defined',        'pmf_criteria_defined',    2),
    ('company', 'Own team plan',               'own_team_plan',           0),
    ('company', 'Own P&L',                     'own_pnl',                 1),
    ('company', 'Bench exit plan',             'bench_exit_plan',         2),
    ('board',   'Board seat recorded',         'board_seat_recorded',     0),
    ('board',   'Reporting cadence',           'reporting_cadence',       1);
$$;

ALTER TABLE public.product_stage_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read checklist items"
ON public.product_stage_checklist_items FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "business managers add checklist items"
ON public.product_stage_checklist_items FOR INSERT TO authenticated
WITH CHECK (public.can_manage_business(product_id));

CREATE POLICY "business managers edit checklist items"
ON public.product_stage_checklist_items FOR UPDATE TO authenticated
USING (public.can_manage_business(product_id))
WITH CHECK (public.can_manage_business(product_id));

CREATE POLICY "business managers remove checklist items"
ON public.product_stage_checklist_items FOR DELETE TO authenticated
USING (public.can_manage_business(product_id));

-- done_at and done_by are server-maintained by the trigger below, so a client
-- can tick an item but cannot forge who ticked it or when.
REVOKE ALL ON public.product_stage_checklist_items FROM anon, authenticated;
GRANT SELECT ON public.product_stage_checklist_items TO authenticated;
GRANT INSERT (product_id, stage, label, default_key, position)
ON public.product_stage_checklist_items TO authenticated;
GRANT UPDATE (label, position, done) ON public.product_stage_checklist_items TO authenticated;
GRANT DELETE ON public.product_stage_checklist_items TO authenticated;

CREATE OR REPLACE FUNCTION public.checklist_items_maintain_done()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.done := false;
    NEW.done_at := NULL;
    NEW.done_by := NULL;
    RETURN NEW;
  END IF;

  IF NEW.done AND NOT OLD.done THEN
    NEW.done_at := now();
    NEW.done_by := (SELECT auth.uid());
  ELSIF NOT NEW.done AND OLD.done THEN
    NEW.done_at := NULL;
    NEW.done_by := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER product_stage_checklist_items_done
BEFORE INSERT OR UPDATE ON public.product_stage_checklist_items
FOR EACH ROW EXECUTE FUNCTION public.checklist_items_maintain_done();

-- Every new product gets the defaults for all six stages. It runs as the
-- definer because the new row's owner may not yet be readable under RLS.
CREATE OR REPLACE FUNCTION public.products_seed_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO public.product_stage_checklist_items (
    product_id, stage, label, default_key, position
  )
  SELECT NEW.id, d.stage, d.label, d.default_key, d.sort_order
  FROM public.business_checklist_defaults() d;
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_seed_checklist
AFTER INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.products_seed_checklist();

-- Backfill: every product that already exists gets its checklists now.
INSERT INTO public.product_stage_checklist_items (
  product_id, stage, label, default_key, position
)
SELECT p.id, d.stage, d.label, d.default_key, d.sort_order
FROM public.products p
CROSS JOIN public.business_checklist_defaults() d;
