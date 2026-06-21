/**
 * Bun SQLite Compatibility Layer
 *
 * Provides a better-sqlite3 compatible API using bun:sqlite when running under Bun.
 * Falls back to better-sqlite3 when running under Node.js.
 */

import { createRequire } from 'node:module';

let Database: any;
const requireFromHere = createRequire(import.meta.url);

export function loadSqlite(): any {
  if (Database) return Database;

  // Try better-sqlite3 first (Node.js)
  try {
    Database = requireFromHere('better-sqlite3');
    return Database;
  } catch {
    // Fall through to bun:sqlite
  }

  // Try bun:sqlite (Bun runtime)
  try {
    // bun:sqlite is a Bun built-in
    const bunSqlite = requireFromHere('bun:sqlite');
    Database = bunSqlite.Database;
    return Database;
  } catch {
    throw new Error('[memorix] Neither better-sqlite3 nor bun:sqlite is available');
  }
}

/**
 * Create a SQLite database with better-sqlite3 compatible API.
 * Works under both Node.js (better-sqlite3) and Bun (bun:sqlite).
 */
export function createDatabase(path: string, options?: any): any {
  const Sqlite = loadSqlite();
  const db = new Sqlite(path, options);

  // Bun's sqlite doesn't have .pragma() method, add compatibility
  if (!db.pragma) {
    db.pragma = function (pragma: string, options?: any) {
      if (options && options.simple) {
        const result = db.prepare(`PRAGMA ${pragma}`).get();
        return result ? Object.values(result)[0] : undefined;
      }
      return db.prepare(`PRAGMA ${pragma}`).all();
    };
  }

  return db;
}
