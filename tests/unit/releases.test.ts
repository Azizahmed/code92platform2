import {describe, expect, it} from 'vitest';

import {
  ARTIFACT_KEYS,
  ARTIFACT_STAGE,
  CARRY_KEYS,
  canManageRelease,
  exitTargets,
  GAP_FINDINGS_CLOSED,
  GAP_LINK,
  GAP_SPEC_APPROVAL,
  GAP_TEST_PASS,
  isArtifactKey,
  isWaivableGap,
  needsAdminToMove,
  OPEN_TASKS_GAP,
  RELEASE_STAGES,
  releaseKind,
  releaseStageIndex,
  requiredChecks,
  statusForStage
} from '@/lib/releases';

// Mirrors migrations/20261027101000_add-release-loop.sql. The SQL suite
// (tests/sql/60_release_loop.test.sql) checks the same rules in the database.
describe('the six stages', () => {
  it('orders the stages and maps each to the status it shows', () => {
    expect(RELEASE_STAGES.map(releaseStageIndex)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(RELEASE_STAGES.map(statusForStage)).toEqual([
      'planned',
      'in_progress',
      'in_progress',
      'in_progress',
      'ready',
      'released'
    ]);
  });
});

describe('artifacts', () => {
  it('gives every key exactly one stage, and every stage is reachable', () => {
    expect(ARTIFACT_KEYS).toHaveLength(14);
    for (const key of ARTIFACT_KEYS) {
      expect(RELEASE_STAGES).toContain(ARTIFACT_STAGE[key]);
    }
    expect(new Set(Object.values(ARTIFACT_STAGE))).toEqual(new Set(RELEASE_STAGES));
  });

  it('recognises keys and rejects everything else, including prototype names', () => {
    expect(isArtifactKey('pull_request')).toBe(true);
    expect(isArtifactKey('pull')).toBe(false);
    expect(isArtifactKey('toString')).toBe(false);
  });

  it('carries incidents, metrics and runbooks into the next intent', () => {
    expect(CARRY_KEYS.every((key) => ['incident', 'metric', 'runbook'].includes(key))).toBe(true);
  });
});

describe('gaps', () => {
  it('lets only checks and open work be waived', () => {
    expect(isWaivableGap('qa_signoff')).toBe(true);
    expect(isWaivableGap(OPEN_TASKS_GAP)).toBe(true);
    for (const gap of [GAP_LINK, GAP_SPEC_APPROVAL, GAP_TEST_PASS, GAP_FINDINGS_CLOSED, 'spec', 'release_tag']) {
      expect(isWaivableGap(gap)).toBe(false);
    }
  });
});

describe('release kinds and checks', () => {
  it('makes release zero the MVP and every later release a cycle', () => {
    expect(releaseKind(0)).toBe('mvp');
    expect(releaseKind(1)).toBe('cycle');
    expect(releaseKind(7)).toBe('cycle');
  });

  it('asks more of high-risk releases', () => {
    expect(requiredChecks('low')).toHaveLength(1);
    expect(requiredChecks('medium')).toHaveLength(3);
    expect(requiredChecks('high')).toHaveLength(5);
  });
});

describe('exits from the loop', () => {
  it('cancels, rolls back and reopens; nothing else is a status a person picks', () => {
    expect(exitTargets('planned')).toEqual(['cancelled']);
    expect(exitTargets('ready')).toEqual(['cancelled']);
    expect(exitTargets('released')).toEqual(['rolled_back']);
    expect(exitTargets('rolled_back')).toEqual(['in_progress']);
    expect(exitTargets('cancelled')).toEqual(['planned']);
  });
});

describe('who may move a release', () => {
  it('lets the owner and admins manage, and nobody on an archived product', () => {
    const base = {riskTier: 'medium' as const, isOwner: true, isAdmin: false, isArchived: false};
    expect(canManageRelease(base)).toBe(true);
    expect(canManageRelease({...base, isOwner: false})).toBe(false);
    expect(canManageRelease({...base, isOwner: false, isAdmin: true})).toBe(true);
    expect(canManageRelease({...base, isArchived: true})).toBe(false);
  });

  it('keeps high-risk moves for admins', () => {
    expect(needsAdminToMove('high', false)).toBe(true);
    expect(needsAdminToMove('high', true)).toBe(false);
    expect(needsAdminToMove('medium', false)).toBe(false);
  });
});
