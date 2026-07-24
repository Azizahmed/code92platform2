-- Company knowledge base: articles, notes, and sources.
-- Items carry a kind-specific status, free-form shared tags, and optional
-- links to any number of products. Full-text search runs on a stored
-- tsvector indexed under two configurations: `english` (stemming, so
-- "deploying" finds "deploy") and `simple` (exact tokens, which is what
-- Arabic and identifiers need since Postgres ships no Arabic stemmer).

-- ============================================================
-- knowledge_items
-- ============================================================

CREATE TABLE public.knowledge_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('article', 'note', 'source')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  content TEXT CHECK (content IS NULL OR char_length(content) <= 100000),
  url TEXT CHECK (url IS NULL OR url ~ '^https?://'),
  -- Uploaded source file. The bucket is private, so file_url is kept only to
  -- follow the house "persist url + key" convention; readers always get a
  -- freshly signed URL generated from file_key.
  file_url TEXT,
  file_key TEXT UNIQUE,
  file_name TEXT CHECK (file_name IS NULL OR char_length(file_name) BETWEEN 1 AND 255),
  mime_type TEXT,
  size_bytes BIGINT
    CHECK (size_bytes IS NULL OR (size_bytes > 0 AND size_bytes <= 52428800)),
  -- Filled by the validate trigger when the caller omits it: articles and
  -- notes start as 'draft', sources as 'to_review'.
  status TEXT NOT NULL,
  author_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  archived_at TIMESTAMPTZ,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(content, '')), 'B') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(content, '')), 'B') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(file_name, '')), 'C')
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Each kind owns its own status vocabulary.
  CONSTRAINT knowledge_items_status_matches_kind CHECK (
    (kind IN ('article', 'note') AND status IN ('draft', 'published'))
    OR (kind = 'source' AND status IN ('to_review', 'in_use', 'processed'))
  ),
  -- An uploaded file is all-or-nothing.
  CONSTRAINT knowledge_items_file_complete CHECK (
    num_nonnulls(file_url, file_key, file_name, mime_type, size_bytes) IN (0, 5)
  ),
  -- Articles and notes need a body; a source needs a link or a file.
  CONSTRAINT knowledge_items_body_present CHECK (
    (kind IN ('article', 'note') AND content IS NOT NULL AND btrim(content) <> '')
    OR (kind = 'source' AND (url IS NOT NULL OR file_key IS NOT NULL))
  )
);

CREATE INDEX knowledge_items_search_idx
ON public.knowledge_items USING GIN (search_vector);

CREATE INDEX knowledge_items_browse_idx
ON public.knowledge_items (kind, status, created_at DESC)
WHERE archived_at IS NULL;

CREATE INDEX knowledge_items_created_at_idx
ON public.knowledge_items (created_at DESC);

CREATE INDEX knowledge_items_author_id_idx
ON public.knowledge_items (author_id);

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
  END IF;

  IF NEW.status IS NULL THEN
    NEW.status := CASE WHEN NEW.kind = 'source' THEN 'to_review' ELSE 'draft' END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_items_validate
BEFORE INSERT OR UPDATE ON public.knowledge_items
FOR EACH ROW EXECUTE FUNCTION public.validate_knowledge_item();

CREATE TRIGGER knowledge_items_updated_at
BEFORE UPDATE ON public.knowledge_items
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

ALTER TABLE public.knowledge_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read knowledge items"
ON public.knowledge_items FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "active members create knowledge items"
ON public.knowledge_items FOR INSERT TO authenticated
WITH CHECK (
  public.is_active_member()
  AND author_id = (SELECT auth.uid())
);

CREATE POLICY "author or admin updates knowledge items"
ON public.knowledge_items FOR UPDATE TO authenticated
USING (
  public.is_active_member()
  AND (author_id = (SELECT auth.uid()) OR public.is_admin())
)
WITH CHECK (
  public.is_active_member()
  AND (author_id = (SELECT auth.uid()) OR public.is_admin())
);

CREATE POLICY "author or admin deletes knowledge items"
ON public.knowledge_items FOR DELETE TO authenticated
USING (
  public.is_active_member()
  AND (author_id = (SELECT auth.uid()) OR public.is_admin())
);

REVOKE ALL ON public.knowledge_items FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.knowledge_items TO authenticated;
-- author_id is set once at insert; search_vector is generated.
GRANT UPDATE (kind, title, content, url, file_url, file_key, file_name,
              mime_type, size_bytes, status, archived_at)
ON public.knowledge_items TO authenticated;

-- Edit rights for the link tables below. SECURITY DEFINER so the join-table
-- policies don't re-run the knowledge_items policies on every row.
CREATE OR REPLACE FUNCTION public.can_edit_knowledge_item(item UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.is_active_member() AND EXISTS (
    SELECT 1 FROM public.knowledge_items ki
    WHERE ki.id = item
      AND (ki.author_id = (SELECT auth.uid()) OR public.is_admin())
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_edit_knowledge_item(UUID) TO authenticated;

-- ============================================================
-- tags (shared vocabulary; any member may add, admins curate)
-- ============================================================

CREATE TABLE public.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  created_by UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness keeps "AI" and "ai" from splitting the vocabulary.
CREATE UNIQUE INDEX tags_name_key ON public.tags (lower(btrim(name)));

CREATE OR REPLACE FUNCTION public.normalize_tag_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.name := btrim(NEW.name);
  RETURN NEW;
END;
$$;

CREATE TRIGGER tags_normalize_name
BEFORE INSERT OR UPDATE ON public.tags
FOR EACH ROW EXECUTE FUNCTION public.normalize_tag_name();

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read tags"
ON public.tags FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "active members create tags"
ON public.tags FOR INSERT TO authenticated
WITH CHECK (
  public.is_active_member()
  AND created_by = (SELECT auth.uid())
);

CREATE POLICY "admins rename tags"
ON public.tags FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "admins delete tags"
ON public.tags FOR DELETE TO authenticated
USING (public.is_admin());

REVOKE ALL ON public.tags FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.tags TO authenticated;
GRANT UPDATE (name) ON public.tags TO authenticated;

-- ============================================================
-- knowledge_item_tags
-- ============================================================

CREATE TABLE public.knowledge_item_tags (
  item_id UUID NOT NULL
    REFERENCES public.knowledge_items(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, tag_id)
);

CREATE INDEX knowledge_item_tags_tag_id_idx
ON public.knowledge_item_tags (tag_id);

ALTER TABLE public.knowledge_item_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read knowledge item tags"
ON public.knowledge_item_tags FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "item editors add knowledge item tags"
ON public.knowledge_item_tags FOR INSERT TO authenticated
WITH CHECK (public.can_edit_knowledge_item(item_id));

CREATE POLICY "item editors remove knowledge item tags"
ON public.knowledge_item_tags FOR DELETE TO authenticated
USING (public.can_edit_knowledge_item(item_id));

REVOKE ALL ON public.knowledge_item_tags FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.knowledge_item_tags TO authenticated;

-- ============================================================
-- knowledge_item_products
-- ============================================================

CREATE TABLE public.knowledge_item_products (
  item_id UUID NOT NULL
    REFERENCES public.knowledge_items(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, product_id)
);

CREATE INDEX knowledge_item_products_product_id_idx
ON public.knowledge_item_products (product_id);

ALTER TABLE public.knowledge_item_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read knowledge item products"
ON public.knowledge_item_products FOR SELECT TO authenticated
USING (public.is_active_member());

CREATE POLICY "item editors link knowledge items to products"
ON public.knowledge_item_products FOR INSERT TO authenticated
WITH CHECK (public.can_edit_knowledge_item(item_id));

CREATE POLICY "item editors unlink knowledge items from products"
ON public.knowledge_item_products FOR DELETE TO authenticated
USING (public.can_edit_knowledge_item(item_id));

REVOKE ALL ON public.knowledge_item_products FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.knowledge_item_products TO authenticated;

-- ============================================================
-- search_knowledge_items — filters + ranked full-text search
-- ============================================================
-- Runs with invoker rights, so every row it returns has already passed the
-- knowledge_items SELECT policy. Ranking needs ts_rank in ORDER BY, which
-- PostgREST cannot express, hence an RPC rather than a view.

CREATE OR REPLACE FUNCTION public.search_knowledge_items(
  p_query TEXT DEFAULT NULL,
  p_kind TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_tag UUID DEFAULT NULL,
  p_product UUID DEFAULT NULL,
  p_include_archived BOOLEAN DEFAULT false,
  p_limit INTEGER DEFAULT 60
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
  product_names TEXT[]
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
    ) AS product_names
  FROM public.knowledge_items ki
  CROSS JOIN q
  LEFT JOIN public.team_members tm ON tm.user_id = ki.author_id
  WHERE (p_include_archived OR ki.archived_at IS NULL)
    AND (p_kind IS NULL OR ki.kind = p_kind)
    AND (p_status IS NULL OR ki.status = p_status)
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
  TEXT, TEXT, TEXT, UUID, UUID, BOOLEAN, INTEGER
) TO authenticated;
