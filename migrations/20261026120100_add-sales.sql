-- Release 0.2 — Sales: one B2B pipeline for product and consultation deals.
--
-- New tables only; nothing existing changes. Notifications for these records
-- are wired in the next migration, on the existing notifications table.
--
-- accounts ─┬─ contacts (one primary)
--           ├─ deals ─┬─ deal_contacts (subset of the account's contacts)
--           │         ├─ deal_activities (append-only log)
--           │         └─ deal_watchers
--           ├─ account_products (customer-of, written by a Closed Won product deal)
--           ├─ engagements (written by a Closed Won consultation deal)
--           └─ account_watchers
--
-- Access model matches product_tasks: the team is small and sells together,
-- so every active member can read and edit sales records; the actor of every
-- change is logged. Two things are tighter:
--   * deals.stage / closed_at / close_reason have no UPDATE grant. Stage moves
--     go through move_deal_stage(), which enforces the reason rules, writes
--     the transition log and records win outcomes in one transaction.
--   * account archive/unarchive is limited to the account owner or an admin.

-- ============================================================
-- Business calendar
-- ============================================================

-- The team works in Kuwait time. "Today" for due dates, stale flags and the
-- daily notification run is the Kuwait calendar day, not the UTC one the
-- database session uses.
CREATE OR REPLACE FUNCTION public.business_today()
RETURNS DATE
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT (now() AT TIME ZONE 'Asia/Kuwait')::date $$;

GRANT EXECUTE ON FUNCTION public.business_today() TO authenticated;

-- ============================================================
-- Stage ordering
-- ============================================================

CREATE OR REPLACE FUNCTION public.deal_stage_rank(stage TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE stage
    WHEN 'lead' THEN 1
    WHEN 'meeting' THEN 2
    WHEN 'discovery_demo' THEN 3
    WHEN 'proposal' THEN 4
    WHEN 'negotiation' THEN 5
    WHEN 'closed_won' THEN 6
    WHEN 'closed_lost' THEN 6
  END;
$$;

-- ============================================================
-- accounts
-- ============================================================

CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  sector TEXT CHECK (sector IS NULL OR char_length(sector) <= 100),
  city TEXT CHECK (city IS NULL OR char_length(city) <= 100),
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 5000),
  archived_at TIMESTAMPTZ,
  created_by UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX accounts_owner_id_idx ON public.accounts (owner_id);
CREATE INDEX accounts_name_idx ON public.accounts (lower(name));

CREATE TRIGGER accounts_updated_at
BEFORE UPDATE ON public.accounts
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

CREATE OR REPLACE FUNCTION public.accounts_guard_archive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at
     AND OLD.owner_id IS DISTINCT FROM (SELECT auth.uid())
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'only the account owner or an admin can archive an account';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_guard_archive
BEFORE UPDATE ON public.accounts
FOR EACH ROW EXECUTE FUNCTION public.accounts_guard_archive();

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read accounts"
ON public.accounts FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "active members create accounts"
ON public.accounts FOR INSERT TO authenticated
WITH CHECK (public.is_active_member() AND created_by = (SELECT auth.uid()));

CREATE POLICY "active members update accounts"
ON public.accounts FOR UPDATE TO authenticated
USING (public.is_active_member())
WITH CHECK (public.is_active_member());

REVOKE ALL ON public.accounts FROM anon, authenticated;
GRANT SELECT, INSERT ON public.accounts TO authenticated;
GRANT UPDATE (name, sector, city, owner_id, notes, archived_at)
ON public.accounts TO authenticated;

-- ============================================================
-- contacts
-- ============================================================

CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  title TEXT CHECK (title IS NULL OR char_length(title) <= 200),
  email TEXT CHECK (email IS NULL OR (char_length(email) <= 320 AND email LIKE '%_@_%')),
  phone TEXT CHECK (phone IS NULL OR char_length(phone) <= 50),
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 5000),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX contacts_account_id_idx ON public.contacts (account_id, name);
CREATE UNIQUE INDEX contacts_one_primary_per_account
ON public.contacts (account_id) WHERE is_primary;

CREATE TRIGGER contacts_updated_at
BEFORE UPDATE ON public.contacts
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- Marking a contact primary demotes the previous primary; the first contact
-- on an account becomes primary automatically.
CREATE OR REPLACE FUNCTION public.contacts_maintain_primary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'a contact cannot move to another account';
  END IF;

  IF TG_OP = 'INSERT' AND NOT NEW.is_primary AND NOT EXISTS (
    SELECT 1 FROM public.contacts WHERE account_id = NEW.account_id
  ) THEN
    NEW.is_primary := true;
  END IF;

  IF NEW.is_primary THEN
    UPDATE public.contacts
    SET is_primary = false
    WHERE account_id = NEW.account_id AND is_primary AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contacts_maintain_primary
BEFORE INSERT OR UPDATE OF is_primary, account_id ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.contacts_maintain_primary();

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read contacts"
ON public.contacts FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "active members create contacts"
ON public.contacts FOR INSERT TO authenticated
WITH CHECK (public.is_active_member() AND created_by = (SELECT auth.uid()));

CREATE POLICY "active members update contacts"
ON public.contacts FOR UPDATE TO authenticated
USING (public.is_active_member())
WITH CHECK (public.is_active_member());

CREATE POLICY "active members delete contacts"
ON public.contacts FOR DELETE TO authenticated
USING (public.is_active_member());

REVOKE ALL ON public.contacts FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.contacts TO authenticated;
GRANT UPDATE (name, title, email, phone, notes, is_primary)
ON public.contacts TO authenticated;

-- ============================================================
-- deals
-- ============================================================

CREATE TABLE public.deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  type TEXT NOT NULL CHECK (type IN ('product', 'consultation')),
  product_id UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  stage TEXT NOT NULL DEFAULT 'lead' CHECK (stage IN (
    'lead', 'meeting', 'discovery_demo', 'proposal', 'negotiation',
    'closed_won', 'closed_lost'
  )),
  value_amount NUMERIC(14, 3) CHECK (value_amount IS NULL OR value_amount >= 0),
  -- KWD has three minor digits, hence NUMERIC(14,3).
  currency TEXT NOT NULL DEFAULT 'KWD' CHECK (currency ~ '^[A-Z]{3}$'),
  expected_close DATE,
  next_action TEXT CHECK (next_action IS NULL OR char_length(next_action) BETWEEN 1 AND 500),
  next_action_date DATE,
  -- When next_action/next_action_date last changed; "no next action for 7+
  -- days" needs a start time to measure from. Trigger-maintained.
  next_action_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT CHECK (source IS NULL OR source IN (
    'referral', 'inbound', 'outbound', 'operator_introduced'
  )),
  stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  close_reason TEXT CHECK (close_reason IS NULL OR char_length(close_reason) <= 1000),
  created_by UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deals_product_type_requires_product
    CHECK (type <> 'product' OR product_id IS NOT NULL)
);

CREATE INDEX deals_owner_stage_idx ON public.deals (owner_id, stage);
CREATE INDEX deals_stage_close_idx ON public.deals (stage, expected_close);
CREATE INDEX deals_account_id_idx ON public.deals (account_id, created_at DESC);
CREATE INDEX deals_product_id_idx ON public.deals (product_id) WHERE product_id IS NOT NULL;
CREATE INDEX deals_next_action_date_idx ON public.deals (next_action_date)
WHERE stage NOT IN ('closed_won', 'closed_lost');

CREATE TRIGGER deals_updated_at
BEFORE UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

CREATE OR REPLACE FUNCTION public.deals_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW.next_action := nullif(btrim(NEW.next_action), '');

  IF TG_OP = 'INSERT' THEN
    -- Deals may be entered at any open stage (seeding live deals), but
    -- closing always goes through move_deal_stage().
    IF NEW.stage IN ('closed_won', 'closed_lost') THEN
      RAISE EXCEPTION 'deals cannot be created closed; create open and move the stage';
    END IF;
    NEW.next_action_updated_at := now();
    NEW.stage_changed_at := now();
    NEW.closed_at := NULL;
    NEW.close_reason := NULL;
  ELSE
    IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
      RAISE EXCEPTION 'a deal cannot move to another account';
    END IF;
    IF NEW.next_action IS DISTINCT FROM OLD.next_action
       OR NEW.next_action_date IS DISTINCT FROM OLD.next_action_date THEN
      NEW.next_action_updated_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER deals_before_write
BEFORE INSERT OR UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.deals_before_write();

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read deals"
ON public.deals FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "active members create deals"
ON public.deals FOR INSERT TO authenticated
WITH CHECK (public.is_active_member() AND created_by = (SELECT auth.uid()));

CREATE POLICY "active members update deals"
ON public.deals FOR UPDATE TO authenticated
USING (public.is_active_member())
WITH CHECK (public.is_active_member());

REVOKE ALL ON public.deals FROM anon, authenticated;
GRANT SELECT, INSERT ON public.deals TO authenticated;
GRANT UPDATE (name, type, product_id, owner_id, value_amount, currency,
              expected_close, next_action, next_action_date, source)
ON public.deals TO authenticated;

-- ============================================================
-- deal_contacts: involved contacts, always from the deal's account
-- ============================================================

CREATE TABLE public.deal_contacts (
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, contact_id)
);

CREATE INDEX deal_contacts_contact_id_idx ON public.deal_contacts (contact_id);

CREATE OR REPLACE FUNCTION public.deal_contacts_same_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.deals d
    JOIN public.contacts c ON c.account_id = d.account_id
    WHERE d.id = NEW.deal_id AND c.id = NEW.contact_id
  ) THEN
    RAISE EXCEPTION 'involved contacts must belong to the deal''s account';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER deal_contacts_same_account
BEFORE INSERT ON public.deal_contacts
FOR EACH ROW EXECUTE FUNCTION public.deal_contacts_same_account();

ALTER TABLE public.deal_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read deal contacts"
ON public.deal_contacts FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "active members add deal contacts"
ON public.deal_contacts FOR INSERT TO authenticated
WITH CHECK (public.is_active_member());

CREATE POLICY "active members remove deal contacts"
ON public.deal_contacts FOR DELETE TO authenticated
USING (public.is_active_member());

REVOKE ALL ON public.deal_contacts FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.deal_contacts TO authenticated;

-- ============================================================
-- deal_activities: append-only log
-- ============================================================

CREATE TABLE public.deal_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('created', 'stage_change', 'field_change', 'note')),
  from_stage TEXT,
  to_stage TEXT,
  reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 1000),
  body TEXT CHECK (body IS NULL OR char_length(body) <= 5000),
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX deal_activities_deal_id_idx
ON public.deal_activities (deal_id, created_at DESC);

ALTER TABLE public.deal_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read deal activities"
ON public.deal_activities FOR SELECT TO authenticated
USING (public.is_active_member());

-- Members add notes only; every other kind is written by triggers/RPCs.
CREATE POLICY "active members add deal notes"
ON public.deal_activities FOR INSERT TO authenticated
WITH CHECK (
  public.is_active_member()
  AND actor_id = (SELECT auth.uid())
  AND kind = 'note'
  AND from_stage IS NULL AND to_stage IS NULL AND meta IS NULL
);

REVOKE ALL ON public.deal_activities FROM anon, authenticated;
GRANT SELECT ON public.deal_activities TO authenticated;
GRANT INSERT (deal_id, actor_id, kind, body) ON public.deal_activities TO authenticated;

-- Log creation and the field changes worth a line in the history.
CREATE OR REPLACE FUNCTION public.deals_log_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  field TEXT;
  old_value TEXT;
  new_value TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.deal_activities (deal_id, actor_id, kind, to_stage)
    VALUES (NEW.id, (SELECT auth.uid()), 'created', NEW.stage);
    RETURN NEW;
  END IF;

  FOREACH field IN ARRAY ARRAY['owner_id', 'value_amount', 'currency',
                               'expected_close', 'next_action', 'next_action_date']
  LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', field, field)
      INTO old_value, new_value USING OLD, NEW;
    IF old_value IS DISTINCT FROM new_value THEN
      INSERT INTO public.deal_activities (deal_id, actor_id, kind, meta)
      VALUES (NEW.id, (SELECT auth.uid()), 'field_change',
              jsonb_build_object('field', field, 'from', old_value, 'to', new_value));
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER deals_log_activity
AFTER INSERT OR UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.deals_log_activity();

-- ============================================================
-- Win outcomes
-- ============================================================

CREATE TABLE public.account_products (
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  won_deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  since TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, product_id)
);

CREATE INDEX account_products_product_id_idx ON public.account_products (product_id);

ALTER TABLE public.account_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read account products"
ON public.account_products FOR SELECT TO authenticated
USING (public.is_active_member());

REVOKE ALL ON public.account_products FROM anon, authenticated;
GRANT SELECT ON public.account_products TO authenticated;

CREATE TABLE public.engagements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  deal_id UUID UNIQUE REFERENCES public.deals(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  ownership TEXT NOT NULL CHECK (ownership IN ('client', 'code92_full', 'code92_partial')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX engagements_account_id_idx ON public.engagements (account_id, started_at DESC);

CREATE TRIGGER engagements_updated_at
BEFORE UPDATE ON public.engagements
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

ALTER TABLE public.engagements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read engagements"
ON public.engagements FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "active members update engagements"
ON public.engagements FOR UPDATE TO authenticated
USING (public.is_active_member())
WITH CHECK (public.is_active_member());

REVOKE ALL ON public.engagements FROM anon, authenticated;
GRANT SELECT ON public.engagements TO authenticated;
GRANT UPDATE (name, ownership, notes) ON public.engagements TO authenticated;

-- ============================================================
-- Watchers
-- ============================================================
-- Same shape and the same rule as task_watchers: watching is public within the
-- team, and you may only add or remove yourself. The owner is not a watcher —
-- owners are always told about their own records (see the notifications
-- migration) and cannot opt out of them.

CREATE TABLE public.account_watchers (
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id)
);

CREATE TABLE public.deal_watchers (
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, user_id)
);

CREATE INDEX account_watchers_user_id_idx ON public.account_watchers (user_id, created_at DESC);
CREATE INDEX deal_watchers_user_id_idx ON public.deal_watchers (user_id, created_at DESC);

ALTER TABLE public.account_watchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_watchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read account watchers"
ON public.account_watchers FOR SELECT TO authenticated
USING (public.is_active_member());
CREATE POLICY "watch an account yourself"
ON public.account_watchers FOR INSERT TO authenticated
WITH CHECK (public.is_active_member() AND user_id = (SELECT auth.uid()));
CREATE POLICY "unwatch an account yourself"
ON public.account_watchers FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY "active members read deal watchers"
ON public.deal_watchers FOR SELECT TO authenticated
USING (public.is_active_member());
CREATE POLICY "watch a deal yourself"
ON public.deal_watchers FOR INSERT TO authenticated
WITH CHECK (public.is_active_member() AND user_id = (SELECT auth.uid()));
CREATE POLICY "unwatch a deal yourself"
ON public.deal_watchers FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.account_watchers, public.deal_watchers FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.account_watchers, public.deal_watchers TO authenticated;

-- ============================================================
-- move_deal_stage: the only way to change a deal's stage
-- ============================================================

CREATE OR REPLACE FUNCTION public.move_deal_stage(
  p_deal_id UUID,
  p_to_stage TEXT,
  p_reason TEXT DEFAULT NULL,
  p_ownership TEXT DEFAULT NULL
)
RETURNS public.deals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  d public.deals;
  reason TEXT := nullif(btrim(p_reason), '');
  old_stage TEXT;
  from_closed BOOLEAN;
  is_backward BOOLEAN;
BEGIN
  IF NOT public.is_active_member() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF public.deal_stage_rank(p_to_stage) IS NULL THEN
    RAISE EXCEPTION 'unknown stage %', p_to_stage USING ERRCODE = '22023';
  END IF;

  SELECT * INTO d FROM public.deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deal not found' USING ERRCODE = 'P0002';
  END IF;

  IF d.stage = p_to_stage THEN
    RAISE EXCEPTION 'deal is already in stage %', p_to_stage USING ERRCODE = '22023';
  END IF;

  old_stage := d.stage;
  from_closed := d.stage IN ('closed_won', 'closed_lost');
  is_backward := from_closed
    OR public.deal_stage_rank(p_to_stage) < public.deal_stage_rank(d.stage);

  IF reason IS NOT NULL AND char_length(reason) > 1000 THEN
    RAISE EXCEPTION 'reason too long' USING ERRCODE = '22023';
  END IF;
  IF is_backward AND reason IS NULL THEN
    RAISE EXCEPTION 'reason required: moving a deal backward' USING ERRCODE = '22023';
  END IF;
  IF p_to_stage = 'closed_lost' AND reason IS NULL THEN
    RAISE EXCEPTION 'reason required: closing a deal as lost' USING ERRCODE = '22023';
  END IF;
  IF p_to_stage = 'closed_won' AND d.type = 'consultation'
     AND (p_ownership IS NULL
          OR p_ownership NOT IN ('client', 'code92_full', 'code92_partial')) THEN
    RAISE EXCEPTION 'ownership required: winning a consultation deal' USING ERRCODE = '22023';
  END IF;

  UPDATE public.deals
  SET stage = p_to_stage,
      stage_changed_at = now(),
      closed_at = CASE WHEN p_to_stage IN ('closed_won', 'closed_lost') THEN now() END,
      close_reason = CASE WHEN p_to_stage = 'closed_lost' THEN reason END
  WHERE id = d.id
  RETURNING * INTO d;

  INSERT INTO public.deal_activities (deal_id, actor_id, kind, from_stage, to_stage, reason)
  VALUES (d.id, (SELECT auth.uid()), 'stage_change',
          old_stage, p_to_stage, reason);

  IF p_to_stage = 'closed_won' THEN
    IF d.type = 'product' THEN
      INSERT INTO public.account_products (account_id, product_id, won_deal_id)
      VALUES (d.account_id, d.product_id, d.id)
      ON CONFLICT (account_id, product_id) DO NOTHING;
    ELSE
      -- Re-winning a reopened consultation deal keeps its one engagement.
      INSERT INTO public.engagements (account_id, deal_id, name, ownership)
      VALUES (d.account_id, d.id, d.name, p_ownership)
      ON CONFLICT (deal_id) DO UPDATE SET ownership = EXCLUDED.ownership;
    END IF;
  END IF;

  RETURN d;
END;
$$;

REVOKE ALL ON FUNCTION public.move_deal_stage(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_deal_stage(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================
-- Projections
-- ============================================================

-- Stale: an open deal with no next action for more than 7 days, or a
-- next-action date more than 7 days in the past.
CREATE OR REPLACE VIEW public.deal_overview
WITH (security_invoker = true)
AS
SELECT
  d.id,
  d.account_id,
  a.name AS account_name,
  d.name,
  d.type,
  d.product_id,
  p.name AS product_name,
  d.owner_id,
  tm.display_name AS owner_name,
  d.stage,
  d.value_amount,
  d.currency,
  d.expected_close,
  d.next_action,
  d.next_action_date,
  d.next_action_updated_at,
  d.source,
  d.stage_changed_at,
  d.closed_at,
  d.close_reason,
  d.created_at,
  d.updated_at,
  (d.stage NOT IN ('closed_won', 'closed_lost')) AS is_open,
  (
    d.stage NOT IN ('closed_won', 'closed_lost')
    AND (
      (d.next_action IS NULL AND d.next_action_updated_at < now() - interval '7 days')
      OR d.next_action_date < public.business_today() - 7
    )
  ) AS is_stale
FROM public.deals d
JOIN public.accounts a ON a.id = d.account_id
LEFT JOIN public.products p ON p.id = d.product_id
LEFT JOIN public.team_members tm ON tm.user_id = d.owner_id;

GRANT SELECT ON public.deal_overview TO authenticated;

CREATE OR REPLACE VIEW public.account_overview
WITH (security_invoker = true)
AS
SELECT
  a.id,
  a.name,
  a.sector,
  a.city,
  a.owner_id,
  tm.display_name AS owner_name,
  a.notes,
  a.archived_at,
  a.created_at,
  a.updated_at,
  COALESCE(ds.open_deals, 0) AS open_deals,
  COALESCE(ds.total_deals, 0) AS total_deals,
  COALESCE(ap.products, 0) AS customer_of_count
FROM public.accounts a
LEFT JOIN public.team_members tm ON tm.user_id = a.owner_id
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE d.stage NOT IN ('closed_won', 'closed_lost'))::int AS open_deals,
    count(*)::int AS total_deals
  FROM public.deals d
  WHERE d.account_id = a.id
) ds ON true
LEFT JOIN LATERAL (
  SELECT count(*)::int AS products
  FROM public.account_products x
  WHERE x.account_id = a.id
) ap ON true;

GRANT SELECT ON public.account_overview TO authenticated;
