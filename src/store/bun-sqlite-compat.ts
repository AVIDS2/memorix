/**
 * Bun SQLite Compatibility Layer
 *
 * Provides a small better-sqlite3 compatibility layer for the available local
 * SQLite implementation. Node 22 ships node:sqlite, which keeps Memorix
 * usable when an optional better-sqlite3 native binary is unavailable.
 */

import { createRequire } from 'node:module';

let Database: any;
let driver: 'better-sqlite3' | 'node:sqlite' | 'bun:sqlite' | undefined;
const requireFromHere = createRequire(import.meta.url);

function loadNodeSqlite(): any {
  const nodeSqlite = requireFromHere('node:sqlite');
  return nodeSqlite.DatabaseSync;
}

function isNativeBindingFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /could not locate the bindings file|better_sqlite3\.node|module did not self-register/i.test(message);
}

function addCompatibility(db: any): any {
  // Node's StatementSync is stricter than better-sqlite3: it rejects a
  // parameter object with harmless extra keys. Memorix stores commonly pass a
  // complete row object to statements that only use part of that row, so keep
  // the established better-sqlite3 behavior on the fallback driver.
  if (!db.__memorixPreparedStatementCompatibility) {
    const prepare = db.prepare.bind(db);
    db.prepare = function (...args: any[]) {
      const statement = prepare(...args);
      statement.setAllowBareNamedParameters?.(true);
      statement.setAllowUnknownNamedParameters?.(true);
      return statement;
    };
    Object.defineProperty(db, '__memorixPreparedStatementCompatibility', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  }

  // Bun and node:sqlite do not expose better-sqlite3's pragma helper.
  if (!db.pragma) {
    db.pragma = function (pragma: string, options?: { simple?: boolean }) {
      const statement = db.prepare(`PRAGMA ${pragma}`);
      if (options?.simple) {
        const result = statement.get();
        return result ? Object.values(result)[0] : undefined;
      }
      return statement.all();
    };
  }

  // Stores use better-sqlite3's synchronous transaction factory. Keep nested
  // calls correct with savepoints instead of silently committing inner work.
  // Match its callable transaction variants as well: default/deferred,
  // immediate, and exclusive.
  if (!db.transaction) {
    let depth = 0;
    let sequence = 0;
    db.transaction = function <T>(fn: (...args: any[]) => T) {
      const run = (mode: 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE', args: any[]): T => {
        const outermost = depth === 0;
        const savepoint = `memorix_tx_${++sequence}`;
        if (outermost) {
          db.exec(`BEGIN ${mode}`);
        } else {
          db.exec(`SAVEPOINT ${savepoint}`);
        }
        depth += 1;
        try {
          const result = fn(...args);
          if (result && typeof (result as any).then === 'function') {
            throw new Error('[memorix] SQLite transactions must be synchronous');
          }
          depth -= 1;
          if (outermost) {
            db.exec('COMMIT');
          } else {
            db.exec(`RELEASE SAVEPOINT ${savepoint}`);
          }
          return result;
        } catch (error) {
          depth -= 1;
          try {
            if (outermost) {
              db.exec('ROLLBACK');
            } else {
              db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
              db.exec(`RELEASE SAVEPOINT ${savepoint}`);
            }
          } catch {
            // Preserve the original application failure when rollback itself fails.
          }
          throw error;
        }
      };

      const transaction = (...args: any[]): T => run('DEFERRED', args);
      transaction.default = transaction;
      transaction.deferred = (...args: any[]): T => run('DEFERRED', args);
      transaction.immediate = (...args: any[]): T => run('IMMEDIATE', args);
      transaction.exclusive = (...args: any[]): T => run('EXCLUSIVE', args);
      return transaction;
    };
  }

  return db;
}

function instantiateDatabase(Sqlite: any, filePath: string, options?: any): any {
  // DatabaseSync validates that an explicitly supplied second argument is an
  // object, unlike better-sqlite3 which accepts undefined.
  return driver === 'node:sqlite' && options === undefined
    ? new Sqlite(filePath)
    : new Sqlite(filePath, options);
}

export function loadSqlite(): any {
  if (Database) return Database;

  // Kept as an operational escape hatch and a regression-test seam. Node 22
  // is the supported minimum runtime, so this does not expand the platform
  // contract beyond package.json's existing engine requirement.
  if (process.env.MEMORIX_SQLITE_DRIVER === 'node') {
    Database = loadNodeSqlite();
    driver = 'node:sqlite';
    return Database;
  }

  // Try better-sqlite3 first (Node.js)
  try {
    Database = requireFromHere('better-sqlite3');
    driver = 'better-sqlite3';
    return Database;
  } catch {
    // Fall through to node:sqlite, then Bun's runtime implementation.
  }

  try {
    Database = loadNodeSqlite();
    driver = 'node:sqlite';
    return Database;
  } catch {
    // Fall through to bun:sqlite
  }

  // Try bun:sqlite (Bun runtime)
  try {
    // bun:sqlite is a Bun built-in
    const bunSqlite = requireFromHere('bun:sqlite');
    Database = bunSqlite.Database;
    driver = 'bun:sqlite';
    return Database;
  } catch {
    throw new Error('[memorix] SQLite is unavailable (better-sqlite3, node:sqlite, and bun:sqlite failed)');
  }
}

/**
 * Create a SQLite database with better-sqlite3 compatible API.
 * Works under both Node.js (better-sqlite3) and Bun (bun:sqlite).
 */
export function createDatabase(path: string, options?: any): any {
  const Sqlite = loadSqlite();
  try {
    return addCompatibility(instantiateDatabase(Sqlite, path, options));
  } catch (error) {
    // require('better-sqlite3') can succeed even when npm had no prebuild and
    // no local compiler. Fall back to Node's built-in SQLite for that one
    // recoverable case; real open/corruption errors still surface unchanged.
    if (driver !== 'better-sqlite3' || !isNativeBindingFailure(error)) throw error;
    Database = loadNodeSqlite();
    driver = 'node:sqlite';
    return addCompatibility(instantiateDatabase(Database, path, options));
  }
}

/** Test-only reset for the driver cache used by the forced node:sqlite path. */
export function resetSqliteDriverForTests(): void {
  Database = undefined;
  driver = undefined;
}
