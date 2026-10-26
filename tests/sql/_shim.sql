-- Minimal stand-in for the InsForge-managed objects our migrations reference,
-- so migrations/ can be replayed and tested against a throwaway local
-- Postgres. Never applied to a real InsForge project.
--
-- Identity is simulated the way PostgREST does it: tests run
--   SET ROLE authenticated;
--   SELECT set_config('request.jwt.claim.sub', '<uuid>', false);
-- and auth.uid() reads that setting back.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE project_admin NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE SCHEMA system;

CREATE TABLE auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT
);

CREATE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE FUNCTION system.update_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

GRANT USAGE ON SCHEMA auth, system TO anon, authenticated, project_admin;
GRANT SELECT, REFERENCES ON auth.users TO project_admin;
GRANT USAGE, CREATE ON SCHEMA public TO project_admin;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- InsForge grants runtime roles broad default DML on public tables and lets
-- RLS decide; mirror that so REVOKEs in migrations behave as in production.
ALTER DEFAULT PRIVILEGES FOR ROLE project_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
