-- Channels inside channels.
--
-- A flat list stops describing the work as soon as a room needs a room of its
-- own — a release inside a product, an incident inside a release. parent_id is
-- a plain adjacency list: the rail renders the tree, and nothing else in the
-- system needs to care that a channel has a parent.
--
-- Cycles are impossible here rather than merely prevented. parent_id is granted
-- on INSERT and NOT on UPDATE, so a channel's parent is fixed when it is created
-- and a row can only ever point at one that already existed. The self-reference
-- CHECK closes the one remaining case, a row naming itself.

ALTER TABLE public.channels
  ADD COLUMN parent_id UUID REFERENCES public.channels(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.channels.parent_id IS
  'The channel this one sits under. Fixed at creation: parent_id is insertable '
  'but not updatable, which is what makes a cycle unreachable.';

ALTER TABLE public.channels
  ADD CONSTRAINT channels_parent_not_self
  CHECK (parent_id IS DISTINCT FROM id);

-- The product's own room is the root of its product. Letting it be filed under
-- something else would leave the rename trigger maintaining a channel buried
-- somewhere unrelated.
ALTER TABLE public.channels
  ADD CONSTRAINT channels_primary_has_no_parent
  CHECK (NOT is_primary OR parent_id IS NULL);

CREATE INDEX channels_parent_id_idx ON public.channels (parent_id);

-- A subchannel belongs to whatever its parent belongs to.
--
-- This is a BEFORE trigger rather than a CHECK because the rule reads another
-- row. It runs before the RLS WITH CHECK is applied, so the existing insert
-- policies see the final, corrected row: a child of a product channel arrives as
-- kind='product' with the parent's product_id and is judged by the product
-- policy; a child of a standing channel arrives as kind='standing'.
--
-- Inheriting rather than validating is deliberate. The client sends a parent and
-- a name; it cannot get the binding wrong, and it cannot smuggle a channel into
-- a product it should not reach by naming a parent in another one.
CREATE OR REPLACE FUNCTION public.channels_inherit_from_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  parent public.channels;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO parent FROM public.channels WHERE id = NEW.parent_id;

  IF parent.id IS NULL THEN
    RAISE EXCEPTION 'parent channel not found';
  END IF;

  IF parent.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot add a channel under an archived channel';
  END IF;

  NEW.kind := parent.kind;
  NEW.product_id := parent.product_id;
  NEW.is_primary := false;

  RETURN NEW;
END;
$$;

CREATE TRIGGER channels_inherit_from_parent
BEFORE INSERT ON public.channels
FOR EACH ROW EXECUTE FUNCTION public.channels_inherit_from_parent();

-- Archiving a channel archives what sits under it: a subchannel of a closed room
-- is not a room anyone should still be posting in. Recursive by re-firing on
-- each child, which is bounded by the tree's depth.
CREATE OR REPLACE FUNCTION public.channels_archive_descendants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    UPDATE public.channels
    SET archived_at = NEW.archived_at
    WHERE parent_id = NEW.id
      AND archived_at IS DISTINCT FROM NEW.archived_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER channels_archive_descendants
AFTER UPDATE OF archived_at ON public.channels
FOR EACH ROW EXECUTE FUNCTION public.channels_archive_descendants();

-- parent_id is insertable only. See the header: this is what makes re-parenting,
-- and therefore cycles, impossible rather than merely discouraged.
GRANT INSERT (parent_id) ON public.channels TO authenticated;
