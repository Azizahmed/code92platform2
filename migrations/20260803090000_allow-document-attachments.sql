-- Document attachments on tasks.
--
-- task_attachments was image-only: `CHECK (mime_type LIKE 'image/%')`. That was
-- right when the only thing anyone attached to a task was a screenshot, but a
-- task now routinely carries the markdown note that explains it, and the only
-- place to put one was the lifecycle artifact list — which is product-level
-- evidence, not task-level working material.
--
-- The allowlist below is the same one the knowledge base and lifecycle
-- artifacts already use (lib/knowledge.ts:isAllowedKnowledgeFileType). Keeping
-- one definition in SQL means the three surfaces cannot drift apart silently.

-- ============================================================
-- The shared allowlist
-- ============================================================
-- IMMUTABLE because a CHECK constraint may only call immutable functions. It
-- is a pure lookup over a literal list, so that is honest rather than a claim
-- made to satisfy the planner.

CREATE OR REPLACE FUNCTION public.is_allowed_attachment_type(p_mime TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_mime IS NOT NULL AND (
    lower(p_mime) LIKE 'image/%'
    -- text/markdown, text/plain, text/csv, …
    OR lower(p_mime) LIKE 'text/%'
    OR lower(p_mime) IN (
      'application/pdf',
      'application/json',
      'application/rtf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )
  );
$$;

-- ============================================================
-- task_attachments — accept documents, raise the cap
-- ============================================================
-- The 10 MB image cap becomes the 25 MB cap the other document surfaces use.
-- Existing rows are all images under 10 MB, so both new constraints are
-- strictly wider and the rewrite cannot fail on live data.

ALTER TABLE public.task_attachments
  DROP CONSTRAINT IF EXISTS task_attachments_mime_type_check;

ALTER TABLE public.task_attachments
  ADD CONSTRAINT task_attachments_mime_type_check
  CHECK (public.is_allowed_attachment_type(mime_type));

ALTER TABLE public.task_attachments
  DROP CONSTRAINT IF EXISTS task_attachments_size_bytes_check;

ALTER TABLE public.task_attachments
  ADD CONSTRAINT task_attachments_size_bytes_check
  CHECK (size_bytes > 0 AND size_bytes <= 26214400);

-- status_update_attachments is deliberately left image-only. A status update is
-- a short written note with supporting screenshots; documents belong on the
-- task they came out of or in the lifecycle record, both of which now take them.
