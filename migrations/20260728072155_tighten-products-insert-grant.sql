-- Close a gap opened by 20260728071659_add-github-integration.sql.
--
-- That migration relied on withholding a column UPDATE grant to keep
-- products.github_* writable only by the github-sync edge function. UPDATE is
-- indeed column-scoped on products — but INSERT was granted at TABLE level, and
-- a table-level grant silently extends to every column added later. So a client
-- could not modify a link, but could still fabricate one at product-creation
-- time by POSTing github_repo/github_repo_id with the new product, claiming a
-- repository GitHub never confirmed it may write to.
--
-- Re-grant INSERT column-scoped over exactly the columns that were insertable
-- before the GitHub migration, so existing product creation is unchanged and the
-- link columns become unwritable by any client on every path.

REVOKE INSERT ON public.products FROM authenticated;

GRANT INSERT (
  id, name, slug, description, description_ar, category, stage, health,
  owner_id, links, keywords, trend_scan_enabled, review_interval_days,
  next_review_at, last_status_update_at, last_trend_scan_at, archived_at,
  created_at, updated_at, logo_url, logo_key, risk_tier
) ON public.products TO authenticated;
