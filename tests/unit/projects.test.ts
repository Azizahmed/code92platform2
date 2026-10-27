import {describe, expect, it} from 'vitest';

import {
  isProjectPhase,
  PROJECT_PHASES,
  PROJECT_STALE_DAYS,
  requiresOutcomeNote
} from '@/lib/projects';

// Mirrors migrations/20261027102000_add-projects.sql. The SQL suite
// (tests/sql/70_projects.test.sql) checks the same rules in the database.
describe('project phases', () => {
  it('runs from Kickoff to Closed in order', () => {
    expect(PROJECT_PHASES).toEqual(['kickoff', 'discovery', 'delivery', 'handover', 'closed']);
  });

  it('asks for an outcome only when closing', () => {
    expect(PROJECT_PHASES.filter(requiresOutcomeNote)).toEqual(['closed']);
  });

  it('recognises phases and rejects everything else', () => {
    expect(isProjectPhase('delivery')).toBe(true);
    expect(isProjectPhase('constructor')).toBe(false);
  });

  it('flags a project quiet for two weeks', () => {
    expect(PROJECT_STALE_DAYS).toBe(14);
  });
});
