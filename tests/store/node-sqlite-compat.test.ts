import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, resetSqliteDriverForTests } from '../../src/store/bun-sqlite-compat.js';

describe('node:sqlite compatibility fallback', () => {
  const originalDriver = process.env.MEMORIX_SQLITE_DRIVER;

  afterEach(() => {
    if (originalDriver === undefined) {
      delete process.env.MEMORIX_SQLITE_DRIVER;
    } else {
      process.env.MEMORIX_SQLITE_DRIVER = originalDriver;
    }
    resetSqliteDriverForTests();
  });

  it('keeps the better-sqlite3 pragma and transaction contract on Node 22', () => {
    process.env.MEMORIX_SQLITE_DRIVER = 'node';
    resetSqliteDriverForTests();
    const db = createDatabase(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      db.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');

      const insert = db.prepare('INSERT INTO entries (value) VALUES (?)');
      const write = db.transaction((values: string[]) => {
        for (const value of values) insert.run(value);
      });
      write(['first', 'second']);

      expect(db.prepare('SELECT value FROM entries ORDER BY id').all())
        .toEqual([{ value: 'first' }, { value: 'second' }]);
    } finally {
      db.close();
    }
  });
});
