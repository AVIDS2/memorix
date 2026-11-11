import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createMemorixServer } from '../../src/server.js';
import { resetDb } from '../../src/store/orama-store.js';
import { resetObservationStore } from '../../src/store/obs-store.js';
import { closeAllDatabases } from '../../src/store/sqlite-db.js';

/**
 * Media schema honesty exam: the MCP schema must only advertise actions the
 * operator actually enabled. A tool that lists generate-video while the env
 * gate is closed teaches agents a lie. Deterministic, offline.
 */

const GATED_ACTIONS = ['generate-image', 'generate-video', 'derive-audio'] as const;
const ALWAYS_ACTIONS = ['import', 'attach', 'list', 'show', 'derive-pdf', 'status', 'cancel'] as const;

describe('media schema honesty exam', () => {
  const priorDataDir = process.env.MEMORIX_DATA_DIR;
  const priorGeneration = process.env.MEMORIX_MCP_MEDIA_GENERATION;
  const priorTranscription = process.env.MEMORIX_MCP_MEDIA_TRANSCRIPTION;
  let root = '';
  let dataDir = '';

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'memorix-media-schema-'));
    dataDir = path.join(root, 'data');
    process.env.MEMORIX_DATA_DIR = dataDir;
    delete process.env.MEMORIX_MCP_MEDIA_GENERATION;
    delete process.env.MEMORIX_MCP_MEDIA_TRANSCRIPTION;
    resetObservationStore();
    await resetDb();
  });

  afterEach(async () => {
    if (priorDataDir === undefined) delete process.env.MEMORIX_DATA_DIR;
    else process.env.MEMORIX_DATA_DIR = priorDataDir;
    if (priorGeneration === undefined) delete process.env.MEMORIX_MCP_MEDIA_GENERATION;
    else process.env.MEMORIX_MCP_MEDIA_GENERATION = priorGeneration;
    if (priorTranscription === undefined) delete process.env.MEMORIX_MCP_MEDIA_TRANSCRIPTION;
    else process.env.MEMORIX_MCP_MEDIA_TRANSCRIPTION = priorTranscription;
    resetObservationStore();
    await resetDb();
    closeAllDatabases();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function actionsFor(env: Record<string, string | undefined>): Promise<string[]> {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const { server } = await createMemorixServer(undefined, undefined, undefined, {
      toolProfile: 'lite',
      deferProjectRuntimeInit: true,
    } as any);
    const tool = (server as any)._registeredTools?.memorix_media;
    expect(tool, 'memorix_media should be registered').toBeTruthy();
    return tool.inputSchema.shape.action.options as string[];
  }

  it('advertises only the always-on actions when the gates are closed', async () => {
    const actions = await actionsFor({});
    for (const action of ALWAYS_ACTIONS) {
      expect(actions, `always-on action ${action}`).toContain(action);
    }
    for (const action of GATED_ACTIONS) {
      expect(actions, `gated action ${action} must be hidden while disabled`).not.toContain(action);
    }
  });

  it('advertises the gated actions once their env switches are on', async () => {
    const actions = await actionsFor({
      MEMORIX_MCP_MEDIA_GENERATION: '1',
      MEMORIX_MCP_MEDIA_TRANSCRIPTION: '1',
    });
    for (const action of [...ALWAYS_ACTIONS, ...GATED_ACTIONS]) {
      expect(actions, `enabled action ${action}`).toContain(action);
    }
  });

  it('advertises transcription without generation when only that switch is on', async () => {
    const actions = await actionsFor({ MEMORIX_MCP_MEDIA_TRANSCRIPTION: '1' });
    expect(actions).toContain('derive-audio');
    expect(actions).not.toContain('generate-image');
    expect(actions).not.toContain('generate-video');
  });
});
