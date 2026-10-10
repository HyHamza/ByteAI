import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface GitRepoInfo {
  repo: string | null;
  branch: string | null;
  rawRemoteUrl: string | null;
}

const gitRepoCache = new Map<string, { info: GitRepoInfo; timestamp: number }>();
const CACHE_TTL_MS = 15000;

export function detectGitRepo(dir: string): GitRepoInfo {
  if (!dir) return { repo: null, branch: null, rawRemoteUrl: null };

  const cached = gitRepoCache.get(dir);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.info;
  }

  try {
    if (!fs.existsSync(dir)) return { repo: null, branch: null, rawRemoteUrl: null };

    // Check if .git folder or file exists
    const gitPath = path.join(dir, '.git');
    if (!fs.existsSync(gitPath)) {
      const res = { repo: null, branch: null, rawRemoteUrl: null };
      gitRepoCache.set(dir, { info: res, timestamp: Date.now() });
      return res;
    }

    // Get remote origin URL
    let originUrl = '';
    try {
      originUrl = execSync('git config --get remote.origin.url', {
        cwd: dir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
    } catch (_) {}

    // Get current branch
    let branch = 'main';
    try {
      branch = execSync('git branch --show-current', {
        cwd: dir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim() || 'main';
    } catch (_) {
      try {
        branch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: dir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim() || 'main';
      } catch (_) {}
    }

    let result: GitRepoInfo;
    if (!originUrl) {
      result = { repo: null, branch, rawRemoteUrl: null };
    } else {
      // Parse GitHub format:
      // https://github.com/Owner/Repo.git or git@github.com:Owner/Repo.git
      const cleaned = originUrl.replace(/\.git$/i, '').trim();
      const match = cleaned.match(/github\.com[:/]([^/]+)\/([^/]+)/i);

      if (match) {
        const owner = match[1];
        const repoName = match[2];
        result = {
          repo: `sources/github/${owner}/${repoName}`,
          branch,
          rawRemoteUrl: originUrl,
        };
      } else {
        result = { repo: null, branch, rawRemoteUrl: originUrl };
      }
    }

    gitRepoCache.set(dir, { info: result, timestamp: Date.now() });
    return result;
  } catch (err) {
    const fallback = { repo: null, branch: null, rawRemoteUrl: null };
    gitRepoCache.set(dir, { info: fallback, timestamp: Date.now() });
    return fallback;
  }
}
