/**
 * Workspace Sync Applier
 *
 * Writes generated workspace sync results to disk with safety features:
 *   1. Pre-flight validation (check writability)
 *   2. Backup existing files before overwrite
 *   3. Atomic write (write to temp, then rename)
 *   4. Rollback on failure
 *
 * Usage:
 *   const applier = new WorkspaceSyncApplier();
 *   const result = await applier.apply(syncResult);
 *   if (!result.success) await applier.rollback(result.backups);
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, unlinkSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ApplyResult {
  success: boolean;
  filesWritten: string[];
  backups: BackupEntry[];
  errors: string[];
}

export interface BackupEntry {
  originalPath: string;
  backupPath: string;
}

interface FileToWrite {
  filePath: string;
  content: string;
}

/**
 * Apply workspace sync results to disk with backup and rollback.
 */
export class WorkspaceSyncApplier {
  /**
   * Apply generated files to disk.
   *
   * Steps:
   *   1. Validate all target directories exist or can be created
   *   2. Backup existing files
   *   3. Write new files
   *   4. On any error → rollback all changes
   */
  async apply(files: FileToWrite[]): Promise<ApplyResult> {
    const result: ApplyResult = {
      success: false,
      filesWritten: [],
      backups: [],
      errors: [],
    };

    if (files.length === 0) {
      result.success = true;
      return result;
    }

    // Step 1: Pre-flight — ensure all directories exist
    for (const file of files) {
      try {
        const dir = dirname(file.filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
      } catch (err) {
        result.errors.push(`Cannot create directory for ${file.filePath}: ${err}`);
        return result;
      }
    }

    // Step 2: Backup existing files
    for (const file of files) {
      if (existsSync(file.filePath)) {
        try {
          const backupPath = file.filePath + `.backup-${Date.now()}`;
          copyFileSync(file.filePath, backupPath);
          result.backups.push({
            originalPath: file.filePath,
            backupPath,
          });
        } catch (err) {
          result.errors.push(`Cannot backup ${file.filePath}: ${err}`);
          return result;
        }
      }
    }

    // Step 3: Write new files
    for (const file of files) {
      try {
        // Write to temp file first, then rename (pseudo-atomic)
        const tempPath = file.filePath + `.tmp-${Date.now()}`;
        writeFileSync(tempPath, file.content, 'utf-8');
        renameSync(tempPath, file.filePath);
        result.filesWritten.push(file.filePath);
      } catch (err) {
        result.errors.push(`Cannot write ${file.filePath}: ${err}`);
        // Rollback everything written so far
        this.rollback(result.backups);
        return result;
      }
    }

    result.success = true;
    return result;
  }

  /**
   * Rollback applied changes by restoring backups.
   */
  rollback(backups: BackupEntry[]): { restored: number; errors: string[] } {
    const errors: string[] = [];
    let restored = 0;

    for (const backup of backups) {
      try {
        copyFileSync(backup.backupPath, backup.originalPath);
        restored++;
      } catch (err) {
        errors.push(`Cannot restore ${backup.originalPath} from ${backup.backupPath}: ${err}`);
      }
    }

    return { restored, errors };
  }

  /**
   * Clean up backup files after successful apply.
   */
  cleanBackups(backups: BackupEntry[]): void {
    for (const backup of backups) {
      try {
        if (existsSync(backup.backupPath)) {
          unlinkSync(backup.backupPath);
        }
      } catch {
        // Best-effort cleanup
      }
    }
  }
}
