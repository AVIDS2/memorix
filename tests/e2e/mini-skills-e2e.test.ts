/**
 * End-to-end test for mini-skills using a temporary directory with synthetic data.
 * Tests the full lifecycle: promote → list → inject → delete.
 * Never touches real ~/.memorix/data/.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  promoteToMiniSkill,
  loadAllMiniSkills,
  deleteMiniSkill,
  formatMiniSkillsForInjection,
} from '../../src/skills/mini-skills.js';
import { saveObservationsJson, loadObservationsJson } from '../../src/store/persistence.js';
import { initMiniSkillStore, resetMiniSkillStore } from '../../src/store/mini-skill-store.js';

/** Synthetic observations for testing — never touches real user data */
const SYNTHETIC_OBSERVATIONS = [
  {
    id: 1,
    entityName: 'test-module',
    type: 'gotcha',
    title: 'Windows EPERM on file locks',
    narrative: 'On Windows, O_CREAT|O_EXCL can return EPERM instead of EEXIST.',
    facts: ['Treat EPERM same as EEXIST in acquireLock()', 'Only affects Windows NTFS'],
    filesModified: ['src/store/file-lock.ts'],
    concepts: ['file-locking', 'windows', 'cross-platform'],
    tokens: 42,
    createdAt: '2026-03-01T10:00:00Z',
    projectId: 'test/mini-skills-e2e',
    status: 'active',
  },
  {
    id: 2,
    entityName: 'auth-flow',
    type: 'decision',
    title: 'Use advisory locks over OS-level locks',
    narrative: 'Advisory .lock files are simpler and more portable than OS-level mandatory locks.',
    facts: ['Lock files contain PID and timestamp', 'Stale after 10s TTL'],
    filesModified: [],
    concepts: ['architecture', 'locking'],
    tokens: 38,
    createdAt: '2026-03-02T14:00:00Z',
    projectId: 'test/mini-skills-e2e',
    status: 'active',
  },
];

describe('mini-skills e2e (isolated temp dir)', () => {
  let tmpDir: string;
  let createdSkillId: number | null = null;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-e2e-'));
    await saveObservationsJson(tmpDir, SYNTHETIC_OBSERVATIONS);
    resetMiniSkillStore();
    await initMiniSkillStore(tmpDir);
  });

  afterAll(async () => {
    resetMiniSkillStore();
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('should load synthetic observations from temp dir', async () => {
    const obs = await loadObservationsJson(tmpDir) as any[];
    expect(obs.length).toBe(SYNTHETIC_OBSERVATIONS.length);
    expect(obs[0].title).toBe('Windows EPERM on file locks');
  });

  it('should promote an observation to mini-skill', async () => {
    const obs = await loadObservationsJson(tmpDir) as any[];
    const candidate = obs[0];

    const skill = await promoteToMiniSkill(
      tmpDir,
      candidate.projectId,
      [candidate],
      { trigger: 'E2E test trigger', instruction: 'E2E test instruction' },
    );

    createdSkillId = skill.id;

    expect(skill.id).toBeGreaterThan(0);
    expect(skill.title).toBeTruthy();
    expect(skill.sourceObservationIds).toContain(candidate.id);
  });

  it('should list mini-skills', async () => {
    const skills = await loadAllMiniSkills(tmpDir);
    expect(skills.length).toBeGreaterThan(0);
  });

  it('should format mini-skills for session injection', async () => {
    const skills = await loadAllMiniSkills(tmpDir);
    expect(skills.length).toBeGreaterThan(0);

    const formatted = formatMiniSkillsForInjection(skills);
    expect(formatted).toContain('Project Mini-Skills');
    expect(formatted).toContain('**Do**:');
    expect(formatted).toContain('**When**:');
  });

  it('should delete a mini-skill', async () => {
    expect(createdSkillId).not.toBeNull();

    const deleted = await deleteMiniSkill(tmpDir, createdSkillId!);
    expect(deleted).toBe(true);

    const remaining = await loadAllMiniSkills(tmpDir);
    const stillExists = remaining.find(s => s.id === createdSkillId);
    expect(stillExists).toBeUndefined();
  });
});
