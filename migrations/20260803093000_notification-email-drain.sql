-- What the notify-email drain needs from the database.
--
-- Split from the notifications migration because both changes exist purely to
-- serve the edge function, and neither was obvious until it was written.

-- ============================================================
-- 'sending' — the claim state
-- ============================================================
-- The drain claims a row before it sends, so two overlapping drains cannot both
-- mail the same notification. That claim needs a state of its own: leaving the
-- row 'pending' while in flight is exactly the race being avoided, and moving
-- it straight to 'sent' would lie for as long as the send takes.
--
-- A row stuck in 'sending' means the function died mid-flight. That is visible
-- rather than silent, and deliberately does not auto-retry: a crash after SES
-- accepted the message would otherwise send it twice.

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_email_state_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_email_state_check
  CHECK (email_state IN ('skipped', 'pending', 'sending', 'sent', 'failed'));

-- ============================================================
-- notification_email_targets
-- ============================================================
-- Addresses live in auth.users, which no client role can read — and should not
-- be able to: one member's email is not another member's business, and the app
-- deliberately has no path to it.
--
-- This is that path, for one caller only. SECURITY DEFINER, restricted to
-- project_admin (the edge function's admin client), and narrowed further by
-- only answering for users who have a notification actually waiting to be
-- emailed. Handing it a list of ids it has no queued work for returns nothing,
-- so it cannot be used as a directory lookup even by something holding the API
-- key.

CREATE OR REPLACE FUNCTION public.notification_email_targets(p_user_ids UUID[])
RETURNS TABLE (user_id UUID, email TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT DISTINCT u.id, u.email
  FROM auth.users u
  WHERE u.id = ANY (p_user_ids)
    AND u.email IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = u.id
        AND n.email_state IN ('pending', 'sending')
    );
$$;

REVOKE ALL ON FUNCTION public.notification_email_targets(UUID[])
FROM PUBLIC, anon, authenticated;
