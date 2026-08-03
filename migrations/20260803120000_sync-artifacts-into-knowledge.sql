-- Lifecycle artifacts appear in the knowledge base, with their origin attached.
--
-- The PRD, the threat model, the runbook — the most valuable documents in the
-- company were reachable only by knowing which product they belonged to and
-- which of its six phases somebody filed them under. The knowledge base, which
-- is where people actually go to look things up, could not see them at all.
--
-- So every file or link artifact now also exists as a knowledge source, and
-- carries a pointer back to the phase it came from. Two things about how:
--
--   * No bytes are copied. The mirrored item records the artifact's existing
--     storage key and the BUCKET it lives in, so both surfaces read one object.
--     A second copy would drift, double the storage, and give the two views
--     different answers about the same document.
--
--   * No access widens. phase_artifacts and knowledge_items are both readable
--     under `public.is_active_member()` — the same audience, checked here
--     because the artifacts include threat models and pentest reports and the
--     answer had to be "identical", not "close enough".
--
-- Direction matters. phase_artifacts.knowledge_item_id already existed and
-- means "this artifact CITES an existing knowledge item". The new
-- knowledge_items.source_artifact_id means "this knowledge item CAME FROM an
-- artifact". Opposite arrows, different facts, and an artifact that cites a
-- knowledge item is never mirrored — it is already in there.

-- ============================================================
-- Provenance columns
-- ============================================================

ALTER TABLE public.knowledge_items
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'
    CHECK (origin IN ('manual', 'lifecycle')),
  ADD COLUMN source_artifact_id UUID UNIQUE
    REFERENCES public.phase_artifacts(id) ON DELETE CASCADE,
  -- Which bucket file_key lives in. Existing rows are all knowledge uploads;
  -- mirrored artifacts point at lifecycle-artifacts instead.
  ADD COLUMN file_bucket TEXT NOT NULL DEFAULT 'knowledge-files'
    CHECK (file_bucket IN ('knowledge-files', 'lifecycle-artifacts')),

  -- An artifact-backed item is a lifecycle item and vice versa. Without this
  -- the two columns could disagree and every consumer would have to pick one.
  ADD CONSTRAINT knowledge_items_origin_matches_source CHECK (
    (origin = 'lifecycle') = (source_artifact_id IS NOT NULL)
  );

CREATE INDEX knowledge_items_origin_idx
ON public.knowledge_items (origin, created_at DESC)
WHERE archived_at IS NULL;

-- ============================================================
-- Grants
-- ============================================================
-- knowledge_items held a TABLE-level INSERT grant, so the three columns above
-- would have been insertable the moment they existed — letting any member
-- forge an item that claims to have come from a lifecycle phase it never
-- touched. Re-granted column by column, which is the same fix
-- 20260728072155_tighten-products-insert-grant.sql made to products.
--
-- The omissions are the point: origin, source_artifact_id and file_bucket are
-- writable only by the mirror trigger below.

REVOKE INSERT ON public.knowledge_items FROM authenticated;
GRANT INSERT (
  id, kind, title, content, url, file_url, file_key, file_name,
  mime_type, size_bytes, status, author_id, archived_at,
  created_at, updated_at
) ON public.knowledge_items TO authenticated;

-- Deleting a mirrored item would leave the artifact with no way to put it back.
-- They are removed by removing the artifact (ON DELETE CASCADE above).
-- Archiving still works, so an item can be taken out of the way without
-- breaking the link.
DROP POLICY "author or admin deletes knowledge items" ON public.knowledge_items;

CREATE POLICY "author or admin deletes knowledge items"
ON public.knowledge_items FOR DELETE TO authenticated
USING (
  public.is_active_member()
  AND origin = 'manual'
  AND (author_id = (SELECT auth.uid()) OR public.is_admin())
);

-- ============================================================
-- validate_knowledge_item — protect what mirrors the artifact
-- ============================================================
-- Title, status, content, tags and archived_at stay editable on a mirrored
-- item: curating it is the whole reason for putting it in the knowledge base.
-- The fields that describe WHERE IT CAME FROM do not, or the provenance would
-- be a claim rather than a record.

CREATE OR REPLACE FUNCTION public.validate_knowledge_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.title := btrim(NEW.title);

  IF TG_OP = 'UPDATE' THEN
    IF NEW.author_id IS DISTINCT FROM OLD.author_id THEN
      RAISE EXCEPTION 'knowledge item author is immutable';
    END IF;
    -- Notes and articles are the same shape, so promoting a note to an
    -- article is allowed; anything involving 'source' is not.
    IF NEW.kind IS DISTINCT FROM OLD.kind
       AND 'source' IN (NEW.kind, OLD.kind) THEN
      RAISE EXCEPTION 'a source cannot be converted to another kind';
    END IF;

    IF OLD.origin = 'lifecycle' AND (
      NEW.origin IS DISTINCT FROM OLD.origin
      OR NEW.source_artifact_id IS DISTINCT FROM OLD.source_artifact_id
      OR NEW.file_key IS DISTINCT FROM OLD.file_key
      OR NEW.file_bucket IS DISTINCT FROM OLD.file_bucket
      OR NEW.url IS DISTINCT FROM OLD.url
    ) THEN
      RAISE EXCEPTION 'the source of a lifecycle-derived knowledge item is immutable';
    END IF;

    IF OLD.origin = 'manual' AND NEW.origin IS DISTINCT FROM OLD.origin THEN
      RAISE EXCEPTION 'a knowledge item cannot be reassigned to the lifecycle';
    END IF;
  END IF;

  IF NEW.status IS NULL THEN
    NEW.status := CASE WHEN NEW.kind = 'source' THEN 'to_review' ELSE 'draft' END;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- The mirror
-- ============================================================

CREATE OR REPLACE FUNCTION public.mirror_artifact_to_knowledge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  prod_id UUID;
  item_id UUID;
BEGIN
  -- An artifact that cites a knowledge item is already in the knowledge base;
  -- mirroring it would file the same document twice.
  IF NEW.knowledge_item_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Nothing to point at.
  IF NEW.storage_key IS NULL AND NEW.url IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT lp.product_id INTO prod_id
  FROM public.product_lifecycle_phases lp
  WHERE lp.id = NEW.phase_id;

  INSERT INTO public.knowledge_items (
    kind, title, status, author_id,
    url, file_url, file_key, file_name, mime_type, size_bytes,
    file_bucket, origin, source_artifact_id, created_at
  ) VALUES (
    'source',
    NEW.title,
    -- Evidence that has been filed against a phase is in use by definition;
    -- starting it at 'to_review' would fill somebody's review queue with
    -- documents nobody asked them to review.
    'in_use',
    NEW.uploader_id,
    NEW.url,
    NEW.storage_url, NEW.storage_key, NEW.file_name, NEW.mime_type, NEW.size_bytes,
    'lifecycle-artifacts',
    'lifecycle',
    NEW.id,
    NEW.created_at
  )
  RETURNING id INTO item_id;

  -- The product link is what makes the mirrored item findable by the filter
  -- people already use.
  IF prod_id IS NOT NULL THEN
    INSERT INTO public.knowledge_item_products (item_id, product_id)
    VALUES (item_id, prod_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mirror_artifact_to_knowledge()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER phase_artifacts_mirror_to_knowledge
AFTER INSERT ON public.phase_artifacts
FOR EACH ROW EXECUTE FUNCTION public.mirror_artifact_to_knowledge();

-- ============================================================
-- knowledge_provenance — where an item came from
-- ============================================================
-- One row per lifecycle-derived item, carrying everything the UI needs to say
-- "this is the threat model from Requirements on Jadawel" without four joins
-- at every call site.

CREATE VIEW public.knowledge_provenance
WITH (security_invoker = true)
AS
SELECT
  ki.id AS item_id,
  ki.source_artifact_id AS artifact_id,
  pa.artifact_type,
  pa.generated_by,
  lp.id AS phase_id,
  lp.phase,
  lp.cycle,
  lp.state AS phase_state,
  p.id AS product_id,
  p.name AS product_name,
  p.slug AS product_slug,
  p.risk_tier,
  pa.uploader_id,
  tm.display_name AS uploader_name,
  pa.created_at AS filed_at
FROM public.knowledge_items ki
JOIN public.phase_artifacts pa ON pa.id = ki.source_artifact_id
JOIN public.product_lifecycle_phases lp ON lp.id = pa.phase_id
JOIN public.products p ON p.id = lp.product_id
LEFT JOIN public.team_members tm ON tm.user_id = pa.uploader_id;

GRANT SELECT ON public.knowledge_provenance TO authenticated;

-- ============================================================
-- search_knowledge_items — carry origin and provenance through
-- ============================================================
-- Appends columns and one optional filter. Existing callers that pass the old
-- argument list keep working, because every new parameter has a default.

CREATE OR REPLACE FUNCTION public.search_knowledge_items(
  p_query TEXT DEFAULT NULL,
  p_kind TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_tag UUID DEFAULT NULL,
  p_product UUID DEFAULT NULL,
  p_include_archived BOOLEAN DEFAULT false,
  p_limit INTEGER DEFAULT 60,
  p_origin TEXT DEFAULT NULL,
  p_phase TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  kind TEXT,
  title TEXT,
  excerpt TEXT,
  url TEXT,
  file_name TEXT,
  status TEXT,
  author_id UUID,
  author_name TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  rank REAL,
  tag_names TEXT[],
  product_names TEXT[],
  origin TEXT,
  source_artifact_id UUID,
  source_artifact_type TEXT,
  source_phase TEXT,
  source_product_id UUID,
  source_product_name TEXT
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH q AS (
    SELECT CASE
      WHEN p_query IS NULL OR btrim(p_query) = '' THEN NULL
      -- OR the two parses: the english one matches stemmed tokens, the simple
      -- one matches tokens verbatim. Either half may come back empty (all
      -- stopwords) without breaking the other.
      ELSE websearch_to_tsquery('english'::regconfig, p_query)
           || websearch_to_tsquery('simple'::regconfig, p_query)
    END AS ts
  )
  SELECT
    ki.id,
    ki.kind,
    ki.title,
    left(
      btrim(
        regexp_replace(
          regexp_replace(coalesce(ki.content, ki.url, ''), '[#*_`>\[\]]', '', 'g'),
          '\s+', ' ', 'g'
        )
      ),
      280
    ) AS excerpt,
    ki.url,
    ki.file_name,
    ki.status,
    ki.author_id,
    tm.display_name AS author_name,
    ki.archived_at,
    ki.created_at,
    ki.updated_at,
    CASE WHEN q.ts IS NULL THEN 0::real
         ELSE ts_rank(ki.search_vector, q.ts) END AS rank,
    COALESCE(
      (SELECT array_agg(t.name ORDER BY t.name)
       FROM public.knowledge_item_tags kit
       JOIN public.tags t ON t.id = kit.tag_id
       WHERE kit.item_id = ki.id),
      '{}'
    ) AS tag_names,
    COALESCE(
      (SELECT array_agg(p.name ORDER BY p.name)
       FROM public.knowledge_item_products kip
       JOIN public.products p ON p.id = kip.product_id
       WHERE kip.item_id = ki.id),
      '{}'
    ) AS product_names,
    ki.origin,
    ki.source_artifact_id,
    kp.artifact_type AS source_artifact_type,
    kp.phase AS source_phase,
    kp.product_id AS source_product_id,
    kp.product_name AS source_product_name
  FROM public.knowledge_items ki
  CROSS JOIN q
  LEFT JOIN public.team_members tm ON tm.user_id = ki.author_id
  LEFT JOIN public.knowledge_provenance kp ON kp.item_id = ki.id
  WHERE (p_include_archived OR ki.archived_at IS NULL)
    AND (p_kind IS NULL OR ki.kind = p_kind)
    AND (p_status IS NULL OR ki.status = p_status)
    AND (p_origin IS NULL OR ki.origin = p_origin)
    AND (p_phase IS NULL OR kp.phase = p_phase)
    AND (q.ts IS NULL OR ki.search_vector @@ q.ts)
    AND (
      p_tag IS NULL OR EXISTS (
        SELECT 1 FROM public.knowledge_item_tags kit
        WHERE kit.item_id = ki.id AND kit.tag_id = p_tag
      )
    )
    AND (
      p_product IS NULL OR EXISTS (
        SELECT 1 FROM public.knowledge_item_products kip
        WHERE kip.item_id = ki.id AND kip.product_id = p_product
      )
    )
  ORDER BY
    CASE WHEN q.ts IS NULL THEN 0::real
         ELSE ts_rank(ki.search_vector, q.ts) END DESC,
    ki.created_at DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 60), 1), 200);
$$;

GRANT EXECUTE ON FUNCTION public.search_knowledge_items(
  TEXT, TEXT, TEXT, UUID, UUID, BOOLEAN, INTEGER, TEXT, TEXT
) TO authenticated;

-- The old 7-argument signature is a separate function object and would keep
-- answering with the old column list. Dropped so there is one definition.
DROP FUNCTION IF EXISTS public.search_knowledge_items(
  TEXT, TEXT, TEXT, UUID, UUID, BOOLEAN, INTEGER
);

-- ============================================================
-- Backfill
-- ============================================================
-- Everything already filed against a phase, mirrored under the same rules the
-- trigger applies from here on.

INSERT INTO public.knowledge_items (
  kind, title, status, author_id,
  url, file_url, file_key, file_name, mime_type, size_bytes,
  file_bucket, origin, source_artifact_id, created_at
)
SELECT
  'source', pa.title, 'in_use', pa.uploader_id,
  pa.url, pa.storage_url, pa.storage_key, pa.file_name, pa.mime_type, pa.size_bytes,
  'lifecycle-artifacts', 'lifecycle', pa.id, pa.created_at
FROM public.phase_artifacts pa
WHERE pa.knowledge_item_id IS NULL
  AND (pa.storage_key IS NOT NULL OR pa.url IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.knowledge_items ki
    WHERE ki.source_artifact_id = pa.id
  );

INSERT INTO public.knowledge_item_products (item_id, product_id)
SELECT ki.id, lp.product_id
FROM public.knowledge_items ki
JOIN public.phase_artifacts pa ON pa.id = ki.source_artifact_id
JOIN public.product_lifecycle_phases lp ON lp.id = pa.phase_id
WHERE ki.origin = 'lifecycle'
ON CONFLICT DO NOTHING;
