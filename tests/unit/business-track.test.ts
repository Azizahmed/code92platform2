import {describe, expect, it} from 'vitest';

import {
  BUSINESS_STAGES,
  CHECKLIST_DEFAULTS,
  businessStageIndex,
  gateWaitingAt,
  movementBlockers,
  nextBusinessStage
} from '@/lib/business-track';

// Mirrors migrations/20261027100000_add-business-track.sql. The SQL suite
// (tests/sql/50_business_track.test.sql) checks the same rules in the database.
describe('the funnel', () => {
  it('orders the six stages and numbers them from one', () => {
    expect(BUSINESS_STAGES.map(businessStageIndex)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('moves one step at a time and stops at Board', () => {
    expect(nextBusinessStage('idea')).toBe('concept');
    expect(nextBusinessStage('venture')).toBe('company');
    expect(nextBusinessStage('board')).toBeNull();
  });

  it('waits on Gate 1 at Concept and Gate 2 at Venture only', () => {
    expect(BUSINESS_STAGES.map(gateWaitingAt)).toEqual([null, 1, null, 2, null, null]);
  });
});

describe('what a forward move still needs', () => {
  const base = {operatorName: 'Sara', gate1Outcome: null, gate2Outcome: null} as const;

  it('needs nothing for Idea to Concept', () => {
    expect(movementBlockers({...base, from: 'idea', to: 'concept', operatorName: null})).toEqual([]);
  });

  it('needs an operator and a go for Gate 1', () => {
    expect(movementBlockers({from: 'concept', to: 'build', operatorName: null, gate1Outcome: null, gate2Outcome: null}))
      .toEqual(['operator', 'gate1Go']);
    expect(movementBlockers({...base, from: 'concept', to: 'build', gate1Outcome: null})).toEqual(['gate1Go']);
    expect(movementBlockers({...base, from: 'concept', to: 'build', gate1Outcome: 'no_go'})).toEqual(['gate1Go']);
    expect(movementBlockers({...base, from: 'concept', to: 'build', gate1Outcome: 'go'})).toEqual([]);
  });

  it('treats a blank operator name as no operator', () => {
    expect(movementBlockers({from: 'concept', to: 'build', operatorName: '   ', gate1Outcome: 'go', gate2Outcome: null}))
      .toEqual(['operator']);
  });

  it('needs a PMF go for Gate 2 and nothing for Build to Venture', () => {
    expect(movementBlockers({...base, from: 'venture', to: 'company', gate2Outcome: null})).toEqual(['gate2Go']);
    expect(movementBlockers({...base, from: 'venture', to: 'company', gate2Outcome: 'go'})).toEqual([]);
    expect(movementBlockers({...base, from: 'build', to: 'venture'})).toEqual([]);
  });

  it('never blocks a backward move; the reason is asked for elsewhere', () => {
    expect(movementBlockers({...base, from: 'company', to: 'venture', gate2Outcome: null})).toEqual([]);
  });
});

describe('checklists', () => {
  it('seeds nineteen defaults, each stage with its own keys', () => {
    const all = BUSINESS_STAGES.flatMap((stage) => CHECKLIST_DEFAULTS[stage]);
    expect(all).toHaveLength(19);
    expect(new Set(all.map((item) => item.key)).size).toBe(19);
    expect(CHECKLIST_DEFAULTS.idea.map((item) => item.key)).toEqual([
      'problem_statement',
      'source',
      'first_screen_decision'
    ]);
  });
});
