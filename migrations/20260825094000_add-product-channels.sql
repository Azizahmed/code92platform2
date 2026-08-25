-- More than one channel per product.
--
-- The original design bound exactly one channel to each product (product_id
-- UNIQUE) so that "the room" and "the record" were the same thing. That still
-- holds for the auto-created channel, which follows the product's name and
-- archive state. What it did not allow was a second room for the same product —
-- a release war-room, a design thread — without inventing a standing channel
-- whose connection to the product lives only in its name.
--
-- So: the auto-created channel becomes is_primary, and the UNIQUE becomes a
-- partial index over primaries only. Secondary product channels are ordinary
-- rooms that happen to carry a product_id, which is what makes them show up
-- under that product and gives the agent the product's context in them.

ALTER TABLE public.channels
  ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.channels.is_primary IS
  'True for the one channel created automatically with the product. It follows '
  'the product name; secondary product channels keep their own.';

-- Everything bound today is the auto-created channel.
UPDATE public.channels SET is_primary = true WHERE kind = 'product';

ALTER TABLE public.channels DROP CONSTRAINT channels_product_id_key;

CREATE UNIQUE INDEX channels_one_primary_per_product
  ON public.channels (product_id)
  WHERE is_primary;

-- A standing channel has no product, so it can never be a primary one.
ALTER TABLE public.channels
  ADD CONSTRAINT channels_primary_is_bound
  CHECK (NOT is_primary OR kind = 'product');

-- The sync trigger now touches only the primary channel for names, and every
-- channel of the product for archive state: archiving a product should close all
-- of its rooms, not just the first one.
CREATE OR REPLACE FUNCTION public.products_sync_channel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.channels (
      slug, name, kind, product_id, is_primary, created_by, archived_at
    )
    VALUES (
      left(NEW.slug, 48), NEW.name, 'product', NEW.id, true, NEW.owner_id,
      -- A product created already archived (an import) gets an archived channel
      -- rather than a live room for something nobody is working on.
      NEW.archived_at
    )
    ON CONFLICT (product_id) WHERE is_primary DO NOTHING;
    RETURN NEW;
  END IF;

  -- The primary channel is the product's own room: its name follows.
  UPDATE public.channels
  SET name = NEW.name,
      archived_at = NEW.archived_at
  WHERE product_id = NEW.id
    AND is_primary
    AND (name IS DISTINCT FROM NEW.name OR archived_at IS DISTINCT FROM NEW.archived_at);

  -- Secondary rooms keep the name someone gave them, but still open and close
  -- with the product.
  UPDATE public.channels
  SET archived_at = NEW.archived_at
  WHERE product_id = NEW.id
    AND NOT is_primary
    AND archived_at IS DISTINCT FROM NEW.archived_at;

  RETURN NEW;
END;
$$;

-- Creating a channel against a product. Same bar as a standing channel — any
-- active member — with two extra conditions the policy has to state itself,
-- because a CHECK cannot reach another table:
--   * the product must exist and not be archived, so rooms are not opened onto
--     something already closed;
--   * is_primary must be false, so the auto-created channel stays the only one
--     the rename trigger will follow.
CREATE POLICY "active members create product channels"
ON public.channels FOR INSERT TO authenticated
WITH CHECK (
  public.is_active_member()
  AND created_by = auth.uid()
  AND kind = 'product'
  AND is_primary = false
  AND EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = channels.product_id AND p.archived_at IS NULL
  )
);

-- product_id joins the insert grant. is_primary deliberately does NOT: it stays
-- writable only by the trigger, so no client can create a second channel that
-- claims to be the product's own room.
GRANT INSERT (product_id) ON public.channels TO authenticated;
