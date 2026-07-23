// TEMPORARY STUB (M3) — the trends workstream (M6) replaces this file with
// the real linked-trends panel. Keep the named export and props signature.
export async function ProductTrendsPanel({
  productId,
  locale
}: {
  productId: string;
  locale: string;
}) {
  return (
    <div
      data-product-id={productId}
      data-locale={locale}
      className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-10 text-center text-sm text-faint"
    >
      Trends panel — ships with M6.
    </div>
  );
}
