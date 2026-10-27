import {Link} from '@/i18n/navigation';

export type StripCell = {
  label: string;
  value: number | string;
  href: string;
  tone?: 'default' | 'attention';
};

// One row of linked counts. Every number is a link to the list it counts, so the
// number and the list cannot disagree about what they mean.
export default function Strip({
  title,
  cells,
  footnote
}: {
  title: string;
  cells: StripCell[];
  footnote?: string;
}) {
  return (
    <section className="space-y-2 rounded-lg border border-hairline bg-panel p-3 sm:p-4">
      <h2 className="px-1 text-[11px] font-medium uppercase tracking-widest text-faint">{title}</h2>
      <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-6 sm:overflow-visible">
        {cells.map((cell) => (
          <Link
            key={cell.label}
            href={cell.href}
            className={`flex min-w-[96px] shrink-0 flex-col gap-0.5 rounded-md border px-3 py-2.5 transition-colors hover:border-accent/30 hover:bg-raised/40 sm:min-w-0 ${
              cell.tone === 'attention' && Number(cell.value) > 0 ? 'border-amber/30 bg-amber/5' : 'border-hairline'
            }`}
          >
            <span className="font-mono text-lg font-semibold tabular-nums">{cell.value}</span>
            <span className="text-[11px] text-muted">{cell.label}</span>
          </Link>
        ))}
      </div>
      {footnote ? <p className="px-1 text-[11px] text-faint">{footnote}</p> : null}
    </section>
  );
}
