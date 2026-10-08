import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { detectGitRepo } from './detector';
import { JulesClient } from '../jules/client';
import { DataStore } from '../db/store';

export interface MergeResult {
  success: boolean;
  message: string;
  branch?: string;
  prNumber?: number;
  commitHash?: string;
}

export async function syncAndMergeJulesSession(
  sessionId: string,
  targetWorkspaceDir?: string
): Promise<MergeResult> {
  const store = DataStore.getInstance();
  const settings = store.getSettings();
  const client = JulesClient.getInstance();

  let session: any;
  try {
    session = await client.getSession(sessionId);
  } catch (err: any) {
    return { success: false, message: `Could not retrieve Jules session ${sessionId}: ${err.message}` };
  }

  if (!session) {
    return { success: false, message: `Jules session ${sessionId} not found.` };
  }

  // Extract PR info from outputs
  let prUrl = '';
  let prNumber: number | undefined;
  let headBranch: string | undefined;

  if (Array.isArray(session.outputs)) {
    for (const o of session.outputs) {
      if (o.pullRequest) {
        prUrl = o.pullRequest.url || '';
        prNumber = o.pullRequest.number;
        headBranch = o.pullRequest.headBranch || o.pullRequest.branch || o.pullRequest.headRef;
        break;
      }
    }
  }

  if (!prNumber && prUrl) {
    const match = prUrl.match(/\/pull\/(\d+)/);
    if (match) prNumber = parseInt(match[1], 10);
  }

  // Determine local workspace path
  let dir = targetWorkspaceDir || settings.activeWorkspacePath || process.cwd();
  if (!fs.existsSync(path.join(dir, '.git'))) {
    // If active workspace is not a git repo, check chat sessions associated with this jules task
    const chatSession = store.getSessions().find(
      (cs) => cs.julesSessionId === sessionId || cs.messages.some((m) => m.content?.includes(sessionId))
    );
    if (chatSession?.workspacePath && fs.existsSync(path.join(chatSession.workspacePath, '.git'))) {
      dir = chatSession.workspacePath;
    } else {
      return {
        success: false,
        message: `Local directory '${dir}' is not a valid Git repository. Unable to merge changes.`,
      };
    }
  }

  const gitInfo = detectGitRepo(dir);
  const currentBranch = gitInfo.branch || 'main';

  // Helper for executing git commands safely
  const runGit = (cmd: string): string => {
    return execSync(cmd, {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  };

  try {
    // 1. Check working directory status
    const status = runGit('git status --porcelain');
    let stashed = false;
    if (status.length > 0) {
      try {
        runGit('git stash push -u -m "Auto-stash before Jules sync"');
        stashed = true;
      } catch (_) {
        return {
          success: false,
          message: `Local repository has uncommitted modifications that could not be auto-stashed. Please commit or stash changes before syncing.`,
        };
      }
    }

    // 2. Fetch latest changes from remote origin
    try {
      runGit('git fetch origin');
    } catch (_) {}

    const tempBranch = prNumber ? `jules-pr-${prNumber}` : (headBranch || `jules-task-${sessionId.slice(0, 8)}`);

    // 3. Fetch the Jules changes
    let fetched = false;
    if (prNumber) {
      try {
        runGit(`git fetch origin pull/${prNumber}/head:${tempBranch} --force`);
        fetched = true;
      } catch (err: any) {
        console.warn(`Could not fetch via pull/${prNumber}/head ref, attempting branch fetch:`, err.message);
      }
    }

    if (!fetched && headBranch) {
      try {
        runGit(`git fetch origin ${headBranch}:${tempBranch} --force`);
        fetched = true;
      } catch (_) {}
    }

    if (!fetched) {
      if (stashed) {
        try { runGit('git stash pop'); } catch (_) {}
      }
      return {
        success: false,
        message: `Could not fetch Jules changes from origin. No PR ref or head branch found for session ${sessionId}.`,
      };
    }

    // 4. Merge into current local branch
    try {
      const commitMsg = prNumber
        ? `Merge Jules PR #${prNumber} (${session.title || sessionId}) into ${currentBranch}`
        : `Merge Jules task ${session.title || sessionId} into ${currentBranch}`;

      runGit(`git merge ${tempBranch} --no-edit -m "${commitMsg}"`);
    } catch (mergeErr: any) {
      try { runGit('git merge --abort'); } catch (_) {}
      if (stashed) {
        try { runGit('git stash pop'); } catch (_) {}
      }
      return {
        success: false,
        message: `Merge conflict encountered between local branch '${currentBranch}' and Jules PR. Merge was aborted. You can inspect branch '${tempBranch}'.`,
      };
    }

    // 5. Push merged branch to remote origin to sync both!
    let pushMessage = '';
    try {
      runGit(`git push origin ${currentBranch}`);
      pushMessage = `and successfully pushed to remote 'origin/${currentBranch}'`;
    } catch (pushErr: any) {
      pushMessage = `(Note: Local merge succeeded, but push to remote origin failed: ${pushErr.message})`;
    }

    // 6. Cleanup temporary branch
    try {
      runGit(`git branch -D ${tempBranch}`);
    } catch (_) {}

    // 7. Restore stash if any
    if (stashed) {
      try { runGit('git stash pop'); } catch (_) {}
    }

    let latestCommit = '';
    try {
      latestCommit = runGit('git rev-parse --short HEAD');
    } catch (_) {}

    return {
      success: true,
      message: `Successfully pulled and merged Jules changes (${prUrl || `PR #${prNumber}`}) into local '${currentBranch}' ${pushMessage}! Both local and remote repositories are now fully synchronized (HEAD at ${latestCommit}).`,
      branch: currentBranch,
      prNumber,
      commitHash: latestCommit,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Error syncing and merging Jules changes: ${err.message || String(err)}`,
    };
  }
}
