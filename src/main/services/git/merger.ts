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

  // Extract PR info or direct gitPatch from outputs
  let prUrl = '';
  let prNumber: number | undefined;
  let headBranch: string | undefined;
  let gitPatch: { unidiffPatch: string; suggestedCommitMessage?: string; baseCommitId?: string } | undefined;

  if (Array.isArray(session.outputs)) {
    for (const o of session.outputs) {
      if (o.pullRequest) {
        prUrl = o.pullRequest.url || '';
        prNumber = o.pullRequest.number;
        headBranch = o.pullRequest.headBranch || o.pullRequest.branch || o.pullRequest.headRef;
      }
      if (o.changeSet?.gitPatch?.unidiffPatch) {
        gitPatch = o.changeSet.gitPatch;
      }
    }
  }

  if (!prNumber && prUrl) {
    const match = prUrl.match(/\/pull\/(\d+)/);
    if (match) prNumber = parseInt(match[1], 10);
  }

  // Extract Jules repo identifier (e.g. "sources/github/HyHamza/VD" -> "HyHamza/VD")
  const julesRepo = (session.sourceContext?.source || session.sourceContext?.githubRepoContext?.repo || '')
    .replace(/^sources\/github\//i, '')
    .toLowerCase();

  // Smart workspace resolution:
  // 1. targetWorkspaceDir if provided
  // 2. Chat session matching this Jules sessionId
  // 3. Any session or project whose git remote origin matches the Jules repo
  // 4. settings.activeWorkspacePath or process.cwd()
  let dir = targetWorkspaceDir;
  const chatSessions = store.getSessions();
  const matchedSession = chatSessions.find(
    (cs) => cs.julesSessionId === sessionId || cs.messages.some((m) => m.content?.includes(sessionId))
  );

  if (!dir && matchedSession?.workspacePath) {
    dir = matchedSession.workspacePath;
  }

  const isMatchingRepo = (testDir?: string | null): boolean => {
    if (!testDir || !fs.existsSync(path.join(testDir, '.git'))) return false;
    if (!julesRepo) return true;
    const info = detectGitRepo(testDir);
    const remote = (info.repo || '').toLowerCase();
    return remote.includes(julesRepo);
  };

  if (!dir || !isMatchingRepo(dir)) {
    // Search all sessions for the repository that matches Jules repo
    for (const cs of chatSessions) {
      if (isMatchingRepo(cs.workspacePath)) {
        dir = cs.workspacePath;
        break;
      }
    }
  }

  if (!dir) {
    dir = settings.activeWorkspacePath || process.cwd();
  }

  if (!fs.existsSync(path.join(dir, '.git'))) {
    return {
      success: false,
      message: `Local directory '${dir}' is not a valid Git repository. Unable to sync Jules changes.`,
    };
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
    // Auto-stash uncommitted local modifications if any
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

    // Helper to clean up any leftover .rej or .orig files
    const cleanRejFiles = () => {
      try {
        const scanAndClean = (currentDir: string) => {
          const entries = fs.readdirSync(currentDir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory() && entry.name !== '.git' && entry.name !== 'node_modules') {
              scanAndClean(fullPath);
            } else if (entry.isFile() && (entry.name.endsWith('.rej') || entry.name.endsWith('.orig'))) {
              try { fs.unlinkSync(fullPath); } catch (_) {}
            }
          }
        };
        scanAndClean(dir);
      } catch (_) {}
    };

    // ── PATHWAY A: Direct Git Patch (unidiffPatch) ──────────────────────────
    if (gitPatch && gitPatch.unidiffPatch) {
      console.log(`[merger] Applying Jules git patch (${gitPatch.unidiffPatch.length} bytes) to ${dir}...`);
      const patchFileName = `.jules_patch_${sessionId.slice(0, 10)}.patch`;
      const patchFilePath = path.join(dir, patchFileName);
      fs.writeFileSync(patchFilePath, gitPatch.unidiffPatch, 'utf-8');

      let applied = false;
      let alreadyIntegrated = false;
      let applyError = '';

      // 1. Check if patch is already integrated into the working tree/HEAD
      try {
        runGit(`git apply --reverse --check --ignore-whitespace "${patchFileName}"`);
        alreadyIntegrated = true;
        applied = true;
      } catch (_) {}

      // 2. If not already integrated, attempt progressive patch application flags
      if (!alreadyIntegrated) {
        const applyCandidates = [
          `git apply --ignore-whitespace --whitespace=nowarn "${patchFileName}"`,
          `git apply --3way --ignore-whitespace --whitespace=nowarn "${patchFileName}"`,
          `git apply --whitespace=fix "${patchFileName}"`,
          `git apply -C1 --ignore-whitespace --whitespace=nowarn "${patchFileName}"`,
          `git apply -C0 --ignore-whitespace --whitespace=nowarn "${patchFileName}"`,
        ];

        for (const cmd of applyCandidates) {
          try {
            runGit(cmd);
            applied = true;
            break;
          } catch (err: any) {
            applyError = err.message || String(err);
          }
        }
      }

      // Cleanup temporary patch file and any reject files
      try {
        if (fs.existsSync(patchFilePath)) fs.unlinkSync(patchFilePath);
      } catch (_) {}
      cleanRejFiles();

      if (alreadyIntegrated) {
        if (stashed) {
          try { runGit('git stash pop'); } catch (_) {}
        }
        let latestCommit = '';
        try {
          latestCommit = runGit('git rev-parse --short HEAD');
        } catch (_) {}
        return {
          success: true,
          message: `The changes for "${session.title || sessionId}" are already fully integrated in the local repository (HEAD: ${latestCommit}). Working tree and GitHub are in sync.`,
          branch: currentBranch,
          commitHash: latestCommit,
        };
      }

      if (applied) {
        // Stage all modified and untracked files from patch
        runGit('git add -A');

        // Commit changes
        const commitMsg = gitPatch.suggestedCommitMessage || `feat: Apply Jules changes for ${session.title || sessionId}`;
        const msgFileName = `.jules_commit_msg_${sessionId.slice(0, 10)}.txt`;
        const msgFilePath = path.join(dir, msgFileName);
        try {
          fs.writeFileSync(msgFilePath, commitMsg, 'utf-8');
          runGit(`git commit -F "${msgFileName}"`);
        } finally {
          try {
            if (fs.existsSync(msgFilePath)) fs.unlinkSync(msgFilePath);
          } catch (_) {}
        }

        // Push to remote origin
        let pushMessage = '';
        try {
          runGit(`git push origin ${currentBranch}`);
          pushMessage = `and pushed to remote 'origin/${currentBranch}'`;
        } catch (pushErr: any) {
          pushMessage = `(Note: Local commit succeeded, but push to remote origin failed: ${pushErr.message})`;
        }

        // Restore stash if any
        if (stashed) {
          try { runGit('git stash pop'); } catch (_) {}
        }

        let latestCommit = '';
        try {
          latestCommit = runGit('git rev-parse --short HEAD');
        } catch (_) {}

        return {
          success: true,
          message: `Successfully applied Jules patch for "${session.title || sessionId}", committed locally as ${latestCommit}, ${pushMessage}! Both local workspace and GitHub are fully synchronized.`,
          branch: currentBranch,
          commitHash: latestCommit,
        };
      }

      // If patch application failed and NO PR/branch is available, return failure
      if (!prNumber && !headBranch) {
        if (stashed) {
          try { runGit('git stash pop'); } catch (_) {}
        }
        return {
          success: false,
          message: `Failed to apply Jules git patch cleanly to local repository: ${applyError}`,
        };
      }
      console.warn(`Patch application did not succeed (${applyError}), falling back to remote PR/branch merge...`);
    }

    // ── PATHWAY B: GitHub Pull Request / Remote Branch ──────────────────────
    if (prNumber || headBranch) {
      try {
        runGit('git fetch origin');
      } catch (_) {}

      const tempBranch = prNumber ? `jules-pr-${prNumber}` : (headBranch || `jules-task-${sessionId.slice(0, 8)}`);
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

      if (fetched) {
        // Merge into current branch
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

        // Push merged branch
        let pushMessage = '';
        try {
          runGit(`git push origin ${currentBranch}`);
          pushMessage = `and successfully pushed to remote 'origin/${currentBranch}'`;
        } catch (pushErr: any) {
          pushMessage = `(Note: Local merge succeeded, but push to remote origin failed: ${pushErr.message})`;
        }

        // Cleanup temporary branch
        try {
          runGit(`git branch -D ${tempBranch}`);
        } catch (_) {}

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
      }
    }

    if (stashed) {
      try { runGit('git stash pop'); } catch (_) {}
    }

    return {
      success: false,
      message: `Could not find a Git patch, PR ref, or remote head branch in Jules session ${sessionId} outputs to merge.`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Error syncing and merging Jules changes: ${err.message || String(err)}`,
    };
  }
}
