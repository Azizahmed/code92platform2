-- Shared fixtures for tests/sql/*.test.sql. Runs as superuser before each
-- test file, in that test's own fresh database.
--
-- Users:
--   admin  00000000-0000-4000-8000-00000000000a  active admin
--   alice  00000000-0000-4000-8000-0000000000a1  active member
--   bob    00000000-0000-4000-8000-0000000000b0  active member
--   eve    00000000-0000-4000-8000-0000000000e0  inactive (pending approval)
-- Products:
--   jadawel 10000000-0000-4000-8000-000000000001  owned by alice, review overdue
--   cliko   10000000-0000-4000-8000-000000000002  owned by bob

CREATE SCHEMA test;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'admin@code92.test'),
  ('00000000-0000-4000-8000-0000000000a1', 'alice@code92.test'),
  ('00000000-0000-4000-8000-0000000000b0', 'bob@code92.test'),
  ('00000000-0000-4000-8000-0000000000e0', 'eve@code92.test');

INSERT INTO public.team_members (user_id, display_name, role, is_active) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Admin', 'admin', true),
  ('00000000-0000-4000-8000-0000000000a1', 'Alice', 'member', true),
  ('00000000-0000-4000-8000-0000000000b0', 'Bob', 'member', true),
  ('00000000-0000-4000-8000-0000000000e0', 'Eve', 'member', false);

INSERT INTO public.products (id, name, slug, owner_id, next_review_at) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Jadawel', 'jadawel',
   '00000000-0000-4000-8000-0000000000a1', now() - interval '3 days'),
  ('10000000-0000-4000-8000-000000000002', 'Cliko', 'cliko',
   '00000000-0000-4000-8000-0000000000b0', now() + interval '10 days');

-- Act as a user, the way PostgREST does for a request with that JWT.
CREATE FUNCTION test.as_user(who TEXT) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  uid TEXT := CASE who
    WHEN 'admin' THEN '00000000-0000-4000-8000-00000000000a'
    WHEN 'alice' THEN '00000000-0000-4000-8000-0000000000a1'
    WHEN 'bob'   THEN '00000000-0000-4000-8000-0000000000b0'
    WHEN 'eve'   THEN '00000000-0000-4000-8000-0000000000e0'
  END;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', uid, false);
  EXECUTE 'SET ROLE authenticated';
END;
$$;

CREATE FUNCTION test.as_superuser() RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', false);
END;
$$;

CREATE FUNCTION test.uid(who TEXT) RETURNS UUID
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE who
    WHEN 'admin' THEN '00000000-0000-4000-8000-00000000000a'
    WHEN 'alice' THEN '00000000-0000-4000-8000-0000000000a1'
    WHEN 'bob'   THEN '00000000-0000-4000-8000-0000000000b0'
    WHEN 'eve'   THEN '00000000-0000-4000-8000-0000000000e0'
  END::uuid
$$;

CREATE FUNCTION test.assert(cond BOOLEAN, msg TEXT) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF cond IS NOT TRUE THEN
    RAISE EXCEPTION 'assertion failed: %', msg;
  END IF;
END;
$$;

CREATE FUNCTION test.assert_eq(actual ANYELEMENT, expected ANYELEMENT, msg TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'assertion failed: % (expected %, got %)', msg, expected, actual;
  END IF;
END;
$$;

-- Runs sql and asserts it raises an error whose message contains expected.
CREATE FUNCTION test.assert_raises(sql TEXT, expected TEXT, msg TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF expected IS NULL OR position(lower(expected) IN lower(SQLERRM)) > 0 THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'assertion failed: % (raised "%" instead of "%")', msg, SQLERRM, expected;
  END;
  RAISE EXCEPTION 'assertion failed: % (no error raised)', msg;
END;
$$;

GRANT USAGE ON SCHEMA test TO authenticated, project_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA test TO authenticated, project_admin;
