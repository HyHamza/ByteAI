import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface GitRepoInfo {
  repo: string | null;
  branch: string | null;
  rawRemoteUrl: string | null;
}

export function detectGitRepo(dir: string): GitRepoInfo {
  if (!dir) return { repo: null, branch: null, rawRemoteUrl: null };

  try {
    if (!fs.existsSync(dir)) return { repo: null, branch: null, rawRemoteUrl: null };

    // Check if .git folder or file exists
    const gitPath = path.join(dir, '.git');
    if (!fs.existsSync(gitPath)) {
      return { repo: null, branch: null, rawRemoteUrl: null };
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

    if (!originUrl) {
      return { repo: null, branch, rawRemoteUrl: null };
    }

    // Parse GitHub format:
    // https://github.com/Owner/Repo.git or git@github.com:Owner/Repo.git
    const cleaned = originUrl.replace(/\.git$/i, '').trim();
    const match = cleaned.match(/github\.com[:/]([^/]+)\/([^/]+)/i);

    if (match) {
      const owner = match[1];
      const repoName = match[2];
      return {
        repo: `sources/github/${owner}/${repoName}`,
        branch,
        rawRemoteUrl: originUrl,
      };
    }

    return { repo: null, branch, rawRemoteUrl: originUrl };
  } catch (err) {
    return { repo: null, branch: null, rawRemoteUrl: null };
  }
}
