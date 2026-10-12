import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteDatabase } from './connection';
import { migrateDbSchema } from './migrations';

const DATA_DIR = path.join(os.homedir(), '.seniorengineer');
const DEFAULT_DB_PATH = path.join(DATA_DIR, 'freellmapi.db');

let db: SqliteDatabase | null = null;

export function getDb(): SqliteDatabase {
  if (!db) {
    return initDb();
  }
  return db;
}

export function initDb(dbPath?: string): SqliteDatabase {
  if (db && !dbPath) return db;

  const resolvedPath = dbPath ?? DEFAULT_DB_PATH;
  const isMemory = resolvedPath === ':memory:';

  if (!isMemory) {
    const dataDir = path.dirname(resolvedPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  db = new SqliteDatabase(resolvedPath);
  migrateDbSchema(db);

  console.log(`[FreeLLM] Database initialized at ${resolvedPath}`);
  return db;
}

export function getUnifiedApiKey(): string {
  const database = getDb();
  const row = database.prepare("SELECT value FROM settings WHERE key = 'unified_api_key'").get() as { value: string } | undefined;
  if (!row?.value) {
    return regenerateUnifiedKey();
  }
  return row.value;
}

export function regenerateUnifiedKey(): string {
  const database = getDb();
  const key = `freellmapi-${crypto.randomBytes(24).toString('hex')}`;
  database.prepare(`
    INSERT INTO settings (key, value) VALUES ('unified_api_key', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key);
  return key;
}

// Generic key/value settings accessors (used by routing strategy, etc.).
export function getSetting(key: string): string | undefined {
  const database = getDb();
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  const database = getDb();
  database.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}
