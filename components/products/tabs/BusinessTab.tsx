import {getTranslations} from 'next-intl/server';

import BusinessDetailsForm from '@/components/business/BusinessDetailsForm';
import ChecklistPanel, {type ChecklistRow} from '@/components/business/ChecklistPanel';
import GatesCard, {type GateDecisionRow} from '@/components/business/GatesCard';
import StageStepper from '@/components/business/StageStepper';
import RelativeTime from '@/components/RelativeTime';
import {Link} from '@/i18n/navigation';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {isBusinessStage, type BusinessStage} from '@/lib/business-track';
import type {ProductOverviewRow} from '@/components/products/types';

type Member = {id: string; name: string};

// The business track of one product: where it stands, the gates, the funnel's
// checklists, the business details, and the documents and customers that belong
// to the business rather than to the build.
export default async function BusinessTab({
  product,
  members,
  founder,
  canManage,
  locale
}: {
  product: ProductOverviewRow;
  members: Member[];
  founder: boolean;
  canManage: boolean;
  locale: string;
}) {
  const t = await getTranslations('business');
  const insforge = await createInsForgeServerClient();
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const stage: BusinessStage = isBusinessStage(product.business_stage)
    ? product.business_stage
    : 'idea';

  const [checklist, decisions, transitions, documents, customers, origin, contacts] =
    await Promise.all([
      insforge.database
        .from('product_stage_checklist_items')
        .select('id, stage, label, default_key, done, done_at, done_by, position')
        .eq('product_id', product.id)
        .order('position', {ascending: true}),
      insforge.database
        .from('product_gate_decisions')
        .select('id, gate, decision, decided_on, decided_by, note, pmf_criteria, evidence, created_at')
        .eq('product_id', product.id)
        .order('created_at', {ascending: false}),
      insforge.database
        .from('business_stage_transitions')
        .select('id, from_stage, to_stage, reason, actor_id, created_at')
        .eq('product_id', product.id)
        .order('created_at', {ascending: false})
        .limit(8),
      insforge.database
        .from('knowledge_item_products')
        .select('knowledge_items(id, kind, title, archived_at)')
        .eq('product_id', product.id)
        .eq('track', 'business'),
      insforge.database
        .from('account_products')
        .select('account_id, since, accounts(name)')
        .eq('product_id', product.id)
        .order('since', {ascending: false}),
      insforge.database
        .from('project_products')
        .select('projects(id, name)')
        .eq('product_id', product.id)
        .limit(1),
      canManage
        ? insforge.database.from('contacts').select('id, name').order('name').limit(300)
        : Promise.resolve({data: [], error: null})
    ]);

  const checklistRows: ChecklistRow[] = ((checklist.data ?? []) as unknown as {
    id: string;
    stage: string;
    label: string;
    default_key: string | null;
    done: boolean;
    done_at: string | null;
    done_by: string | null;
  }[])
    .filter((row) => isBusinessStage(row.stage))
    .map((row) => ({
      id: row.id,
      stage: row.stage as BusinessStage,
      label: row.label,
      default_key: row.default_key,
      done: row.done,
      done_at: row.done_at,
      done_by_name: row.done_by ? memberName.get(row.done_by) ?? null : null
    }));

  const decisionRows: GateDecisionRow[] = ((decisions.data ?? []) as unknown as {
    id: string;
    gate: 1 | 2;
    decision: 'go' | 'no_go';
    decided_on: string;
    decided_by: string;
    note: string;
    pmf_criteria: string | null;
    evidence: string | null;
    created_at: string;
  }[]).map((row) => ({
    id: row.id,
    gate: row.gate,
    decision: row.decision,
    decided_on: row.decided_on,
    decided_by_name: memberName.get(row.decided_by) ?? null,
    note: row.note,
    pmf_criteria: row.pmf_criteria,
    evidence: row.evidence,
    created_at: row.created_at
  }));

  const docs = ((documents.data ?? []) as unknown as {
    knowledge_items: {id: string; kind: string; title: string; archived_at: string | null} | null;
  }[])
    .map((row) => row.knowledge_items)
    .filter((item): item is {id: string; kind: string; title: string; archived_at: string | null} =>
      item !== null && item.archived_at === null
    );

  const customerRows = ((customers.data ?? []) as unknown as {
    account_id: string;
    since: string;
    accounts: {name: string} | null;
  }[]);

  const originProject = ((origin.data ?? []) as unknown as {
    projects: {id: string; name: string} | null;
  }[])[0]?.projects ?? null;

  const contactOptions = ((contacts.data ?? []) as unknown as {id: string; name: string}[]).map(
    (row) => ({id: row.id, name: row.name})
  );

  const dateFormat = new Intl.DateTimeFormat(locale, {year: 'numeric', month: 'short', day: 'numeric'});

  return (
    <div className="space-y-6">
      <StageStepper
        productId={product.id}
        productName={product.name}
        stage={stage}
        canManage={canManage}
        operatorName={product.operator_name}
        gate1Outcome={product.gate1_go === null ? null : product.gate1_go ? 'go' : 'no_go'}
        gate2Outcome={product.gate2_go === null ? null : product.gate2_go ? 'go' : 'no_go'}
      />

      {originProject ? (
        <p className="text-xs text-muted">
          {t('origin.from')}{' '}
          <Link href={`/projects/${originProject.id}`} className="text-accent hover:underline">
            {originProject.name}
          </Link>
        </p>
      ) : null}

      <GatesCard
        productId={product.id}
        productName={product.name}
        stage={stage}
        founder={founder}
        decisions={decisionRows}
        locale={locale}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="space-y-3 rounded-lg border border-hairline bg-panel p-4">
          <h2 className="text-sm font-medium">{t('details.title')}</h2>
          <BusinessDetailsForm
            productId={product.id}
            initial={{
              origination: product.origination,
              ownership: product.ownership,
              code92EquityPct: product.code92_equity_pct,
              operatorName: product.operator_name,
              operatorUserId: product.operator_user_id,
              operatorContactId: product.operator_contact_id,
              businessOwnerId: product.business_owner_id,
              sector: product.sector
            }}
            members={members.map((m) => ({id: m.id, name: m.name}))}
            contacts={contactOptions}
            canEdit={canManage}
          />
        </section>

        <div className="space-y-6">
          <section className="space-y-3 rounded-lg border border-hairline bg-panel p-4">
            <h2 className="text-sm font-medium">{t('customers.title')}</h2>
            {customerRows.length === 0 ? (
              <p className="text-xs text-faint">{t('customers.empty')}</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {customerRows.map((row) => (
                  <li key={row.account_id} className="flex items-center justify-between gap-2">
                    <Link href={`/sales/accounts/${row.account_id}`} className="truncate text-ink hover:text-accent">
                      {row.accounts?.name ?? '—'}
                    </Link>
                    <span className="shrink-0 text-faint">{dateFormat.format(new Date(row.since))}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3 rounded-lg border border-hairline bg-panel p-4">
            <h2 className="text-sm font-medium">{t('documents.title')}</h2>
            <p className="text-[11px] text-faint">{t('documents.hint')}</p>
            {docs.length === 0 ? (
              <p className="text-xs text-faint">{t('documents.empty')}</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {docs.map((doc) => (
                  <li key={doc.id}>
                    <Link href={`/knowledge/${doc.id}`} className="truncate text-ink hover:text-accent">
                      {doc.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3 rounded-lg border border-hairline bg-panel p-4">
            <h2 className="text-sm font-medium">{t('history.title')}</h2>
            {((transitions.data ?? []) as unknown as {
              id: string;
              from_stage: string;
              to_stage: string;
              reason: string | null;
              actor_id: string;
              created_at: string;
            }[]).length === 0 ? (
              <p className="text-xs text-faint">{t('history.empty')}</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {((transitions.data ?? []) as unknown as {
                  id: string;
                  from_stage: string;
                  to_stage: string;
                  reason: string | null;
                  actor_id: string;
                  created_at: string;
                }[]).map((row) => (
                  <li key={row.id} className="space-y-0.5">
                    <p className="text-ink">
                      {t(`stages.${row.from_stage}`)} → {t(`stages.${row.to_stage}`)}
                    </p>
                    <p className="text-faint">
                      {memberName.get(row.actor_id) ?? '—'} · <RelativeTime date={row.created_at} />
                    </p>
                    {row.reason ? <p className="text-muted">{row.reason}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <ChecklistPanel
        productId={product.id}
        currentStage={stage}
        rows={checklistRows}
        canEdit={canManage}
      />
    </div>
  );
}
