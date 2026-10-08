import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AppSettings, ChatSession, ChatMessage } from '@/shared/types';

const DATA_DIR = path.join(os.homedir(), '.seniorengineer');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

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

interface AppDatabase {
  settings: AppSettings;
  sessions: Record<string, ChatSession>;
}

export class DataStore {
  private static instance: DataStore;
  private db: AppDatabase;

  private constructor() {
    this.ensureDir();
    this.db = this.load();
    this.syncJulesKeyFromSkill();
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

  private load(): AppDatabase {
    if (fs.existsSync(STORE_PATH)) {
      try {
        const raw = fs.readFileSync(STORE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
          sessions: parsed.sessions || {},
        };
      } catch (err) {
        console.error('Failed to parse database, initializing fresh store:', err);
      }
    }
    return {
      settings: { ...DEFAULT_SETTINGS },
      sessions: {},
    };
  }

  private save() {
    try {
      this.ensureDir();
      fs.writeFileSync(STORE_PATH, JSON.stringify(this.db, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save store:', err);
    }
  }

  /**
   * If user already has Jules key configured in ~/.gemini/config/skills/jules/.jules_key,
   * automatically import it as default so the user doesn't need to re-type it.
   */
  private syncJulesKeyFromSkill() {
    if (!this.db.settings.julesApiKey) {
      const julesKeyPath = path.join(os.homedir(), '.gemini', 'config', 'skills', 'jules', '.jules_key');
      if (fs.existsSync(julesKeyPath)) {
        try {
          const key = fs.readFileSync(julesKeyPath, 'utf-8').trim();
          if (key) {
            this.db.settings.julesApiKey = key;
            this.save();
          }
        } catch (_) {}
      }
    }
  }

  public getSettings(): AppSettings {
    const s = { ...this.db.settings };
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
    this.db.settings = { ...this.db.settings, ...partial };
    this.save();
    return this.getSettings();
  }

  public getSessions(workspacePath?: string): ChatSession[] {
    const list = Object.values(this.db.sessions);
    let changed = false;
    for (const s of list) {
      const isBadTitle = !s.title || 
        s.title === 'New Task' || 
        s.title === 'Initial Task' || 
        s.title.toLowerCase() === 'hi' || 
        s.title.toLowerCase() === 'hello' || 
        s.title.toLowerCase().startsWith('hello! how can i assist') ||
        s.title === 'Implement AI Chatbot';

      if (isBadTitle && s.messages && s.messages.length > 0) {
        const substantiveMsg = s.messages.find((m) => m.role === 'user' && isSubstantiveMessage(m.content));
        if (substantiveMsg && substantiveMsg.content) {
          const clean = substantiveMsg.content
            .replace(/[#*`_~\[\]]/g, '')
            .split('\n')[0]
            .trim();
          if (clean) {
            const words = clean.split(/\s+/).slice(0, 6).join(' ');
            s.title = words.length > 36 ? words.slice(0, 36) + '...' : words;
            changed = true;
          }
        } else {
          s.title = 'New Conversation';
          changed = true;
        }
      }

      // Filter out empty ghost messages
      if (s.messages && s.messages.length > 0) {
        const origLen = s.messages.length;
        s.messages = s.messages.filter(
          (m) => (m.content && m.content.trim()) || (m.toolCalls && m.toolCalls.length > 0)
        );
        if (s.messages.length !== origLen) {
          changed = true;
        }
      }
    }
    if (changed) this.save();

    if (!workspacePath) return list.sort((a, b) => b.updatedAt - a.updatedAt);
    return list
      .filter((s) => s.workspacePath === workspacePath)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public getSession(id: string): ChatSession | undefined {
    return this.db.sessions[id];
  }

  public saveSession(session: ChatSession): ChatSession {
    this.db.sessions[session.id] = session;
    this.save();
    return session;
  }

  public updateSession(id: string, updates: Partial<ChatSession>): ChatSession | null {
    const session = this.db.sessions[id];
    if (session) {
      Object.assign(session, updates);
      session.updatedAt = Date.now();
      this.save();
      return session;
    }
    return null;
  }

  public deleteSession(id: string): boolean {
    if (this.db.sessions[id]) {
      delete this.db.sessions[id];
      this.save();
      return true;
    }
    return false;
  }

  public addMessage(sessionId: string, message: ChatMessage): void {
    const session = this.db.sessions[sessionId];
    if (session) {
      session.messages.push(message);
      session.updatedAt = Date.now();
      this.save();
    }
  }
}
