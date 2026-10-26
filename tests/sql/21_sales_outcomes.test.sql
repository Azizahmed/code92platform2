-- Win outcomes, contacts, stale flag, activity log, archive guard.

SELECT test.as_user('alice');

INSERT INTO public.accounts (id, name, owner_id, sector) VALUES
  ('30000000-0000-4000-8000-000000000001', 'Acme', test.uid('alice'), 'Retail'),
  ('30000000-0000-4000-8000-000000000002', 'Globex', test.uid('bob'), 'Gov');

-- Product deal won → account becomes customer of the product (idempotent).
INSERT INTO public.deals (id, account_id, name, type, product_id, owner_id, stage)
VALUES
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   'Jadawel license', 'product', '10000000-0000-4000-8000-000000000001', test.uid('alice'), 'negotiation'),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
   'Jadawel expansion', 'product', '10000000-0000-4000-8000-000000000001', test.uid('alice'), 'proposal');

SELECT public.move_deal_stage('40000000-0000-4000-8000-000000000001', 'closed_won');
SELECT public.move_deal_stage('40000000-0000-4000-8000-000000000002', 'closed_won');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.account_products
   WHERE account_id = '30000000-0000-4000-8000-000000000001'
     AND product_id = '10000000-0000-4000-8000-000000000001'),
  1::bigint, 'product win records customer-of once');
SELECT test.assert_eq(
  (SELECT customer_of_count FROM public.account_overview WHERE id = '30000000-0000-4000-8000-000000000001'),
  1, 'account overview counts products');

-- Consultation deal won → engagement with ownership.
INSERT INTO public.deals (id, account_id, name, type, owner_id, stage)
VALUES ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002',
        'Data platform build', 'consultation', test.uid('bob'), 'negotiation');
SELECT test.assert_raises(
  $$SELECT public.move_deal_stage('40000000-0000-4000-8000-000000000003', 'closed_won', NULL, 'nobody')$$,
  'ownership required', 'invalid ownership rejected');
SELECT public.move_deal_stage('40000000-0000-4000-8000-000000000003', 'closed_won', NULL, 'code92_full');
SELECT test.assert(
  (SELECT ownership = 'code92_full' AND name = 'Data platform build'
     AND account_id = '30000000-0000-4000-8000-000000000002'
   FROM public.engagements WHERE deal_id = '40000000-0000-4000-8000-000000000003'),
  'consultation win opens an engagement');

-- Reopen and re-win keeps one engagement, updates ownership.
SELECT public.move_deal_stage('40000000-0000-4000-8000-000000000003', 'negotiation', 'scope change');
SELECT public.move_deal_stage('40000000-0000-4000-8000-000000000003', 'closed_won', NULL, 'client');
SELECT test.assert_eq(
  (SELECT count(*) FROM public.engagements WHERE deal_id = '40000000-0000-4000-8000-000000000003'),
  1::bigint, 'one engagement per deal');
SELECT test.assert_eq(
  (SELECT ownership FROM public.engagements WHERE deal_id = '40000000-0000-4000-8000-000000000003'),
  'client', 're-win updates ownership');

-- Users cannot write outcomes directly.
SELECT test.assert_raises(
  $$INSERT INTO public.account_products (account_id, product_id)
    VALUES ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002')$$,
  'permission denied', 'customer-of is RPC-only');

-- Contacts: first is primary; marking another primary demotes the first.
INSERT INTO public.contacts (id, account_id, name) VALUES
  ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Sara'),
  ('50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'Omar');
SELECT test.assert(
  (SELECT is_primary FROM public.contacts WHERE id = '50000000-0000-4000-8000-000000000001'),
  'first contact is primary');
UPDATE public.contacts SET is_primary = true WHERE id = '50000000-0000-4000-8000-000000000002';
SELECT test.assert_eq(
  (SELECT count(*) FROM public.contacts
   WHERE account_id = '30000000-0000-4000-8000-000000000001' AND is_primary),
  1::bigint, 'exactly one primary contact');
SELECT test.assert(
  (SELECT is_primary FROM public.contacts WHERE id = '50000000-0000-4000-8000-000000000002'),
  'new primary took over');

-- Involved contacts must belong to the deal's account.
INSERT INTO public.contacts (id, account_id, name)
VALUES ('50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', 'Lina');
INSERT INTO public.deal_contacts (deal_id, contact_id)
VALUES ('40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001');
SELECT test.assert_raises(
  $$INSERT INTO public.deal_contacts (deal_id, contact_id)
    VALUES ('40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003')$$,
  'belong to the deal', 'cross-account contact rejected');

-- Stale flag.
INSERT INTO public.deals (id, account_id, name, type, owner_id, next_action, next_action_date)
VALUES
  ('40000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000001',
   'Fresh', 'consultation', test.uid('alice'), 'Call', public.business_today() + 1),
  ('40000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000001',
   'Past date', 'consultation', test.uid('alice'), 'Call', public.business_today() - 8),
  ('40000000-0000-4000-8000-000000000012', '30000000-0000-4000-8000-000000000001',
   'Recently past', 'consultation', test.uid('alice'), 'Call', public.business_today() - 3),
  ('40000000-0000-4000-8000-000000000013', '30000000-0000-4000-8000-000000000001',
   'No action', 'consultation', test.uid('alice'), NULL, NULL);

SELECT test.as_superuser();
-- Simulate the "no next action" state having started 8 days ago.
ALTER TABLE public.deals DISABLE TRIGGER deals_before_write;
UPDATE public.deals SET next_action_updated_at = now() - interval '8 days'
WHERE id = '40000000-0000-4000-8000-000000000013';
ALTER TABLE public.deals ENABLE TRIGGER deals_before_write;
SELECT test.as_user('alice');

SELECT test.assert_eq((SELECT is_stale FROM public.deal_overview WHERE id = '40000000-0000-4000-8000-000000000010'), false, 'future action not stale');
SELECT test.assert_eq((SELECT is_stale FROM public.deal_overview WHERE id = '40000000-0000-4000-8000-000000000011'), true, 'action 8 days past is stale');
SELECT test.assert_eq((SELECT is_stale FROM public.deal_overview WHERE id = '40000000-0000-4000-8000-000000000012'), false, 'action 3 days past not yet stale');
SELECT test.assert_eq((SELECT is_stale FROM public.deal_overview WHERE id = '40000000-0000-4000-8000-000000000013'), true, 'no action for 8 days is stale');

-- Setting a next action resets the clock.
UPDATE public.deals SET next_action = 'Send proposal', next_action_date = public.business_today() + 2
WHERE id = '40000000-0000-4000-8000-000000000013';
SELECT test.assert_eq((SELECT is_stale FROM public.deal_overview WHERE id = '40000000-0000-4000-8000-000000000013'), false, 'setting next action clears stale');
SELECT test.assert(
  EXISTS (SELECT 1 FROM public.deal_activities
          WHERE deal_id = '40000000-0000-4000-8000-000000000013'
            AND kind = 'field_change' AND meta->>'field' = 'next_action'),
  'field change logged');

-- Closed deals are never stale.
SELECT public.move_deal_stage('40000000-0000-4000-8000-000000000011', 'closed_lost', 'went quiet');
SELECT test.assert_eq((SELECT is_stale FROM public.deal_overview WHERE id = '40000000-0000-4000-8000-000000000011'), false, 'closed deal not stale');

-- Notes: members may add notes only.
INSERT INTO public.deal_activities (deal_id, actor_id, kind, body)
VALUES ('40000000-0000-4000-8000-000000000010', test.uid('alice'), 'note', 'Met the CFO');
SELECT test.assert_raises(
  $$INSERT INTO public.deal_activities (deal_id, actor_id, kind, body)
    VALUES ('40000000-0000-4000-8000-000000000010', test.uid('alice'), 'stage_change', 'fake')$$,
  'row-level security', 'members cannot forge stage changes');
SELECT test.assert_raises(
  $$DELETE FROM public.deal_activities$$, 'permission denied', 'activity log is append-only');

-- Archive guard: bob cannot archive alice's account; alice can.
SELECT test.as_user('bob');
SELECT test.assert_raises(
  $$UPDATE public.accounts SET archived_at = now() WHERE id = '30000000-0000-4000-8000-000000000001'$$,
  'owner or an admin', 'non-owner cannot archive');
SELECT test.as_user('alice');
UPDATE public.accounts SET archived_at = now() WHERE id = '30000000-0000-4000-8000-000000000001';

-- Inactive members see nothing.
SELECT test.as_user('eve');
SELECT test.assert_eq((SELECT count(*) FROM public.deal_overview), 0::bigint, 'inactive sees no deals');
SELECT test.assert_eq((SELECT count(*) FROM public.accounts), 0::bigint, 'inactive sees no accounts');
