import {getTranslations} from 'next-intl/server';

import AttentionList, {type AttentionRow} from '@/components/dashboard/AttentionList';
import Strip, {type StripCell} from '@/components/dashboard/Strip';
import {requireActiveMember} from '@/lib/auth';
import {BUSINESS_STAGES} from '@/lib/business-track';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {PROJECT_PHASES} from '@/lib/projects';
import {RELEASE_STAGES} from '@/lib/releases';

type Strips = {
  products: Record<string, number> & {gate1Pending: number; gate2Pending: number};
  releases: Record<string, number> & {overdue: number};
  projects: Record<string, number> & {stale: number};
  sales: Record<string, number> & {openValueKwd: number; closingThisMonth: number; stale: number};
};

// The dashboard is the funnel and the loop at a glance: where every product sits,
// what every release is waiting on, which engagements have gone quiet, and the
// pipeline. Each count links to the list behind it.
export default async function DashboardPage() {
  const insforge = await createInsForgeServerClient();
  const [, t, {data: strips}, {data: attention}] = await Promise.all([
    requireActiveMember(),
    getTranslations('dashboard'),
    insforge.database.rpc('dashboard_strips'),
    insforge.database.rpc('dashboard_attention')
  ]);
  const s = (strips ?? {}) as unknown as Strips;
  const attentionRows = ((attention ?? []) as unknown as AttentionRow[]);

  const productCells: StripCell[] = [
    ...BUSINESS_STAGES.map((stage) => ({
      label: t(`strips.stage.${stage}`),
      value: s.products?.[stage] ?? 0,
      href: `/products?business_stage=${stage}`
    })),
    {
      label: t('strips.gatesPending'),
      value: (s.products?.gate1Pending ?? 0) + (s.products?.gate2Pending ?? 0),
      href: '/governance',
      tone: 'attention'
    }
  ];

  const releaseCells: StripCell[] = [
    ...RELEASE_STAGES.map((stage) => ({
      label: t(`strips.releaseStage.${stage}`),
      value: s.releases?.[stage] ?? 0,
      href: '/releases'
    })),
    {label: t('strips.overdue'), value: s.releases?.overdue ?? 0, href: '/releases', tone: 'attention'}
  ];

  const projectCells: StripCell[] = [
    ...PROJECT_PHASES.filter((phase) => phase !== 'closed').map((phase) => ({
      label: t(`strips.phase.${phase}`),
      value: s.projects?.[phase] ?? 0,
      href: `/projects?phase=${phase}`
    })),
    {label: t('strips.stale'), value: s.projects?.stale ?? 0, href: '/projects?stale=1', tone: 'attention'}
  ];

  const salesCells: StripCell[] = [
    {label: t('strips.deals.lead'), value: s.sales?.lead ?? 0, href: '/sales'},
    {label: t('strips.deals.meeting'), value: s.sales?.meeting ?? 0, href: '/sales'},
    {label: t('strips.deals.discovery_demo'), value: s.sales?.discovery_demo ?? 0, href: '/sales'},
    {label: t('strips.deals.proposal'), value: s.sales?.proposal ?? 0, href: '/sales'},
    {label: t('strips.deals.negotiation'), value: s.sales?.negotiation ?? 0, href: '/sales'},
    {label: t('strips.deals.stale'), value: s.sales?.stale ?? 0, href: '/sales', tone: 'attention'}
  ];

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </header>

      <Strip title={t('strips.productsTitle')} cells={productCells} />
      <Strip
        title={t('strips.releasesTitle')}
        cells={releaseCells}
        footnote={t('strips.releasesFootnote')}
      />
      <Strip title={t('strips.projectsTitle')} cells={projectCells} />
      <Strip
        title={t('strips.salesTitle')}
        cells={salesCells}
        footnote={t('strips.salesFootnote', {
          value: Math.round(Number(s.sales?.openValueKwd ?? 0)).toLocaleString(),
          closing: s.sales?.closingThisMonth ?? 0
        })}
      />

      <div className="space-y-3">
        <h2 className="text-sm font-medium">{t('attention.title')}</h2>
        <AttentionList rows={attentionRows} />
      </div>
    </section>
  );
}
