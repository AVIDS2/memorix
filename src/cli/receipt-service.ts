import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { detectProjectWithDiagnostics } from '../project/detector.js';
import { getProjectDataDir } from '../store/persistence.js';
import { loadBetterSqlite3 } from '../store/sqlite-db.js';

export interface HandoffReceiptOptions {
  cwd?: string;
  probe?: string;
  transport?: 'cli' | 'stdio' | 'http' | 'unknown';
}

export type HandoffReceipt = Record<string, unknown> & {
  version: 1;
  boundary: string;
  privacy: {
    omitted: string[];
  };
};

interface ReceiptObservation {
  id: number;
  status?: string | null;
  source?: string | null;
  sourceDetail?: string | null;
  title?: string | null;
  narrative?: string | null;
  facts?: string | string[] | null;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function hashId(projectId: string, id: number): string {
  return sha256(`${projectId}:obs:${id}`);
}

function inferWritePolicy(observations: Array<{ source?: string | null; sourceDetail?: string | null }>): string {
  if (observations.length === 0) return 'not_observed';
  if (observations.some((obs) => obs.sourceDetail === 'hook')) return 'hook';
  if (observations.some((obs) => obs.sourceDetail === 'explicit')) return 'explicit_tool';
  if (observations.some((obs) => obs.source === 'manual')) return 'cli';
  if (observations.some((obs) => obs.source === 'git' || obs.sourceDetail === 'git-ingest')) return 'git_ingest';
  return 'agent_or_unknown';
}

function inferWriteTrigger(count: number): string {
  return count > 0 ? 'memory_written' : 'not_triggered';
}

function safeJsonArray(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function loadReceiptObservations(dataDir: string, projectId: string): Promise<ReceiptObservation[]> {
  const dbPath = path.join(dataDir, 'memorix.db');

  if (existsSync(dbPath)) {
    try {
      const DB = loadBetterSqlite3();
      const db = new DB(dbPath, { readonly: true, fileMustExist: true });
      try {
        return db.prepare(`
          SELECT id, status, source, sourceDetail, title, narrative, facts
          FROM observations
          WHERE projectId = ?
        `).all(projectId) as ReceiptObservation[];
      } finally {
        db.close();
      }
    } catch {
      // Fall through to legacy JSON best-effort read.
    }
  }

  const jsonPath = path.join(dataDir, 'observations.json');
  if (!existsSync(jsonPath)) return [];

  try {
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((obs) => obs?.projectId === projectId) as ReceiptObservation[];
  } catch {
    return [];
  }
}

function probeMatches(obs: ReceiptObservation, probe: string): boolean {
  const query = probe.toLowerCase();
  const facts = safeJsonArray(obs.facts).join(' ');
  const text = [obs.title ?? '', obs.narrative ?? '', facts].join(' ').toLowerCase();
  return query.split(/\s+/).filter(Boolean).some((term) => text.includes(term));
}

export async function buildHandoffReceipt(options: HandoffReceiptOptions = {}): Promise<HandoffReceipt> {
  const cwd = options.cwd ?? process.cwd();
  const transport = options.transport ?? 'cli';
  const detection = detectProjectWithDiagnostics(cwd);

  if (!detection.project) {
    const detail = detection.failure?.detail ?? 'No git repository found in the current directory.';
    throw new Error(detail);
  }

  const project = detection.project;
  const dataDir = await getProjectDataDir(project.id);
  const observations = (await loadReceiptObservations(dataDir, project.id))
    .filter((obs) => (obs.status ?? 'active') === 'active');
  const recent = observations.slice(-10).reverse();

  const receipt: HandoffReceipt = {
    version: 1,
    'project.has_git': true,
    'project.name_hash': sha256(project.name),
    'project.identity_hash': sha256(project.id),
    'project.root_hash': sha256(project.rootPath),
    'runtime.transport': transport,
    'runtime.cwd_hash': sha256(cwd),
    write_policy: inferWritePolicy(recent),
    'write.trigger': inferWriteTrigger(observations.length),
    'memory.write.count': observations.length,
    'memory.write.ids_hash': recent.map((obs) => hashId(project.id, obs.id)),
    boundary: 'shared memory means stored memories are searchable across clients in the same project; chat messages are not mirrored automatically',
    privacy: {
      omitted: [
        'raw_chat_transcript',
        'raw_memory_text',
        'raw_search_query',
        'tool_arguments',
        'tool_results',
        'local_file_paths',
      ],
    },
  };

  const probe = options.probe?.trim();
  if (probe) {
    const search = observations.filter((obs) => probeMatches(obs, probe)).slice(0, 10);
    receipt['memory.search.query_hash'] = sha256(probe);
    receipt['memory.search.result_count'] = search.length;
    receipt['memory.search.result_ids_hash'] = search.map((entry) => hashId(project.id, entry.id));
  }

  return receipt;
}

export function formatHandoffReceipt(receipt: HandoffReceipt): string {
  const lines = [
    '',
    '┌─ Memory Handoff Receipt ─────────────────────────',
    `  Project identity: ${receipt['project.identity_hash']}`,
    `  Git project: ${receipt['project.has_git'] ? 'yes' : 'no'}`,
    `  Transport: ${receipt['runtime.transport']}`,
    `  Write policy: ${receipt.write_policy}`,
    `  Write trigger: ${receipt['write.trigger']}`,
    `  Stored memories: ${receipt['memory.write.count']}`,
  ];

  if (typeof receipt['memory.search.result_count'] === 'number') {
    lines.push(`  Probe result count: ${receipt['memory.search.result_count']}`);
  }

  lines.push('');
  lines.push(`  Boundary: ${receipt.boundary}`);
  lines.push('  Privacy: raw chat, memory text, queries, tool payloads, and local paths are omitted.');
  lines.push('');
  return lines.join('\n');
}
