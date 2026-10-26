import {describe, expect, it} from 'vitest';

import {
  DEAL_STAGES,
  isBackward,
  isStale,
  requiresOwnership,
  requiresReason,
  stageRank,
  staleFrom,
  type DealStage
} from '@/lib/sales/stages';

describe('stage rules (mirror of move_deal_stage)', () => {
  it('ranks stages in pipeline order with both closed stages last', () => {
    expect(DEAL_STAGES.map(stageRank)).toEqual([1, 2, 3, 4, 5, 6, 6]);
  });

  // Same matrix as tests/sql/20_sales_stages.test.sql.
  const pairs: [DealStage, DealStage][] = DEAL_STAGES.flatMap((from) =>
    DEAL_STAGES.filter((to) => to !== from).map((to) => [from, to] as [DealStage, DealStage])
  );

  it('covers all 42 transitions', () => {
    expect(pairs).toHaveLength(42);
  });

  it.each(pairs)('%s → %s reason rule', (from, to) => {
    const fromClosed = from === 'closed_won' || from === 'closed_lost';
    const expected = fromClosed || stageRank(to) < stageRank(from) || to === 'closed_lost';
    expect(requiresReason(from, to)).toBe(expected);
  });

  it('forward open moves and winning need no reason', () => {
    expect(requiresReason('lead', 'meeting')).toBe(false);
    expect(requiresReason('lead', 'negotiation')).toBe(false);
    expect(requiresReason('negotiation', 'closed_won')).toBe(false);
  });

  it('backward moves, reopening and losing need a reason', () => {
    expect(isBackward('proposal', 'meeting')).toBe(true);
    expect(requiresReason('closed_won', 'negotiation')).toBe(true);
    expect(requiresReason('closed_lost', 'closed_won')).toBe(true);
    expect(requiresReason('lead', 'closed_lost')).toBe(true);
  });

  it('only consultation wins need ownership', () => {
    expect(requiresOwnership('consultation', 'closed_won')).toBe(true);
    expect(requiresOwnership('product', 'closed_won')).toBe(false);
    expect(requiresOwnership('consultation', 'closed_lost')).toBe(false);
  });
});

describe('isStale (mirror of deal_overview.is_stale)', () => {
  const today = '2026-10-26';
  const now = new Date('2026-10-26T09:00:00Z');
  const base = {
    stage: 'proposal' as DealStage,
    next_action: 'Call',
    next_action_date: '2026-10-27',
    next_action_updated_at: '2026-10-25T09:00:00Z'
  };

  it('is not stale with a future next action', () => {
    expect(isStale(base, today, now)).toBe(false);
  });

  it('becomes stale only more than 7 days after the next-action date', () => {
    expect(isStale({...base, next_action_date: '2026-10-19'}, today, now)).toBe(false);
    expect(isStale({...base, next_action_date: '2026-10-18'}, today, now)).toBe(true);
    expect(staleFrom('2026-10-18')).toBe('2026-10-26');
  });

  it('is stale after 7+ days with no next action', () => {
    const none = {...base, next_action: null, next_action_date: null};
    expect(isStale({...none, next_action_updated_at: '2026-10-20T09:00:00Z'}, today, now)).toBe(false);
    expect(isStale({...none, next_action_updated_at: '2026-10-18T09:00:00Z'}, today, now)).toBe(true);
  });

  it('closed deals are never stale', () => {
    expect(isStale({...base, stage: 'closed_lost', next_action_date: '2026-01-01'}, today, now)).toBe(false);
  });
});
