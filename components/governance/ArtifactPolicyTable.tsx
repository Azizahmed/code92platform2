'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';

import {setArtifactPolicyAction} from '@/lib/actions/releases';
import {ARTIFACT_KEYS, ARTIFACT_STAGE, type ArtifactKey} from '@/lib/releases';
import {RISK_TIERS, type RiskTier} from '@/lib/risk';

export type PolicyRow = {risk_tier: RiskTier; kind: 'mvp' | 'cycle'; artifact_key: ArtifactKey; is_required: boolean};

const COLUMNS: {risk: RiskTier; kind: 'mvp' | 'cycle'}[] = RISK_TIERS.flatMap((risk) => [
  {risk, kind: 'mvp' as const},
  {risk, kind: 'cycle' as const}
]);

// The artifact matrix, admin only. A change applies to releases created after it;
// a release keeps the snapshot it was created with.
export default function ArtifactPolicyTable({rows}: {rows: PolicyRow[]}) {
  const t = useTranslations('governance');
  const [state, setState] = useState(rows);
  const [error, setError] = useState<string | null>(null);
  const required = (risk: RiskTier, kind: 'mvp' | 'cycle', key: ArtifactKey) =>
    state.some((row) => row.risk_tier === risk && row.kind === kind && row.artifact_key === key && row.is_required);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{t('policy.hint')}</p>
      <div className="overflow-x-auto rounded-lg border border-hairline bg-panel">
        <table className="w-full min-w-[760px] text-xs">
          <thead>
            <tr className="border-b border-hairline bg-raised/30 text-[10px] uppercase tracking-wider text-faint">
              <th className="px-3 py-2.5 text-start font-medium">{t('policy.artifact')}</th>
              {COLUMNS.map((column) => (
                <th key={`${column.risk}-${column.kind}`} className="px-2 py-2.5 text-center font-medium">
                  {t(`risk.${column.risk}`)} · {t(`kind.${column.kind}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ARTIFACT_KEYS.map((key) => (
              <tr key={key} className="border-b border-hairline last:border-0">
                <td className="px-3 py-2">
                  <span className="text-ink">{t(`artifacts.${key}`)}</span>
                  <span className="ms-2 font-mono text-[10px] text-faint">{t(`stage.${ARTIFACT_STAGE[key]}`)}</span>
                </td>
                {COLUMNS.map((column) => (
                  <td key={`${column.risk}-${column.kind}`} className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${t(`artifacts.${key}`)} · ${t(`risk.${column.risk}`)} · ${t(`kind.${column.kind}`)}`}
                      checked={required(column.risk, column.kind, key)}
                      onChange={async (event) => {
                        const next = event.target.checked;
                        setError(null);
                        setState((current) =>
                          current.map((row) =>
                            row.risk_tier === column.risk && row.kind === column.kind && row.artifact_key === key
                              ? {...row, is_required: next}
                              : row
                          )
                        );
                        const result = await setArtifactPolicyAction({
                          riskTier: column.risk,
                          kind: column.kind,
                          artifactKey: key,
                          required: next
                        });
                        if (!result.ok) {
                          setError(result.error);
                          setState((current) =>
                            current.map((row) =>
                              row.risk_tier === column.risk && row.kind === column.kind && row.artifact_key === key
                                ? {...row, is_required: !next}
                                : row
                            )
                          );
                        }
                      }}
                      className="accent-accent"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? <p role="alert" className="text-xs text-danger">{t(`errors.${error}`)}</p> : null}
    </div>
  );
}
