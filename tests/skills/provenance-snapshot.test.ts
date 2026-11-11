/**
 * Provenance Snapshot & Promotion Validation — Phase 3a
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promoteToMiniSkill, resolveProvenanceStatus, resolveKnowledgeLayer, miniSkillToDocument } from '../../src/skills/mini-skills.js';
import { initMiniSkillStore, resetMiniSkillStore } from '../../src/store/mini-skill-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';
import type { Observation, MiniSkill, SourceSnapshot } from '../../src/types.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── Test helpers ─────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memorix-p3a-'));
}

function makeObs(overrides: Partial<Observation> & { id: number; entityName: string; projectId: string }): Observation {
  return {
    type: 'decision',
    title: `Test obs #${overrides.id}`,
    narrative: 'A test narrative with real content',
    facts: ['Fact one', 'Fact two'],
    filesModified: [],
    concepts: ['testing'],
    tokens: 50,
    createdAt: new Date().toISOString(),
    status: 'active',
    source: 'agent',
    hasCausalLanguage: false,
    revisionCount: 1,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('Source Snapshot Creation', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = makeTempDir();
    await initMiniSkillStore(dataDir);
  });

  afterEach(() => {
    resetMiniSkillStore();
    closeAllDatabases();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('promoteToMiniSkill creates sourceSnapshot with correct structure', async () => {
    const obs = makeObs({ id: 1, entityName: 'auth', projectId: 'test/proj' });
    const skill = await promoteToMiniSkill(dataDir, 'test/proj', [obs]);

    expect(skill.sourceSnapshot).toBeDefined();
    expect(skill.sourceSnapshot).not.toBe('');

    const snapshot: SourceSnapshot = JSON.parse(skill.sourceSnapshot!);
    expect(snapshot.promotedAt).toBeDefined();
    expect(snapshot.observations).toHaveLength(1);

    const snapObs = snapshot.observations[0];
    expect(snapObs.id).toBe(1);
    expect(snapObs.title).toBe(obs.title);
    expect(snapObs.type).toBe('decision');
    expect(snapObs.narrative).toBe(obs.narrative);
    expect(snapObs.facts).toEqual(['Fact one', 'Fact two']);
    expect(snapObs.entityName).toBe('auth');
    expect(snapObs.projectId).toBe('test/proj');
    expect(snapObs.createdAt).toBe(obs.createdAt);
  });

  it('sourceSnapshot preserves sourceDetail=explicit', async () => {
    const obs = makeObs({ id: 1, entityName: 'auth', projectId: 'test/proj', sourceDetail: 'explicit' as any });
    const skill = await promoteToMiniSkill(dataDir, 'test/proj', [obs]);
    const snapshot: SourceSnapshot = JSON.parse(skill.sourceSnapshot!);
    expect(snapshot.observations[0].sourceDetail).toBe('explicit');
  });

  it('sourceSnapshot preserves sourceDetail=hook', async () => {
    const obs = makeObs({ id: 1, entityName: 'auth', projectId: 'test/proj', sourceDetail: 'hook' as any });
    const skill = await promoteToMiniSkill(dataDir, 'test/proj', [obs]);
    const snapshot: SourceSnapshot = JSON.parse(skill.sourceSnapshot!);
    expect(snapshot.observations[0].sourceDetail).toBe('hook');
  });

  it('sourceSnapshot preserves sourceDetail=git-ingest', async () => {
    const obs = makeObs({ id: 1, entityName: 'auth', projectId: 'test/proj', sourceDetail: 'git-ingest' as any, source: 'git' });
    const skill = await promoteToMiniSkill(dataDir, 'test/proj', [obs]);
    const snapshot: SourceSnapshot = JSON.parse(skill.sourceSnapshot!);
    expect(snapshot.observations[0].sourceDetail).toBe('git-ingest');
  });

  it('sourceSnapshot omits sourceDetail when undefined', async () => {
    const obs = makeObs({ id: 1, entityName: 'auth', projectId: 'test/proj' });
    const skill = await promoteToMiniSkill(dataDir, 'test/proj', [obs]);
    const snapshot: SourceSnapshot = JSON.parse(skill.sourceSnapshot!);
    expect(snapshot.observations[0].sourceDetail).toBeUndefined();
  });

  it('sourceSnapshot contains all source observations for multi-obs promote', async () => {
    const obs1 = makeObs({ id: 10, entityName: 'db', projectId: 'test/proj', sourceDetail: 'explicit' as any });
    const obs2 = makeObs({ id: 11, entityName: 'db', projectId: 'test/proj', title: 'Second obs', sourceDetail: 'git-ingest' as any, source: 'git' });
    const skill = await promoteToMiniSkill(dataDir, 'test/proj', [obs1, obs2]);

    const snapshot: SourceSnapshot = JSON.parse(skill.sourceSnapshot!);
    expect(snapshot.observations).toHaveLength(2);
    expect(snapshot.observations[0].id).toBe(10);
    expect(snapshot.observations[0].sourceDetail).toBe('explicit');
    expect(snapshot.observations[1].id).toBe(11);
    expect(snapshot.observations[1].sourceDetail).toBe('git-ingest');
  });

  it('updatedAt is set at creation time', async () => {
    const obs = makeObs({ id: 1, entityName: 'auth', projectId: 'test/proj' });
    const skill = await promoteToMiniSkill(dataDir, 'test/proj', [obs]);

    expect(skill.updatedAt).toBeDefined();
    expect(skill.updatedAt).toBe(skill.createdAt);
  });
});

describe('Promotion Validation', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = makeTempDir();
    await initMiniSkillStore(dataDir);
  });

  afterEach(() => {
    resetMiniSkillStore();
    closeAllDatabases();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('R1a: rejects empty observation array', async () => {
    await expect(promoteToMiniSkill(dataDir, 'test/proj', [])).rejects.toThrow('no source observations provided');
  });

  it('R1b: rejects archived observations', async () => {
    const obs = makeObs({ id: 1, entityName: 'auth', projectId: 'test/proj', status: 'archived' as any });
    await expect(promoteToMiniSkill(dataDir, 'test/proj', [obs])).rejects.toThrow('not active');
  });

  it('R1b: rejects resolved observations', async () => {
    const obs = makeObs({ id: 1, entityName: 'auth', projectId: 'test/proj', status: 'resolved' as any });
    await expect(promoteToMiniSkill(dataDir, 'test/proj', [obs])).rejects.toThrow('not active');
  });

  it('R1b: force=true does NOT bypass active-status gate', async () => {
    const obs = makeObs({ id: 1, entityName: 'auth', projectId: 'test/proj', status: 'archived' as any });
    await expect(promoteToMiniSkill(dataDir, 'test/proj', [obs], { force: true })).rejects.toThrow('not active');
  });

  it('R1b: rejects mixed active + non-active array', async () => {
    const active = makeObs({ id: 1, entityName: 'auth', projectId: 'test/proj' });
    const archived = makeObs({ id: 2, entityName: 'auth', projectId: 'test/proj', status: 'archived' as any });
    await expect(promoteToMiniSkill(dataDir, 'test/proj', [active, archived])).rejects.toThrow('not active');
  });

  it('R1b: active observations pass the gate', async () => {
    const obs = makeObs({ id: 1, entityName: 'auth', projectId: 'test/proj', status: 'active' as any });
    const skill = await promoteToMiniSkill(dataDir, 'test/proj', [obs]);
    expect(skill.id).toBeGreaterThan(0);
  });

  it('R2: rejects command-log observations', async () => {
    const obs = makeObs({ id: 1, entityName: 'cmd', projectId: 'test/proj', title: 'Ran: npx vitest run' });
    await expect(promoteToMiniSkill(dataDir, 'test/proj', [obs])).rejects.toThrow('command execution logs');
  });

  it('R2: force=true bypasses command-log check', async () => {
    const obs = makeObs({ id: 1, entityName: 'cmd', projectId: 'test/proj', title: 'Ran: npx vitest run' });
    const skill = await promoteToMiniSkill(dataDir, 'test/proj', [obs], { force: true });
    expect(skill.id).toBeGreaterThan(0);
  });

  it('R3: rejects observations with no content', async () => {
    const obs = makeObs({
      id: 1, entityName: 'empty', projectId: 'test/proj',
      narrative: '', facts: [],
    });
    await expect(promoteToMiniSkill(dataDir, 'test/proj', [obs])).rejects.toThrow('no substantive content');
  });

  it('R3: force=true bypasses content check', async () => {
    const obs = makeObs({
      id: 1, entityName: 'empty', projectId: 'test/proj',
      narrative: '', facts: [],
    });
    const skill = await promoteToMiniSkill(dataDir, 'test/proj', [obs], { force: true });
    expect(skill.id).toBeGreaterThan(0);
  });

  it('passes validation for normal observations', async () => {
    const obs = makeObs({ id: 1, entityName: 'auth', projectId: 'test/proj' });
    const skill = await promoteToMiniSkill(dataDir, 'test/proj', [obs]);
    expect(skill.id).toBeGreaterThan(0);
    expect(skill.sourceSnapshot).toBeDefined();
  });
});

describe('resolveProvenanceStatus', () => {
  const lookup = (existingIds: number[]) => (id: number) => {
    if (existingIds.includes(id)) return { id, status: 'active' };
    return undefined;
  };

  it('returns verified when all sources exist', () => {
    const skill: MiniSkill = {
      id: 1, sourceObservationIds: [10, 11], sourceEntity: 'e', title: 't',
      instruction: 'i', trigger: 'tr', facts: [], projectId: 'p', createdAt: '',
      usedCount: 0, tags: [], sourceSnapshot: '{"observations":[],"promotedAt":""}',
    };
    expect(resolveProvenanceStatus(skill, lookup([10, 11]))).toBe('verified');
  });

  it('returns partial when some sources exist', () => {
    const skill: MiniSkill = {
      id: 1, sourceObservationIds: [10, 11], sourceEntity: 'e', title: 't',
      instruction: 'i', trigger: 'tr', facts: [], projectId: 'p', createdAt: '',
      usedCount: 0, tags: [], sourceSnapshot: '{"observations":[],"promotedAt":""}',
    };
    expect(resolveProvenanceStatus(skill, lookup([10]))).toBe('partial');
  });

  it('returns snapshot-only when no sources exist but snapshot present', () => {
    const skill: MiniSkill = {
      id: 1, sourceObservationIds: [3588], sourceEntity: 'e', title: 't',
      instruction: 'i', trigger: 'tr', facts: [], projectId: 'p', createdAt: '',
      usedCount: 0, tags: [], sourceSnapshot: '{"observations":[{"id":3588}],"promotedAt":""}',
    };
    expect(resolveProvenanceStatus(skill, lookup([]))).toBe('snapshot-only');
  });

  it('returns legacy when no sources and no snapshot', () => {
    const skill: MiniSkill = {
      id: 1, sourceObservationIds: [3588], sourceEntity: 'e', title: 't',
      instruction: 'i', trigger: 'tr', facts: [], projectId: 'p', createdAt: '',
      usedCount: 0, tags: [],
    };
    expect(resolveProvenanceStatus(skill, lookup([]))).toBe('legacy');
  });

  it('returns snapshot-only for empty sourceObservationIds with snapshot', () => {
    const skill: MiniSkill = {
      id: 1, sourceObservationIds: [], sourceEntity: 'e', title: 't',
      instruction: 'i', trigger: 'tr', facts: [], projectId: 'p', createdAt: '',
      usedCount: 0, tags: [], sourceSnapshot: '{"observations":[],"promotedAt":""}',
    };
    expect(resolveProvenanceStatus(skill, lookup([]))).toBe('snapshot-only');
  });
});

describe('resolveKnowledgeLayer', () => {
  it('returns promoted for mini-skill', () => {
    expect(resolveKnowledgeLayer('mini-skill')).toBe('promoted');
  });

  it('returns evidence for git-ingest observation', () => {
    expect(resolveKnowledgeLayer('observation', 'git-ingest')).toBe('evidence');
  });

  it('returns evidence for source=git observation', () => {
    expect(resolveKnowledgeLayer('observation', undefined, 'git')).toBe('evidence');
  });

  it('returns project-truth for explicit observation', () => {
    expect(resolveKnowledgeLayer('observation', 'explicit', 'agent')).toBe('project-truth');
  });

  it('returns project-truth for hook observation', () => {
    expect(resolveKnowledgeLayer('observation', 'hook', 'agent')).toBe('project-truth');
  });

  it('returns project-truth for legacy observation without sourceDetail', () => {
    expect(resolveKnowledgeLayer('observation')).toBe('project-truth');
  });
});

describe('miniSkillToDocument', () => {
  it('produces a MemorixDocument with correct fields', () => {
    const skill: MiniSkill = {
      id: 5, sourceObservationIds: [1], sourceEntity: 'auth', title: 'Use JWT',
      instruction: 'Always use JWT for API auth', trigger: 'When building APIs',
      facts: ['JWT is stateless', 'Use RS256'], projectId: 'test/proj',
      createdAt: '2026-01-01T00:00:00Z', usedCount: 3, tags: ['auth', 'jwt'],
    };

    const doc = miniSkillToDocument(skill);

    expect(doc.id).toBe('skill:test%2Fproj:5');
    expect(doc.documentType).toBe('mini-skill');
    expect(doc.knowledgeLayer).toBe('promoted');
    expect(doc.type).toBe('mini-skill');
    expect(doc.title).toBe('Use JWT');
    expect(doc.narrative).toBe('Always use JWT for API auth');
    expect(doc.facts).toBe('JWT is stateless\nUse RS256');
    expect(doc.entityName).toBe('auth');
    expect(doc.projectId).toBe('test/proj');
    expect(doc.accessCount).toBe(3);
    expect(doc.valueCategory).toBe('core');
  });
});
