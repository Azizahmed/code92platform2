import Image from 'next/image';

// Small product badge (logo or initial + name). General tasks have no product.
export default function ProductChip({
  name,
  logoUrl,
  generalLabel
}: {
  name: string | null;
  logoUrl: string | null;
  generalLabel: string;
}) {
  const label = name ?? generalLabel;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded border border-hairline bg-raised font-mono text-[8px] text-muted">
        {logoUrl ? (
          <Image src={logoUrl} alt="" fill unoptimized sizes="16px" className="object-cover" />
        ) : (
          label.slice(0, 1).toUpperCase()
        )}
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
}
