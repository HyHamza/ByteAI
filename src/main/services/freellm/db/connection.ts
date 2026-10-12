import fs from 'fs';
import path from 'path';

// Native built-in SQLite in Node 22+ / Electron
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite');

export interface Statement<T = any> {
  get(...params: any[]): T | undefined;
  all(...params: any[]): T[];
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
}

export class SqliteDatabase {
  private db: any;

  constructor(filePath: string) {
    if (filePath !== ':memory:') {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(filePath);
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA foreign_keys = ON;');
    } catch {
      // pragma ignored on in-memory or unsupported modes
    }
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): Statement {
    const stmt = this.db.prepare(sql);
    return {
      get: (...params: any[]) => stmt.get(...params),
      all: (...params: any[]) => stmt.all(...params),
      run: (...params: any[]) => stmt.run(...params),
    };
  }

  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
    return (...args: any[]) => {
      this.exec('BEGIN TRANSACTION;');
      try {
        const res = fn(...args);
        this.exec('COMMIT;');
        return res;
      } catch (err) {
        this.exec('ROLLBACK;');
        throw err;
      }
    };
  }

  pragma(pragmaStr: string): any {
    try {
      return this.db.prepare(`PRAGMA ${pragmaStr}`).all();
    } catch {
      try {
        this.db.exec(`PRAGMA ${pragmaStr};`);
      } catch {
        // ignore
      }
      return [];
    }
  }
}
