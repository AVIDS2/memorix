import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  approveLongTermMemory,
  archiveLongTermMemory,
  createLongTermMemoryCandidate,
  createManualLongTermMemory,
  getLongTermMemoryDetail,
  listLongTermMemories,
  qualifyLongTermMemory,
  selectLongTermMemoriesForTask,
  supersedeLongTermMemory,
} from '../../src/memory/long-term.js';
import { resolveLocalMemoryOwner } from '../../src/memory/owner.js';
import { closeAllDatabases, getDatabase } from '../../src/store/sqlite-db.js';

let root: string | undefined;

function dataDir(): string {
  root = mkdtempSync(path.join(tmpdir(), 'memorix-long-term-'));
  return path.join(root, 'data');
}

afterEach(() => {
  closeAllDatabases();
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe('long-term memory architecture', () => {
  it('creates an additive, tracked SQLite migration without changing legacy storage', async () => {
    const dir = dataDir();
    const db = getDatabase(dir);
    const migration = db.prepare("SELECT id FROM schema_migrations WHERE id = '1.3-long-term-memory'").get();
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'long_term_memories'").get();

    expect(migration).toMatchObject({ id: '1.3-long-term-memory' });
    expect(table).toMatchObject({ name: 'long_term_memories' });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'observations'").get()).toMatchObject({ name: 'observations' });
  });

  it('does not inject a candidate until it is explicitly qualified', async () => {
    const dir = dataDir();
    const created = await createManualLongTermMemory({
      dataDir: dir,
      projectId: 'local/project-a',
      scope: 'project',
      kind: 'semantic',
      title: 'Release requires package smoke',
      content: 'Run the packed package smoke before publishing a release.',
      tags: ['release', 'package'],
      applicability: 'When preparing an npm release.',
    });

    expect((await selectLongTermMemoriesForTask({
      dataDir: dir,
      projectId: 'local/project-a',
      task: 'Prepare the npm release and run package smoke.',
    }))).toHaveLength(0);

    const qualified = await qualifyLongTermMemory({
      dataDir: dir,
      id: created.memory.id,
      reason: 'Checked against the focused package smoke gate.',
    });
    expect(qualified.state).toBe('qualified');

    const selected = await selectLongTermMemoriesForTask({
      dataDir: dir,
      projectId: 'local/project-a',
      task: 'Prepare the npm release and run package smoke.',
    });
    expect(selected).toEqual([
      expect.objectContaining({
        memory: expect.objectContaining({ id: created.memory.id, state: 'qualified' }),
      }),
    ]);
  });

  it('allows an explicitly portable user fact across projects but keeps project-bound user memory local', async () => {
    const dir = dataDir();
    const portable = await createManualLongTermMemory({
      dataDir: dir,
      projectId: 'local/project-a',
      scope: 'user',
      kind: 'semantic',
      portability: 'portable',
      title: 'Prefer focused verification before release',
      content: 'The local user prefers a focused test and package smoke before every release.',
      tags: ['release', 'verification'],
      applicability: 'When the task publishes a package.',
    });
    const localOnly = await createManualLongTermMemory({
      dataDir: dir,
      projectId: 'local/project-a',
      scope: 'user',
      kind: 'semantic',
      title: 'Project A adapter is experimental',
      content: 'Do not enable the Project A adapter by default.',
      tags: ['adapter'],
      applicability: 'Only while changing Project A adapter code.',
    });
    await qualifyLongTermMemory({ dataDir: dir, id: portable.memory.id, reason: 'User explicitly confirmed this release preference.' });
    await qualifyLongTermMemory({ dataDir: dir, id: localOnly.memory.id, reason: 'Checked against Project A source context.' });
    await approveLongTermMemory({ dataDir: dir, id: portable.memory.id, reason: 'Operator reviewed the portable user preference.' });

    const inProjectB = await selectLongTermMemoriesForTask({
      dataDir: dir,
      projectId: 'local/project-b',
      task: 'Prepare a release with focused verification.',
    });
    expect(inProjectB.map(item => item.memory.id)).toContain(portable.memory.id);
    expect(inProjectB.map(item => item.memory.id)).not.toContain(localOnly.memory.id);

    const projectABound = await selectLongTermMemoriesForTask({
      dataDir: dir,
      projectId: 'local/project-a',
      task: 'Change the experimental adapter.',
    });
    expect(projectABound.map(item => item.memory.id)).toContain(localOnly.memory.id);
  });

  it('uses a bounded semantic fallback for a cross-language task only after scope and lifecycle filtering', async () => {
    const dir = dataDir();
    const portable = await createManualLongTermMemory({
      dataDir: dir,
      projectId: 'local/project-a',
      scope: 'user',
      kind: 'procedural',
      portability: 'portable',
      title: 'Release verification procedure',
      content: 'Run lint, build, focused tests, package smoke, and inspect CI before publishing.',
      tags: ['release', 'verify'],
      applicability: 'Use before publishing a release.',
    });
    const projectOnly = await createManualLongTermMemory({
      dataDir: dir,
      projectId: 'local/project-a',
      scope: 'project',
      kind: 'procedural',
      title: 'Project A deployment procedure',
      content: 'Only use this deployment path in Project A.',
      tags: ['deployment'],
    });
    await qualifyLongTermMemory({ dataDir: dir, id: portable.memory.id, reason: 'User confirmed this reusable procedure.' });
    await qualifyLongTermMemory({ dataDir: dir, id: projectOnly.memory.id, reason: 'Verified only for Project A.' });

    let requestOptions: { timeoutMs?: number; retry?: boolean } | undefined;
    const selected = await selectLongTermMemoriesForTask({
      dataDir: dir,
      projectId: 'local/project-b',
      task: '请给出发布前的验证流程。',
      embeddingProvider: {
        async embedBatch(texts, options) {
          requestOptions = options;
          return texts.map((text) => text.includes('发布') || text.includes('Release verification')
            ? [1, 0]
            : [0, 1]);
        },
      },
    });

    expect(selected).toEqual([
      expect.objectContaining({
        memory: expect.objectContaining({ id: portable.memory.id }),
        reason: expect.stringContaining('semantic match'),
      }),
    ]);
    expect(requestOptions).toEqual({ timeoutMs: 1_800, retry: false });
  });

  it('rejects a portable user candidate derived from project evidence', async () => {
    const dir = dataDir();
    const owner = await resolveLocalMemoryOwner(dir, { create: true });
    await expect(createLongTermMemoryCandidate({
      dataDir: dir,
      originProjectId: 'local/project-a',
      ownerId: owner!.id,
      scope: 'user',
      kind: 'procedural',
      portability: 'portable',
      title: 'Do not leak project adapter procedure',
      content: 'This should remain project-bound.',
      evidence: [{ kind: 'observation', referenceId: 'obs:local/project-a:9', relation: 'derives' }],
    })).rejects.toThrow('Portable user memory may only use manual or user-confirmed evidence');
  });

  it('keeps team memory unavailable without explicit active membership', async () => {
    const dir = dataDir();
    await expect(createManualLongTermMemory({
      dataDir: dir,
      projectId: 'local/project-a',
      scope: 'team',
      kind: 'procedural',
      title: 'Review handoff protocol',
      content: 'Review the evidence before handoff.',
    })).rejects.toThrow('active team identity');

    const created = await createManualLongTermMemory({
      dataDir: dir,
      projectId: 'local/project-a',
      scope: 'team',
      kind: 'procedural',
      title: 'Review handoff protocol',
      content: 'Review the evidence before handoff.',
      tags: ['handoff'],
      reader: { projectId: 'local/project-a', isTeamMember: true },
    });
    await qualifyLongTermMemory({ dataDir: dir, id: created.memory.id, reason: 'Verified in a coordinated handoff.' });

    expect((await selectLongTermMemoriesForTask({
      dataDir: dir,
      projectId: 'local/project-a',
      task: 'Prepare a handoff review.',
    })).map(item => item.memory.id)).not.toContain(created.memory.id);

    expect((await selectLongTermMemoriesForTask({
      dataDir: dir,
      projectId: 'local/project-a',
      task: 'Prepare a handoff review.',
      isTeamMember: true,
    })).map(item => item.memory.id)).toContain(created.memory.id);
  });

  it('keeps an auditable lifecycle and removes archived records from delivery', async () => {
    const dir = dataDir();
    const created = await createManualLongTermMemory({
      dataDir: dir,
      projectId: 'local/project-a',
      scope: 'project',
      kind: 'episodic',
      title: 'Release smoke recovery',
      content: 'The last release smoke was recovered by rebuilding the package.',
      tags: ['release', 'smoke'],
    });
    await qualifyLongTermMemory({ dataDir: dir, id: created.memory.id, reason: 'The recovery result was verified.' });
    await approveLongTermMemory({ dataDir: dir, id: created.memory.id, reason: 'Operator approved the durable episode.' });
    const archived = await archiveLongTermMemory({ dataDir: dir, id: created.memory.id, reason: 'The release process changed.' });
    expect(archived.state).toBe('archived');

    const owner = await resolveLocalMemoryOwner(dir);
    const detail = await getLongTermMemoryDetail({
      dataDir: dir,
      id: created.memory.id,
      reader: { projectId: 'local/project-a', ownerId: owner!.id },
    });
    expect(detail.events.map(event => event.kind)).toEqual(['created', 'qualified', 'approved', 'archived']);
    expect((await listLongTermMemories({
      dataDir: dir,
      reader: { projectId: 'local/project-a', ownerId: owner!.id },
    })).map(item => item.memory.id)).not.toContain(created.memory.id);
    expect((await selectLongTermMemoriesForTask({
      dataDir: dir,
      projectId: 'local/project-a',
      task: 'Recover release smoke.',
    }))).toHaveLength(0);
  });

  it('supersedes an active record only with an eligible scoped replacement', async () => {
    const dir = dataDir();
    const oldMemory = await createManualLongTermMemory({
      dataDir: dir,
      projectId: 'local/project-a',
      scope: 'project',
      kind: 'procedural',
      title: 'Old release smoke',
      content: 'Use the old release smoke procedure.',
      tags: ['release', 'smoke'],
    });
    const replacement = await createManualLongTermMemory({
      dataDir: dir,
      projectId: 'local/project-a',
      scope: 'project',
      kind: 'procedural',
      title: 'Current release smoke',
      content: 'Use the current package smoke procedure.',
      tags: ['release', 'smoke'],
    });
    await qualifyLongTermMemory({ dataDir: dir, id: oldMemory.memory.id, reason: 'Verified when the old release flow was current.' });

    await expect(supersedeLongTermMemory({
      dataDir: dir,
      id: oldMemory.memory.id,
      supersededBy: replacement.memory.id,
      reason: 'A candidate cannot replace an active procedure.',
    })).rejects.toThrow('must be qualified or approved');

    await qualifyLongTermMemory({ dataDir: dir, id: replacement.memory.id, reason: 'Verified against the current packed-package smoke.' });
    const superseded = await supersedeLongTermMemory({
      dataDir: dir,
      id: oldMemory.memory.id,
      supersededBy: replacement.memory.id,
      reason: 'The package release procedure changed.',
    });
    expect(superseded).toMatchObject({ state: 'superseded', supersededBy: replacement.memory.id });

    const selected = await selectLongTermMemoriesForTask({
      dataDir: dir,
      projectId: 'local/project-a',
      task: 'Run the release smoke procedure.',
    });
    expect(selected.map(item => item.memory.id)).toEqual([replacement.memory.id]);

    const owner = await resolveLocalMemoryOwner(dir);
    const detail = await getLongTermMemoryDetail({
      dataDir: dir,
      id: oldMemory.memory.id,
      reader: { projectId: 'local/project-a', ownerId: owner!.id },
    });
    expect(detail.events.map(event => event.kind)).toEqual(['created', 'qualified', 'superseded']);
  });
});
