-- move_deal_stage: every from→to pair, for both deal types, with and without
-- a reason; win outcomes; logging; grants.

SELECT test.as_user('alice');

INSERT INTO public.accounts (id, name, owner_id)
VALUES ('30000000-0000-4000-8000-000000000001', 'Acme', test.uid('alice'));

-- Direct stage writes are not granted.
INSERT INTO public.deals (id, account_id, name, type, product_id, owner_id)
VALUES ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
        'Direct', 'product', '10000000-0000-4000-8000-000000000001', test.uid('alice'));
SELECT test.assert_raises(
  $$UPDATE public.deals SET stage = 'closed_won' WHERE id = '40000000-0000-4000-8000-000000000001'$$,
  'permission denied', 'stage is not directly updatable');
SELECT test.assert_raises(
  $$INSERT INTO public.deals (account_id, name, type, product_id, owner_id, stage)
    VALUES ('30000000-0000-4000-8000-000000000001', 'x', 'product',
            '10000000-0000-4000-8000-000000000001', test.uid('alice'), 'closed_won')$$,
  'cannot be created closed', 'deals cannot be inserted closed');
SELECT test.assert_raises(
  $$INSERT INTO public.deals (account_id, name, type, owner_id)
    VALUES ('30000000-0000-4000-8000-000000000001', 'x', 'product', test.uid('alice'))$$,
  'deals_product_type_requires_product', 'product deals need a product');

-- Exhaustive transition matrix.
DO $$
DECLARE
  stages TEXT[] := ARRAY['lead','meeting','discovery_demo','proposal','negotiation','closed_won','closed_lost'];
  f TEXT;
  t TEXT;
  typ TEXT;
  deal UUID;
  needs_reason BOOLEAN;
  needs_ownership BOOLEAN;
  ok BOOLEAN;
  checked INT := 0;
BEGIN
  FOREACH typ IN ARRAY ARRAY['product', 'consultation'] LOOP
    FOREACH f IN ARRAY stages LOOP
      FOREACH t IN ARRAY stages LOOP
        CONTINUE WHEN f = t;

        INSERT INTO public.deals (account_id, name, type, product_id, owner_id, stage)
        VALUES ('30000000-0000-4000-8000-000000000001', f || '->' || t, typ,
                CASE WHEN typ = 'product' THEN '10000000-0000-4000-8000-000000000001'::uuid END,
                test.uid('alice'),
                CASE WHEN f LIKE 'closed_%' THEN 'negotiation' ELSE f END)
        RETURNING id INTO deal;
        IF f LIKE 'closed_%' THEN
          PERFORM public.move_deal_stage(deal, f, 'setup', 'client');
        END IF;

        needs_reason := f LIKE 'closed_%'
          OR public.deal_stage_rank(t) < public.deal_stage_rank(f)
          OR t = 'closed_lost';
        needs_ownership := t = 'closed_won' AND typ = 'consultation';

        -- Without reason or ownership.
        BEGIN
          PERFORM public.move_deal_stage(deal, t, NULL, NULL);
          ok := true;
        EXCEPTION WHEN OTHERS THEN
          ok := false;
        END;
        IF ok = (needs_reason OR needs_ownership) THEN
          RAISE EXCEPTION 'matrix %: % -> % without reason: expected %, got %',
            typ, f, t, CASE WHEN needs_reason OR needs_ownership THEN 'error' ELSE 'ok' END,
            CASE WHEN ok THEN 'ok' ELSE 'error' END;
        END IF;

        -- With reason and ownership it must always succeed.
        IF NOT ok THEN
          PERFORM public.move_deal_stage(deal, t, '  reason  ', 'code92_partial');
        END IF;

        IF (SELECT stage FROM public.deals WHERE id = deal) <> t THEN
          RAISE EXCEPTION 'matrix %: % -> % did not land', typ, f, t;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM public.deal_activities
          WHERE deal_id = deal AND kind = 'stage_change'
            AND from_stage = f AND to_stage = t AND actor_id = test.uid('alice')
            AND (NOT needs_reason OR reason = 'reason')
        ) THEN
          RAISE EXCEPTION 'matrix %: % -> % not logged correctly', typ, f, t;
        END IF;
        checked := checked + 1;
      END LOOP;
    END LOOP;
  END LOOP;
  IF checked <> 84 THEN
    RAISE EXCEPTION 'expected 84 transitions checked, got %', checked;
  END IF;
END;
$$;

-- Same-stage move is rejected.
SELECT test.assert_raises(
  $$SELECT public.move_deal_stage('40000000-0000-4000-8000-000000000001', 'lead')$$,
  'already in stage', 'same-stage move rejected');
SELECT test.assert_raises(
  $$SELECT public.move_deal_stage('40000000-0000-4000-8000-000000000001', 'bogus')$$,
  'unknown stage', 'unknown stage rejected');

-- Closed fields.
SELECT public.move_deal_stage('40000000-0000-4000-8000-000000000001', 'closed_lost', 'budget cut');
SELECT test.assert(
  (SELECT closed_at IS NOT NULL AND close_reason = 'budget cut'
   FROM public.deals WHERE id = '40000000-0000-4000-8000-000000000001'),
  'closed lost records closed_at and reason');
SELECT public.move_deal_stage('40000000-0000-4000-8000-000000000001', 'proposal', 'revived');
SELECT test.assert(
  (SELECT closed_at IS NULL AND close_reason IS NULL
   FROM public.deals WHERE id = '40000000-0000-4000-8000-000000000001'),
  'reopening clears closed fields');

-- Inactive members cannot move stages.
SELECT test.as_user('eve');
SELECT test.assert_raises(
  $$SELECT public.move_deal_stage('40000000-0000-4000-8000-000000000001', 'negotiation')$$,
  'forbidden', 'inactive member cannot move a deal');
