import https from 'https';
import type { JulesSessionSummary, JulesActivity } from '../../../shared/types';
import { DataStore } from '../db/store';

const JULES_API_BASE = 'https://jules.googleapis.com/v1alpha';

export class JulesClient {
  private static instance: JulesClient;

  public static getInstance(): JulesClient {
    if (!JulesClient.instance) {
      JulesClient.instance = new JulesClient();
    }
    return JulesClient.instance;
  }

  private getApiKey(): string {
    const settings = DataStore.getInstance().getSettings();
    const key = settings.julesApiKey || process.env.JULES_API_KEY;
    if (!key) {
      throw new Error('Jules API Key not found. Please set it in Settings or environment variable JULES_API_KEY.');
    }
    return key.trim();
  }

  private async request<T>(path: string, options: { method?: string; body?: any } = {}): Promise<T> {
    const apiKey = this.getApiKey();
    const url = `${JULES_API_BASE}${path}`;

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const reqOptions: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
          'User-Agent': 'SeniorEngineer-App/1.0',
        },
      };

      const req = https.request(reqOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(data ? JSON.parse(data) : ({} as T));
            } catch (err) {
              reject(new Error(`Failed to parse response JSON: ${data}`));
            }
          } else {
            reject(new Error(`Jules API error ${res.statusCode}: ${data}`));
          }
        });
      });

      req.setTimeout(4000, () => {
        req.destroy(new Error('Jules request timed out after 4s'));
      });

      req.on('error', (err) => reject(err));

      if (options.body) {
        req.write(JSON.stringify(options.body));
      }
      req.end();
    });
  }

  public async listSessions(): Promise<JulesSessionSummary[]> {
    const settings = DataStore.getInstance().getSettings();
    if (!settings.julesApiKey && !process.env.JULES_API_KEY) {
      return [];
    }
    try {
      const resp = await this.request<{ sessions?: any[] }>('/sessions?pageSize=30');
      if (!resp.sessions) return [];

      return resp.sessions.map((s) => {
        let prUrl: string | undefined;
        let prNumber: number | undefined;
        if (Array.isArray(s.outputs)) {
          for (const o of s.outputs) {
            if (o.pullRequest) {
              prUrl = o.pullRequest.url;
              prNumber = o.pullRequest.number;
              break;
            }
          }
        }
        return {
          id: s.name ? s.name.replace('sessions/', '') : (s.id || ''),
          title: s.title || s.name,
          state: s.state || 'STATE_UNSPECIFIED',
          repo: s.sourceContext?.source || s.sourceContext?.github?.repo || '',
          branch: s.sourceContext?.githubRepoContext?.startingBranch || s.sourceContext?.github?.startingBranch || 'main',
          createdAt: s.createTime || new Date().toISOString(),
          updatedAt: s.updateTime || new Date().toISOString(),
          prUrl,
          prNumber,
        };
      });
    } catch (_) {
      return [];
    }
  }

  public async getSession(sessionId: string): Promise<any> {
    const cleanId = sessionId.replace('sessions/', '');
    return this.request(`/sessions/${cleanId}`);
  }

  public async listActivities(sessionId: string): Promise<JulesActivity[]> {
    const cleanId = sessionId.replace('sessions/', '');
    const resp = await this.request<{ activities?: any[] }>(`/sessions/${cleanId}/activities?pageSize=50`);
    if (!resp.activities) return [];

    return resp.activities.map((a, idx) => ({
      id: a.name || `act_${idx}`,
      type: a.type || 'ACTIVITY',
      description: a.description || a.message || JSON.stringify(a),
      timestamp: a.createTime || new Date().toISOString(),
      metadata: a,
    }));
  }

  public async createSession(params: {
    prompt: string;
    title?: string;
    repo?: string;
    branch?: string;
  }): Promise<{ sessionId: string }> {
    const settings = DataStore.getInstance().getSettings();
    let repo = (params.repo || settings.julesDefaultRepo || process.env.JULES_REPO || '').trim();
    const branch = params.branch || settings.julesDefaultBranch || 'main';

    if (!repo) {
      throw new Error('GitHub repo source required (e.g. sources/github/Owner/Repo). Configure in Settings or pass directly.');
    }

    // Normalize to sources/github/Owner/Repo
    if (!repo.startsWith('sources/github/')) {
      const cleaned = repo.replace(/\.git$/i, '').replace(/^https?:\/\/github\.com\//i, '').replace(/^git@github\.com:/i, '');
      repo = `sources/github/${cleaned}`;
    }

    const payload = {
      title: params.title || `Jules: ${params.prompt.slice(0, 50)}`,
      prompt: params.prompt,
      sourceContext: {
        source: repo,
        githubRepoContext: { startingBranch: branch },
        environmentVariablesEnabled: true,
      },
    };

    const resp = await this.request<any>('/sessions', {
      method: 'POST',
      body: payload,
    });

    const sessionId = resp.name ? resp.name.replace('sessions/', '') : resp.id;
    return { sessionId };
  }

  public async sendFollowup(sessionId: string, prompt: string): Promise<boolean> {
    const cleanId = sessionId.replace('sessions/', '');
    await this.request(`/sessions/${cleanId}:sendMessage`, {
      method: 'POST',
      body: { prompt },
    });
    return true;
  }
}
