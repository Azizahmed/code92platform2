import {useTranslations} from 'next-intl';

import RelativeTime from '@/components/RelativeTime';
import ScanNowButton from './ScanNowButton';

export type ScanRunRow = {
  id: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  products_scanned: number;
  items_inserted: number;
  items_linked: number;
  details: {
    model?: string;
    trigger?: string;
    message?: string;
    error?: string;
    products?: {name?: string; ok?: boolean; error?: string}[];
  } | null;
  started_at: string;
  finished_at: string | null;
};

const STATUS_STYLES: Record<ScanRunRow['status'], string> = {
  running: 'border-hairline bg-raised text-muted',
  success: 'border-accent/30 bg-accent/10 text-accent',
  partial: 'border-amber/30 bg-amber/10 text-amber',
  failed: 'border-danger/30 bg-danger/10 text-danger'
};

const thClass =
  'px-3 py-2 text-start text-[11px] font-medium uppercase tracking-widest text-faint';
const tdClass = 'border-t border-hairline px-3 py-2.5 align-top';

// Pipeline observability: recent scan_runs (admin-readable only) plus the
// manual "Scan now" trigger.
export default function ScanRunsPanel({runs}: {runs: ScanRunRow[]}) {
  const t = useTranslations('admin');

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{t('scans.title')}</h2>
        <ScanNowButton />
      </div>
      <div className="overflow-x-auto rounded-lg border border-hairline bg-panel">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-raised/50">
              <th className={thClass}>{t('scans.status')}</th>
              <th className={thClass}>{t('scans.products')}</th>
              <th className={thClass}>{t('scans.inserted')}</th>
              <th className={thClass}>{t('scans.linked')}</th>
              <th className={thClass}>{t('scans.started')}</th>
              <th className={thClass}>{t('scans.finished')}</th>
              <th className={thClass}>{t('scans.details')}</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td colSpan={7} className={`${tdClass} text-center text-muted`}>
                  {t('scans.empty')}
                </td>
              </tr>
            ) : (
              runs.map((run) => {
                const productErrors = (run.details?.products ?? []).filter(
                  (p) => p.ok === false
                );
                return (
                  <tr key={run.id}>
                    <td className={tdClass}>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[11px] ${STATUS_STYLES[run.status]}`}
                      >
                        {run.status === 'running' ? (
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
                        ) : null}
                        {t(`scans.statuses.${run.status}`)}
                      </span>
                    </td>
                    <td className={`${tdClass} font-mono text-xs text-muted`}>
                      {run.products_scanned}
                    </td>
                    <td className={`${tdClass} font-mono text-xs text-muted`}>
                      {run.items_inserted}
                    </td>
                    <td className={`${tdClass} font-mono text-xs text-muted`}>
                      {run.items_linked}
                    </td>
                    <td className={tdClass}>
                      <RelativeTime date={run.started_at} />
                    </td>
                    <td className={tdClass}>
                      {run.finished_at ? (
                        <RelativeTime date={run.finished_at} />
                      ) : (
                        <span className="text-xs text-faint">—</span>
                      )}
                    </td>
                    <td className={`${tdClass} max-w-64`}>
                      <div className="space-y-1 text-xs">
                        {run.details?.model ? (
                          <div dir="ltr" className="truncate font-mono text-faint" title={run.details.model}>
                            {run.details.model}
                          </div>
                        ) : null}
                        {run.details?.message?.includes('no products due') ? (
                          <div className="text-muted">{t('scans.noProductsDue')}</div>
                        ) : null}
                        {run.details?.error ? (
                          <div
                            dir="ltr"
                            className="truncate font-mono text-danger"
                            title={run.details.error}
                          >
                            {run.details.error}
                          </div>
                        ) : null}
                        {productErrors.length > 0 ? (
                          <div
                            className="text-amber"
                            title={productErrors
                              .map((p) => `${p.name ?? '?'}: ${p.error ?? '?'}`)
                              .join('\n')}
                          >
                            {t('scans.productErrors', {
                              count: productErrors.length
                            })}
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
