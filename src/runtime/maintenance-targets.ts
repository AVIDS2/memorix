import { getDatabase } from '../store/sqlite-db.js';

export interface MaintenanceTarget {
  projectId: string;
  projectRoot: string;
  dataDir: string;
  updatedAt: number;
}

export interface RegisterMaintenanceTargetInput {
  projectId: string;
  projectRoot: string;
  dataDir: string;
  now?: number;
}

function rowToTarget(row: any): MaintenanceTarget {
  return {
    projectId: row.project_id,
    projectRoot: row.project_root,
    dataDir: row.data_dir,
    updatedAt: Number(row.updated_at),
  };
}

/**
 * A local registry for isolated maintenance jobs. It deliberately stores only
 * project identity and local paths; it is never sent through MCP responses.
 */
export class MaintenanceTargetStore {
  private readonly db: any;

  constructor(dataDir: string) {
    this.db = getDatabase(dataDir);
  }

  register(input: RegisterMaintenanceTargetInput): MaintenanceTarget {
    if (!input.projectId.trim()) throw new Error('Maintenance target requires a project ID');
    if (!input.projectRoot.trim()) throw new Error('Maintenance target requires a project root');
    if (!input.dataDir.trim()) throw new Error('Maintenance target requires a data directory');
    const now = input.now ?? Date.now();
    this.db.prepare(`
      INSERT INTO maintenance_targets (project_id, project_root, data_dir, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        project_root = excluded.project_root,
        data_dir = excluded.data_dir,
        updated_at = excluded.updated_at
    `).run(input.projectId, input.projectRoot, input.dataDir, now);
    return this.get(input.projectId)!;
  }

  get(projectId: string): MaintenanceTarget | undefined {
    const row = this.db.prepare(`
      SELECT * FROM maintenance_targets WHERE project_id = ?
    `).get(projectId);
    return row ? rowToTarget(row) : undefined;
  }
}
