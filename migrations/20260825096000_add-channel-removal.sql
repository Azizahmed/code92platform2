-- Removing a channel.
--
-- The original migration says it plainly: "No DELETE anywhere: archiving is the
-- only way a channel leaves the list, so a conversation cannot be destroyed
-- along with whatever it recorded." That invariant is kept — there is still no
-- DELETE grant on public.channels for any client role. What is added is one
-- SECURITY DEFINER function that decides, per channel, which of the two things
-- to do:
--
--   * no messages, and nothing under it survived  ->  the row is deleted
--   * otherwise                                   ->  the row is archived
--
-- The empty case is the one people actually need: a channel created with a typo,
-- or a test room. Deleting it destroys nothing because there is nothing in it.
-- The moment a channel holds a single message it holds a record — messages,
-- agent_proposals and notifications all cascade from it — so it is archived
-- instead and everything stays attributable.
--
-- The subtree is processed bottom-up, and a parent is only deletable when every
-- descendant was deletable too. Without that rule, deleting an empty parent
-- would cascade away a child that had just been archived precisely because it
-- had messages worth keeping.

-- The recursive worker. NOT callable by clients: EXECUTE defaults to PUBLIC for
-- new functions, and leaving it there would expose an unchecked delete that
-- skips every permission test in remove_channel() below.
CREATE OR REPLACE FUNCTION public.remove_channel_node(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  child RECORD;
  subtree_fully_removed BOOLEAN := true;
  has_messages BOOLEAN;
BEGIN
  FOR child IN SELECT id FROM public.channels WHERE parent_id = p_id LOOP
    IF NOT public.remove_channel_node(child.id) THEN
      subtree_fully_removed := false;
    END IF;
  END LOOP;

  SELECT EXISTS (SELECT 1 FROM public.messages WHERE channel_id = p_id)
    INTO has_messages;

  IF has_messages OR NOT subtree_fully_removed THEN
    UPDATE public.channels
    SET archived_at = coalesce(archived_at, now())
    WHERE id = p_id;
    RETURN false;
  END IF;

  DELETE FROM public.channels WHERE id = p_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_channel_node(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_channel_node(UUID) FROM anon, authenticated;

-- The entry point. SECURITY DEFINER bypasses RLS, so every permission the
-- policies would have applied is re-stated here by hand — the same discipline
-- decide_agent_proposal() follows, and for the same reason.
CREATE OR REPLACE FUNCTION public.remove_channel(p_channel_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  ch public.channels;
  was_deleted BOOLEAN;
BEGIN
  SELECT * INTO ch FROM public.channels WHERE id = p_channel_id;
  IF ch.id IS NULL THEN
    RAISE EXCEPTION 'channel not found';
  END IF;

  IF NOT public.is_active_member() THEN
    RAISE EXCEPTION 'only active members can remove channels';
  END IF;

  -- Mirrors the "creator or admin updates channels" policy: removing a channel
  -- is governed by the same rule as renaming one.
  IF NOT (public.is_admin() OR ch.created_by = auth.uid()) THEN
    RAISE EXCEPTION 'only the channel creator or an admin can remove a channel';
  END IF;

  -- A product's own room is created and maintained by products_sync_channel().
  -- Removing it would leave that trigger tending a channel that no longer
  -- exists, and the product with no room at all. It closes when the product is
  -- archived, which is the honest way for it to go.
  IF ch.is_primary THEN
    RAISE EXCEPTION 'the product primary channel cannot be removed on its own';
  END IF;

  was_deleted := public.remove_channel_node(p_channel_id);

  RETURN jsonb_build_object('deleted', was_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_channel(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_channel(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.remove_channel(UUID) TO authenticated;
