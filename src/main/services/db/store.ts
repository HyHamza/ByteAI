import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AppSettings, ChatSession, ChatMessage, ProjectInfo, DutyShift } from '@/shared/types';

// Native built-in SQLite in Node 22+ / Electron
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(os.homedir(), '.seniorengineer');
const DB_PATH = path.join(DATA_DIR, 'seniorengineer.db');
const LEGACY_JSON_PATH = path.join(DATA_DIR, 'store.json');

const DEFAULT_SETTINGS: AppSettings = {
  mode: 'standard',
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  selectedModel: 'gpt-4o',
  isAutoModel: true,
  julesApiKey: '',
  julesDefaultRepo: '',
  julesDefaultBranch: 'main',
  maxAutonomousTurns: 50,
  activeWorkspacePath: null,
  groqApiKey: '',
  securityPreset: 'turbo',
  planReviewPolicy: 'proceed',
  queuedMessages: 'queue',
  theme: 'obsidian',
  vadEnabled: true,
  userName: 'Hamza',
  userEmail: 'talkdrove@gmail.com',
};

const GREETINGS = new Set([
  'hi', 'hello', 'hey', 'yo', 'sup', 'test', 'testing',
  'good morning', 'good evening', 'good afternoon',
  'hi there', 'hello there', 'help', 'start', 'ok', 'okay', 'thanks', 'thank you'
]);

export function isSubstantiveMessage(text: string): boolean {
  if (!text) return false;
  const clean = text.trim().toLowerCase().replace(/[!.,?]/g, '');
  if (clean.length < 3) return false;
  if (GREETINGS.has(clean)) return false;
  return true;
}

export class DataStore {
  private static instance: DataStore;
  private db: any;

  // Cached Prepared Statements
  private stmtGetSetting: any;
  private stmtGetAllSettings: any;
  private stmtSetSetting: any;
  private stmtGetSessions: any;
  private stmtGetSessionsByWorkspace: any;
  private stmtGetSessionById: any;
  private stmtGetMessagesBySession: any;
  private stmtUpsertSession: any;
  private stmtInsertMessage: any;
  private stmtDeleteSession: any;
  private stmtGetAllProjects: any;
  private stmtUpsertProject: any;
  private stmtDeleteProject: any;
  private stmtGetActiveDutyShift: any;
  private stmtGetActiveDutyShiftBySession: any;
  private stmtGetDutyShiftById: any;
  private stmtUpsertDutyShift: any;

  // In-Memory Fast Cache for Instant Zero-Lag UI Access
  private sessionsCache: Map<string, ChatSession> = new Map();

  private constructor() {
    this.ensureDir();
    this.initDatabase();
    this.migrateFromLegacyJsonIfNeeded();
    this.syncJulesKeyFromSkill();
    this.loadAllIntoCache();
  }

  public static getInstance(): DataStore {
    if (!DataStore.instance) {
      DataStore.instance = new DataStore();
    }
    return DataStore.instance;
  }

  private ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private initDatabase() {
    this.db = new DatabaseSync(DB_PATH);

    // Apply high-performance SQLite PRAGMAs
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA temp_store = MEMORY;

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        mode TEXT NOT NULL,
        workspace_path TEXT,
        jules_session_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_path);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        attachments TEXT,
        tool_calls TEXT,
        execution_duration INTEGER,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp ASC);

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT UNIQUE NOT NULL,
        git_repo TEXT,
        git_branch TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);

      CREATE TABLE IF NOT EXISTS duty_shifts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        mission_prompt TEXT NOT NULL,
        total_hours REAL NOT NULL,
        duration_ms INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        target_end_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        phases_completed TEXT NOT NULL,
        last_check_at INTEGER NOT NULL,
        metadata TEXT,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_duty_shifts_status ON duty_shifts(status);
      CREATE INDEX IF NOT EXISTS idx_duty_shifts_session ON duty_shifts(session_id);
    `);

    // Prepare reusable statements
    this.stmtGetSetting = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    this.stmtGetAllSettings = this.db.prepare('SELECT key, value FROM settings');
    this.stmtSetSetting = this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    this.stmtGetSessions = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC');
    this.stmtGetSessionsByWorkspace = this.db.prepare('SELECT * FROM sessions WHERE workspace_path = ? ORDER BY updated_at DESC');
    this.stmtGetSessionById = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    this.stmtGetMessagesBySession = this.db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC');

    this.stmtUpsertSession = this.db.prepare(`
      INSERT INTO sessions (id, title, mode, workspace_path, jules_session_id, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        mode = excluded.mode,
        workspace_path = excluded.workspace_path,
        jules_session_id = excluded.jules_session_id,
        updated_at = excluded.updated_at,
        metadata = excluded.metadata
    `);

    this.stmtInsertMessage = this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, timestamp, attachments, tool_calls, execution_duration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        attachments = excluded.attachments,
        tool_calls = excluded.tool_calls,
        execution_duration = excluded.execution_duration
    `);

    this.stmtDeleteSession = this.db.prepare('DELETE FROM sessions WHERE id = ?');

    this.stmtGetAllProjects = this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC');
    this.stmtUpsertProject = this.db.prepare(`
      INSERT INTO projects (id, name, path, git_repo, git_branch, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        name = excluded.name,
        git_repo = excluded.git_repo,
        git_branch = excluded.git_branch
    `);
    this.stmtDeleteProject = this.db.prepare('DELETE FROM projects WHERE path = ?');

    this.stmtGetActiveDutyShift = this.db.prepare("SELECT * FROM duty_shifts WHERE status = 'active' ORDER BY started_at DESC LIMIT 1");
    this.stmtGetActiveDutyShiftBySession = this.db.prepare("SELECT * FROM duty_shifts WHERE session_id = ? AND status = 'active' LIMIT 1");
    this.stmtGetDutyShiftById = this.db.prepare('SELECT * FROM duty_shifts WHERE id = ?');
    this.stmtUpsertDutyShift = this.db.prepare(`
      INSERT INTO duty_shifts (id, session_id, mission_prompt, total_hours, duration_ms, started_at, target_end_at, status, phases_completed, last_check_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        session_id = excluded.session_id,
        mission_prompt = excluded.mission_prompt,
        total_hours = excluded.total_hours,
        duration_ms = excluded.duration_ms,
        started_at = excluded.started_at,
        target_end_at = excluded.target_end_at,
        status = excluded.status,
        phases_completed = excluded.phases_completed,
        last_check_at = excluded.last_check_at,
        metadata = excluded.metadata
    `);
  }

  /**
   * Automatically migrate existing store.json into SQLite on first run
   */
  private migrateFromLegacyJsonIfNeeded() {
    if (!fs.existsSync(LEGACY_JSON_PATH)) return;

    try {
      const sessionCount = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get()?.count || 0;
      if (sessionCount > 0) {
        // Already populated
        return;
      }

      console.log('[DataStore] Migrating legacy store.json to SQLite...');
      const raw = fs.readFileSync(LEGACY_JSON_PATH, 'utf-8');
      const data = JSON.parse(raw);

      this.db.exec('BEGIN TRANSACTION');

      // 1. Settings
      if (data.settings && typeof data.settings === 'object') {
        for (const [k, v] of Object.entries(data.settings)) {
          if (v !== undefined && v !== null) {
            this.stmtSetSetting.run(k, String(v));
          }
        }
      }

      // 2. Projects
      if (data.projects && typeof data.projects === 'object') {
        for (const p of Object.values(data.projects) as ProjectInfo[]) {
          if (p && p.path) {
            this.stmtUpsertProject.run(
              p.id || p.path,
              p.name || path.basename(p.path),
              p.path,
              p.gitRepo || null,
              p.gitBranch || null,
              p.createdAt || Date.now()
            );
          }
        }
      }

      // 3. Sessions & Messages
      if (data.sessions && typeof data.sessions === 'object') {
        for (const s of Object.values(data.sessions) as ChatSession[]) {
          if (s && s.id) {
            this.stmtUpsertSession.run(
              s.id,
              s.title || 'New Conversation',
              s.mode || 'standard',
              s.workspacePath || null,
              (s as any).julesSessionId || null,
              s.createdAt || Date.now(),
              s.updatedAt || Date.now(),
              null
            );

            if (Array.isArray(s.messages)) {
              for (const m of s.messages) {
                if (m && m.id) {
                  this.stmtInsertMessage.run(
                    m.id,
                    s.id,
                    m.role || 'user',
                    m.content || '',
                    m.timestamp || Date.now(),
                    m.attachments ? JSON.stringify(m.attachments) : null,
                    m.toolCalls ? JSON.stringify(m.toolCalls) : null,
                    m.executionDuration || null
                  );
                }
              }
            }
          }
        }
      }

      this.db.exec('COMMIT');
      console.log('[DataStore] Successfully migrated data to SQLite database!');

      // Safely preserve backup of old JSON file
      try {
        fs.renameSync(LEGACY_JSON_PATH, `${LEGACY_JSON_PATH}.migrated`);
      } catch (_) {}
    } catch (err) {
      this.db.exec('ROLLBACK');
      console.error('[DataStore] Error during SQLite migration:', err);
    }
  }

  private syncJulesKeyFromSkill() {
    const currentKey = this.stmtGetSetting.get('julesApiKey')?.value;
    if (!currentKey) {
      const julesKeyPath = path.join(os.homedir(), '.gemini', 'config', 'skills', 'jules', '.jules_key');
      if (fs.existsSync(julesKeyPath)) {
        try {
          const key = fs.readFileSync(julesKeyPath, 'utf-8').trim();
          if (key) {
            this.stmtSetSetting.run('julesApiKey', key);
          }
        } catch (_) {}
      }
    }
  }

  public getSettings(): AppSettings {
    const rows = this.stmtGetAllSettings.all();
    const stored: Record<string, any> = {};

    for (const r of rows) {
      let val: any = r.value;
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (!isNaN(Number(val)) && r.key === 'maxAutonomousTurns') val = Number(val);
      stored[r.key] = val;
    }

    const s: AppSettings = { ...DEFAULT_SETTINGS, ...stored };

    if (!s.julesApiKey) {
      const julesKeyPath = path.join(os.homedir(), '.gemini', 'config', 'skills', 'jules', '.jules_key');
      if (fs.existsSync(julesKeyPath)) {
        try {
          s.julesApiKey = fs.readFileSync(julesKeyPath, 'utf-8').trim();
        } catch (_) {}
      }
    }

    if (!s.julesDefaultRepo) {
      s.julesDefaultRepo = 'sources/github/HyHamza/SeniorEngineer';
    }

    return s;
  }

  public saveSettings(partial: Partial<AppSettings>): AppSettings {
    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const [k, v] of Object.entries(partial)) {
        if (v !== undefined && v !== null) {
          const strVal = typeof v === 'string' ? v.trim() : String(v);
          this.stmtSetSetting.run(k, strVal);
        }
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      console.error('[DataStore] Failed to save settings to SQLite:', err);
    }
    return this.getSettings();
  }

  public getProjects(): ProjectInfo[] {
    const map = new Map<string, ProjectInfo>();
    const rows = this.stmtGetAllProjects.all();

    for (const r of rows) {
      map.set(r.path, {
        id: r.id,
        name: r.name,
        path: r.path,
        gitRepo: r.git_repo || undefined,
        gitBranch: r.git_branch || undefined,
        createdAt: r.created_at,
      });
    }

    // Also include unique workspace paths found in sessions
    const sessionRows = this.db.prepare('SELECT DISTINCT workspace_path, created_at FROM sessions WHERE workspace_path IS NOT NULL').all();
    for (const s of sessionRows) {
      if (s.workspace_path && !map.has(s.workspace_path)) {
        map.set(s.workspace_path, {
          id: s.workspace_path,
          name: path.basename(s.workspace_path),
          path: s.workspace_path,
          createdAt: s.created_at || Date.now(),
        });
      }
    }

    return Array.from(map.values());
  }

  public addProject(projectPath: string, name?: string): ProjectInfo {
    const pName = name || path.basename(projectPath);
    const info: ProjectInfo = {
      id: projectPath,
      name: pName,
      path: projectPath,
      createdAt: Date.now(),
    };
    this.stmtUpsertProject.run(
      info.id,
      info.name,
      info.path,
      info.gitRepo || null,
      info.gitBranch || null,
      info.createdAt
    );
    return info;
  }

  public deleteProject(projectPath: string): { success: boolean; deletedSessionsCount: number } {
    this.db.exec('BEGIN TRANSACTION');
    let deletedCount = 0;
    try {
      this.stmtDeleteProject.run(projectPath);
      const res = this.db.prepare('DELETE FROM sessions WHERE workspace_path = ?').run(projectPath);
      deletedCount = res.changes || 0;
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      console.error('[DataStore] Failed to delete project from SQLite:', err);
    }
    return { success: true, deletedSessionsCount: deletedCount };
  }

  private loadAllIntoCache() {
    this.sessionsCache.clear();
    const rows = this.stmtGetSessions.all();
    for (const r of rows) {
      const sess = this.mapSessionRow(r);
      this.sessionsCache.set(sess.id, sess);
    }
  }

  public getSessions(workspacePath?: string): ChatSession[] {
    const all = Array.from(this.sessionsCache.values()).sort(
      (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)
    );
    if (workspacePath) {
      return all.filter((s) => s.workspacePath === workspacePath);
    }
    return all;
  }

  public getSession(id: string): ChatSession | undefined {
    return this.sessionsCache.get(id);
  }

  private mapSessionRow(r: any): ChatSession {
    const msgRows = this.stmtGetMessagesBySession.all(r.id);
    const messages: ChatMessage[] = msgRows.map((m: any) => ({
      id: m.id,
      sessionId: m.session_id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      attachments: m.attachments ? JSON.parse(m.attachments) : undefined,
      toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
      executionDuration: m.execution_duration || undefined,
    }));

    return {
      id: r.id,
      title: r.title,
      mode: r.mode,
      workspacePath: r.workspace_path || undefined,
      julesSessionId: r.jules_session_id || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      messages,
    };
  }

  public saveSession(session: ChatSession): ChatSession {
    // 1. Immediately update in-memory cache for 0ms UI reactivity
    this.sessionsCache.set(session.id, session);

    // 2. Persist to SQLite WAL
    this.db.exec('BEGIN TRANSACTION');
    try {
      this.stmtUpsertSession.run(
        session.id,
        session.title,
        session.mode,
        session.workspacePath || null,
        session.julesSessionId || null,
        session.createdAt,
        session.updatedAt || Date.now(),
        null
      );

      if (Array.isArray(session.messages)) {
        for (const m of session.messages) {
          this.stmtInsertMessage.run(
            m.id,
            session.id,
            m.role,
            m.content,
            m.timestamp,
            m.attachments ? JSON.stringify(m.attachments) : null,
            m.toolCalls ? JSON.stringify(m.toolCalls) : null,
            m.executionDuration || null
          );
        }
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      console.error('[DataStore] Failed to save session to SQLite:', err);
    }
    return session;
  }

  public updateSession(id: string, updates: Partial<ChatSession>): ChatSession | null {
    const existing = this.sessionsCache.get(id);
    if (!existing) return null;

    const merged = { ...existing, ...updates, updatedAt: Date.now() };
    return this.saveSession(merged);
  }

  public deleteSession(id: string): boolean {
    this.sessionsCache.delete(id);
    const res = this.stmtDeleteSession.run(id);
    return res.changes > 0;
  }

  public addMessage(sessionId: string, message: ChatMessage): void {
    // 1. Immediately update in-memory cache for instant UI rendering
    const existing = this.sessionsCache.get(sessionId);
    if (existing) {
      if (!existing.messages) existing.messages = [];
      const idx = existing.messages.findIndex((m) => m.id === message.id);
      if (idx !== -1) {
        existing.messages[idx] = message;
      } else {
        existing.messages.push(message);
      }
      existing.updatedAt = Date.now();
    }

    // 2. Persist message to SQLite
    this.db.exec('BEGIN TRANSACTION');
    try {
      this.stmtInsertMessage.run(
        message.id,
        sessionId,
        message.role,
        message.content,
        message.timestamp,
        message.attachments ? JSON.stringify(message.attachments) : null,
        message.toolCalls ? JSON.stringify(message.toolCalls) : null,
        message.executionDuration || null
      );
      this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), sessionId);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      console.error('[DataStore] Failed to insert message in SQLite:', err);
    }
  }

  // ── Duty Shifts (Long-Running Tasks) ──────────────────────────────
  private mapDutyShiftRow(row: any): DutyShift {
    let phases: any[] = [];
    try {
      phases = JSON.parse(row.phases_completed || '[]');
    } catch (_) {}

    return {
      id: row.id,
      sessionId: row.session_id,
      missionPrompt: row.mission_prompt,
      totalHours: Number(row.total_hours),
      durationMs: Number(row.duration_ms),
      startedAt: Number(row.started_at),
      targetEndAt: Number(row.target_end_at),
      status: row.status,
      phasesCompleted: phases,
      lastCheckAt: Number(row.last_check_at),
    };
  }

  public getActiveDutyShift(sessionId?: string): DutyShift | null {
    try {
      const row = sessionId
        ? this.stmtGetActiveDutyShiftBySession.get(sessionId)
        : this.stmtGetActiveDutyShift.get();
      return row ? this.mapDutyShiftRow(row) : null;
    } catch (err) {
      console.error('[DataStore] Error getting active duty shift:', err);
      return null;
    }
  }

  public getDutyShiftById(id: string): DutyShift | null {
    try {
      const row = this.stmtGetDutyShiftById.get(id);
      return row ? this.mapDutyShiftRow(row) : null;
    } catch (err) {
      console.error('[DataStore] Error getting duty shift by id:', err);
      return null;
    }
  }

  public saveDutyShift(shift: DutyShift): DutyShift {
    try {
      this.stmtUpsertDutyShift.run(
        shift.id,
        shift.sessionId,
        shift.missionPrompt,
        shift.totalHours,
        shift.durationMs,
        shift.startedAt,
        shift.targetEndAt,
        shift.status,
        JSON.stringify(shift.phasesCompleted || []),
        shift.lastCheckAt || Date.now(),
        null
      );
    } catch (err) {
      console.error('[DataStore] Failed to save duty shift:', err);
    }
    return shift;
  }

  public updateDutyShift(id: string, updates: Partial<DutyShift>): DutyShift | null {
    const existing = this.getDutyShiftById(id);
    if (!existing) return null;

    const merged: DutyShift = { ...existing, ...updates };
    return this.saveDutyShift(merged);
  }
}
