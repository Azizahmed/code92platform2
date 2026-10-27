import {getTranslations} from 'next-intl/server';

import ProjectsList from '@/components/projects/ProjectsList';
import {Link} from '@/i18n/navigation';
import {requireActiveMember} from '@/lib/auth';
import {createInsForgeServerClient} from '@/lib/insforge/server';
import {PROJECT_PHASES, type ProjectOverview, type ProjectPhase} from '@/lib/projects';

// The engagements the team is delivering, filtered by owner, account and phase.
// Filters are query parameters, so a dashboard strip can link straight to one.
export default async function ProjectsPage({
  params,
  searchParams
}: {
  params: Promise<{locale: string}>;
  searchParams: Promise<{owner?: string; account?: string; phase?: string; stale?: string}>;
}) {
  const {locale} = await params;
  const filters = await searchParams;
  await requireActiveMember();
  const t = await getTranslations('projects');
  const insforge = await createInsForgeServerClient();

  let query = insforge.database
    .from('project_overview')
    .select('*')
    .order('last_activity_at', {ascending: false});
  if (filters.owner) query = query.eq('owner_id', filters.owner);
  if (filters.account) query = query.eq('account_id', filters.account);
  if (filters.phase && (PROJECT_PHASES as readonly string[]).includes(filters.phase)) {
    query = query.eq('phase', filters.phase);
  }
  if (filters.stale === '1') query = query.eq('is_stale', true);

  const [{data: projects}, {data: members}, {data: accounts}] = await Promise.all([
    query,
    insforge.database.from('team_members').select('user_id, display_name').eq('is_active', true).order('display_name'),
    insforge.database.from('accounts').select('id, name').is('archived_at', null).order('name')
  ]);

  const phaseFilters: (ProjectPhase | 'all')[] = ['all', ...PROJECT_PHASES];
  const hrefWith = (next: Record<string, string | null>) => {
    const merged = {...filters, ...next} as Record<string, string | undefined | null>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return query ? `?${query}` : '?';
  };

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t('list.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('list.subtitle')}</p>
        </div>
        <Link href="/projects/new" className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg">
          {t('list.new')}
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {phaseFilters.map((phase) => {
          const active = phase === 'all' ? !filters.phase : filters.phase === phase;
          return (
            <Link
              key={phase}
              href={hrefWith({phase: phase === 'all' ? null : phase})}
              className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                active ? 'border-accent/40 bg-accent/10 text-accent' : 'border-hairline text-muted hover:bg-raised hover:text-ink'
              }`}
            >
              {phase === 'all' ? t('list.allPhases') : t(`phases.${phase}`)}
            </Link>
          );
        })}
        <Link
          href={hrefWith({stale: filters.stale === '1' ? null : '1'})}
          className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
            filters.stale === '1' ? 'border-amber/40 bg-amber/10 text-amber' : 'border-hairline text-muted hover:bg-raised hover:text-ink'
          }`}
        >
          {t('list.staleOnly')}
        </Link>
        <form className="ms-auto flex flex-wrap items-center gap-2">
          {filters.phase ? <input type="hidden" name="phase" value={filters.phase} /> : null}
          {filters.stale ? <input type="hidden" name="stale" value={filters.stale} /> : null}
          <select name="owner" defaultValue={filters.owner ?? ''} aria-label={t('list.filterOwner')} className="rounded-md border border-hairline bg-bg px-2 py-1.5 text-xs">
            <option value="">{t('list.anyOwner')}</option>
            {(members ?? []).map((m) => (
              <option key={m.user_id as string} value={m.user_id as string}>{m.display_name as string}</option>
            ))}
          </select>
          <select name="account" defaultValue={filters.account ?? ''} aria-label={t('list.filterAccount')} className="rounded-md border border-hairline bg-bg px-2 py-1.5 text-xs">
            <option value="">{t('list.anyAccount')}</option>
            {(accounts ?? []).map((a) => (
              <option key={a.id as string} value={a.id as string}>{a.name as string}</option>
            ))}
          </select>
          <button type="submit" className="rounded-md border border-hairline px-2.5 py-1.5 text-xs text-muted hover:bg-raised hover:text-ink">
            {t('list.apply')}
          </button>
        </form>
      </div>

      <ProjectsList projects={(projects ?? []) as unknown as ProjectOverview[]} locale={locale} />
    </section>
  );
}
