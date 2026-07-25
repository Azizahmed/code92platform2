-- Let an update be removed from a product's timeline.
--
-- status_updates was append-only (SELECT + INSERT only), which meant a manual
-- update posted by mistake was permanent. Deletion is now allowed for the
-- update's own author or an admin -- the same rule knowledge_items uses.
--
-- The hard part is not the delete, it is the derived state. The AFTER INSERT
-- trigger pushes health / stage / last_status_update_at / next_review_at onto
-- the parent product, so removing an update would otherwise leave the product
-- advertising the health of a row that no longer exists. The AFTER DELETE
-- trigger below rebuilds those columns from whatever history remains.

CREATE POLICY "authors or admins delete status updates"
ON public.status_updates FOR DELETE TO authenticated
USING (
  public.is_active_member()
  AND (author_id = (SELECT auth.uid()) OR public.is_admin())
);

GRANT DELETE ON public.status_updates TO authenticated;

-- status_update_attachments rows cascade automatically (ON DELETE CASCADE);
-- referential actions run as the system and are not filtered by RLS, so no
-- extra grant is needed there. The storage objects they point at are cleaned
-- up by the caller, which reads the keys before issuing the delete.

CREATE OR REPLACE FUNCTION public.status_updates_reapply_to_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  latest public.status_updates;
  latest_stage TEXT;
BEGIN
  SELECT * INTO latest
  FROM public.status_updates
  WHERE product_id = OLD.product_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF latest.id IS NULL THEN
    -- Nothing left: return the product to its pre-update baseline, matching
    -- products_before_insert. next_review_at is derived from created_at rather
    -- than now() on purpose -- deleting an update must not silently grant a
    -- fresh review window, and it keeps an overdue product overdue.
    UPDATE public.products
    SET health = 'unknown',
        last_status_update_at = NULL,
        next_review_at = created_at + make_interval(days => review_interval_days)
    WHERE id = OLD.product_id;
  ELSE
    -- stage is sticky on insert (COALESCE(NEW.stage, stage)), because an
    -- update may leave it unchanged. Invert that faithfully by rebuilding from
    -- the most recent remaining update that actually set a stage; if none did,
    -- leave the product's stage alone -- it is also editable on its own form.
    SELECT stage INTO latest_stage
    FROM public.status_updates
    WHERE product_id = OLD.product_id AND stage IS NOT NULL
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    UPDATE public.products
    SET health = latest.health,
        stage = COALESCE(latest_stage, stage),
        last_status_update_at = latest.created_at,
        next_review_at =
          latest.created_at + make_interval(days => review_interval_days)
    WHERE id = OLD.product_id;
  END IF;

  RETURN OLD;
END;
$$;

-- products grants no DELETE to authenticated (products are archived, never
-- deleted), so this will not fire from a product cascade in practice. If one
-- ever did, the parent row is already gone and the UPDATE matches zero rows.
CREATE TRIGGER status_updates_reapply_to_product
AFTER DELETE ON public.status_updates
FOR EACH ROW EXECUTE FUNCTION public.status_updates_reapply_to_product();
