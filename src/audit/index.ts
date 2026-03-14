/**
 * Audit Module - Track Memorix-written files
 *
 * Records all files written by Memorix to distinguish them from
 * project-native files. Provides audit trail for cleanup and rollback.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { homedir } from 'node:os';

const AUDIT_FILE = path.join(homedir(), '.memorix', 'audit.json');

export interface AuditEntry {
  type: 'hook' | 'rule' | 'other';
  agent?: string;
  path: string;
  createdAt: string;
}

export interface ProjectAudit {
  projectRoot: string;
  installedAt: string;
  entries: AuditEntry[];
}

export interface AuditData {
  version: string;
  projects: Record<string, ProjectAudit>;
}

/**
 * Load audit data from disk.
 */
export async function loadAudit(): Promise<AuditData> {
  try {
    const content = await fs.readFile(AUDIT_FILE, 'utf-8');
    return JSON.parse(content) as AuditData;
  } catch {
    // No audit file yet
    return {
      version: '1.0.0',
      projects: {},
    };
  }
}

/**
 * Save audit data to disk.
 */
export async function saveAudit(data: AuditData): Promise<void> {
  const dir = path.dirname(AUDIT_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(AUDIT_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Get project ID from project root.
 */
export function getProjectId(projectRoot: string): string {
  const normalized = projectRoot.replace(/\\/g, '/');
  return `local/${normalized}`;
}

/**
 * Record a file written by Memorix.
 */
export async function recordFile(
  projectRoot: string,
  type: AuditEntry['type'],
  path: string,
  agent?: string,
): Promise<void> {
  const data = await loadAudit();
  const projectId = getProjectId(projectRoot);

  if (!data.projects[projectId]) {
    data.projects[projectId] = {
      projectRoot,
      installedAt: new Date().toISOString(),
      entries: [],
    };
  }

  // Check if entry already exists
  const existingIndex = data.projects[projectId].entries.findIndex(
    (e) => e.path === path
  );

  if (existingIndex === -1) {
    data.projects[projectId].entries.push({
      type,
      agent,
      path,
      createdAt: new Date().toISOString(),
    });
  }

  await saveAudit(data);
}

/**
 * Get all files written by Memorix for a project.
 */
export async function getProjectFiles(projectRoot: string): Promise<AuditEntry[]> {
  const data = await loadAudit();
  const projectId = getProjectId(projectRoot);
  return data.projects[projectId]?.entries || [];
}

/**
 * Remove a file from audit (when uninstalled).
 */
export async function removeFile(projectRoot: string, path: string): Promise<void> {
  const data = await loadAudit();
  const projectId = getProjectId(projectRoot);

  if (!data.projects[projectId]) return;

  data.projects[projectId].entries = data.projects[projectId].entries.filter(
    (e) => e.path !== path
  );

  // If no entries left, remove the project
  if (data.projects[projectId].entries.length === 0) {
    delete data.projects[projectId];
  }

  await saveAudit(data);
}

/**
 * Get all audit entries across all projects.
 */
export async function getAllAuditEntries(): Promise<
  Array<{ projectId: string; entry: AuditEntry }>
> {
  const data = await loadAudit();
  const entries: Array<{ projectId: string; entry: AuditEntry }> = [];

  for (const [projectId, project] of Object.entries(data.projects)) {
    for (const entry of project.entries) {
      entries.push({ projectId, entry });
    }
  }

  return entries;
}
