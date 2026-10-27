'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';

import GateDecisionDialog from '@/components/business/GateDecisionDialog';
import RelativeTime from '@/components/RelativeTime';
import {gateWaitingAt, type BusinessStage, type GateNumber} from '@/lib/business-track';

export type GateDecisionRow = {
  id: string;
  gate: GateNumber;
  decision: 'go' | 'no_go';
  decided_on: string;
  decided_by_name: string | null;
  note: string;
  pmf_criteria: string | null;
  evidence: string | null;
  created_at: string;
};

// Both gates, with the decision that currently counts for each. A founder sees
// the button on the gate the product is waiting at.
export default function GatesCard({
  productId,
  productName,
  stage,
  founder,
  decisions,
  locale
}: {
  productId: string;
  productName: string;
  stage: BusinessStage;
  founder: boolean;
  decisions: GateDecisionRow[];
  locale: string;
}) {
  const t = useTranslations('business');
  const [open, setOpen] = useState<GateNumber | null>(null);
  const waiting = gateWaitingAt(stage);
  const dateFormat = new Intl.DateTimeFormat(locale, {year: 'numeric', month: 'short', day: 'numeric'});

  const latest = ([1, 2] as const).map((gate) => ({
    gate,
    row: decisions.find((item) => item.gate === gate) ?? null
  }));

  return (
    <section className="space-y-4 rounded-lg border border-hairline bg-panel p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{t('gate.title')}</h2>
        <p className="text-[11px] text-faint">{t('gate.founderOnly')}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {latest.map(({gate, row}) => {
          const outcome = row?.decision ?? null;
          return (
            <div
              key={gate}
              className={`space-y-2 rounded-md border p-3 ${
                waiting === gate ? 'border-amber/40 bg-amber/5' : 'border-hairline'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium">{t(`gate.name.${gate}`)}</p>
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                    outcome === 'go'
                      ? 'bg-accent/15 text-accent'
                      : outcome === 'no_go'
                        ? 'bg-danger/10 text-danger'
                        : 'bg-raised text-faint'
                  }`}
                >
                  {outcome ? t(`gate.decision.${outcome}`) : t('gate.notDecided')}
                </span>
              </div>

              {row ? (
                <dl className="space-y-1 text-[11px] text-muted">
                  <div>
                    <dt className="inline text-faint">{t('gate.decidedBy')}: </dt>
                    <dd className="inline">{row.decided_by_name ?? '—'}</dd>
                    <dt className="inline text-faint"> · </dt>
                    <dd className="inline">{dateFormat.format(new Date(`${row.decided_on}T00:00:00`))}</dd>
                  </div>
                  <dd className="whitespace-pre-line text-ink/90">{row.note}</dd>
                  {row.pmf_criteria ? (
                    <dd>
                      <span className="text-faint">{t('gate.pmfCriteria')}: </span>
                      {row.pmf_criteria}
                    </dd>
                  ) : null}
                  {row.evidence ? (
                    <dd>
                      <span className="text-faint">{t('gate.evidence')}: </span>
                      {row.evidence}
                    </dd>
                  ) : null}
                </dl>
              ) : (
                <p className="text-[11px] text-faint">{t('gate.noDecisionYet')}</p>
              )}

              {founder && waiting === gate ? (
                <button
                  type="button"
                  onClick={() => setOpen(gate)}
                  className="rounded-md border border-accent/40 px-2.5 py-1.5 text-xs text-accent transition-colors hover:bg-accent/10"
                >
                  {t('gate.recordAction')}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {decisions.length > 0 ? (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer text-faint hover:text-ink">
            {t('gate.history', {count: decisions.length})}
          </summary>
          <ul className="mt-2 space-y-1.5">
            {decisions.map((item) => (
              <li key={item.id} className="flex flex-wrap gap-x-2">
                <span className="font-mono text-[10px] text-faint">G{item.gate}</span>
                <span>{t(`gate.decision.${item.decision}`)}</span>
                <span className="text-faint">· {item.decided_by_name ?? '—'}</span>
                <RelativeTime date={item.created_at} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {open ? (
        <GateDecisionDialog
          productId={productId}
          productName={productName}
          gate={open}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}
