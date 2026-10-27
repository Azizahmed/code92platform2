import {getTranslations} from 'next-intl/server';

import RelativeTime from '@/components/RelativeTime';
import {Link} from '@/i18n/navigation';
import {gapLabelKey} from '@/lib/releases';

export type GateLogEntry = {
  occurred_at: string;
  kind: 'business_stage' | 'gate_decision' | 'release_stage' | 'release_approval' | 'release_status' | 'lifecycle_retired';
  product_id: string;
  product_name: string;
  release_id: string | null;
  release_version: string | null;
  from_value: string | null;
  to_value: string | null;
  actor_name: string | null;
  note: string | null;
  waiver_reason: string | null;
  self_approved: boolean;
  missing: string[];
  gate: number | null;
  decision: string | null;
};

// Every decision the platform records, in one list: what moved, who moved it,
// why, and what was missing when it did. Waivers and self-approvals are marked,
// because those are the entries a reader is looking for.
export default async function GateLogTable({
  entries,
  emptyMessage,
  locale
}: {
  entries: GateLogEntry[];
  emptyMessage: string;
  locale: string;
}) {
  const t = await getTranslations('governance');
  const dateFormat = new Intl.DateTimeFormat(locale, {year: 'numeric', month: 'short', day: 'numeric'});

  if (entries.length === 0) {
    return <p className="rounded-lg border border-dashed border-hairline bg-panel/50 px-6 py-10 text-center text-sm text-muted">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-panel">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-hairline bg-raised/30 text-[10px] uppercase tracking-widest text-faint">
            <th className="px-4 py-2.5 text-start font-medium">{t('log.when')}</th>
            <th className="px-4 py-2.5 text-start font-medium">{t('log.what')}</th>
            <th className="px-4 py-2.5 text-start font-medium">{t('log.product')}</th>
            <th className="px-4 py-2.5 text-start font-medium">{t('log.change')}</th>
            <th className="px-4 py-2.5 text-start font-medium">{t('log.by')}</th>
            <th className="px-4 py-2.5 text-start font-medium">{t('log.why')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <tr key={`${entry.kind}-${entry.occurred_at}-${index}`} className="border-b border-hairline align-top last:border-0">
              <td className="whitespace-nowrap px-4 py-3 text-xs text-faint">
                <span className="block">{dateFormat.format(new Date(entry.occurred_at))}</span>
                <RelativeTime date={entry.occurred_at} />
              </td>
              <td className="px-4 py-3 text-xs">
                <span className="text-ink">{t(`log.kinds.${entry.kind}`)}</span>
                {entry.gate ? <span className="ms-1 font-mono text-[10px] text-faint">G{entry.gate}</span> : null}
                {entry.waiver_reason ? (
                  <span className="mt-1 block rounded border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber">{t('log.waiver')}</span>
                ) : null}
                {entry.self_approved ? (
                  <span className="mt-1 block rounded border border-hairline bg-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted">{t('log.selfApproved')}</span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-xs">
                <Link href={`/products/${entry.product_id}`} className="text-ink hover:text-accent">{entry.product_name}</Link>
                {entry.release_version ? <span dir="ltr" className="block font-mono text-[10px] text-faint">{entry.release_version}</span> : null}
              </td>
              <td className="px-4 py-3 text-xs text-muted">
                {entry.decision ? <span className="text-ink">{t(`log.decision.${entry.decision}`)}</span> : null}
                {entry.from_value || entry.to_value ? (
                  <span>
                    {entry.from_value ? formatValue(entry.from_value, entry.kind, t) : '—'} → {entry.to_value ? formatValue(entry.to_value, entry.kind, t) : '—'}
                  </span>
                ) : null}
                {entry.missing.length > 0 ? (
                  <span className="mt-1 block text-[10px] text-faint">
                    {t('log.missing', {items: entry.missing.map((gap) => t(`gap.${gapLabelKey(gap)}`)).join(', ')})}
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-xs text-muted">{entry.actor_name ?? '—'}</td>
              <td className="max-w-xs px-4 py-3 text-xs text-muted">
                <span className="line-clamp-3 whitespace-pre-line">{entry.note ?? entry.waiver_reason ?? '—'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatValue(
  value: string,
  kind: GateLogEntry['kind'],
  t: (key: string) => string
): string {
  if (kind === 'business_stage') return t(`stages.${value}`);
  if (kind === 'release_stage' || kind === 'release_approval') return t(`stage.${value}`);
  if (kind === 'release_status') return t(`status.${value}`);
  return value;
}
