import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export interface DiffFile {
  oldPath: string;
  newPath: string;
  isNew: boolean;
  isDeleted: boolean;
  hunks: Array<{
    oldStart: number;
    oldLength: number;
    newStart: number;
    newLength: number;
    lines: string[];
  }>;
}

/**
 * Parses unified diff text into structured file descriptors and hunks.
 */
export function parseUnifiedDiff(diffText: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = diffText.split(/\r?\n/);
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffFile['hunks'][0] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('diff --git ')) {
      if (currentFile) {
        files.push(currentFile);
      }
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      const oldPath = match ? match[1] : '';
      const newPath = match ? match[2] : '';

      currentFile = {
        oldPath,
        newPath,
        isNew: false,
        isDeleted: false,
        hunks: [],
      };
      currentHunk = null;
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith('new file mode') || line.startsWith('--- /dev/null')) {
      currentFile.isNew = true;
      continue;
    }

    if (line.startsWith('deleted file mode') || line.startsWith('+++ /dev/null')) {
      currentFile.isDeleted = true;
      continue;
    }

    if (line.startsWith('@@ ')) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        currentHunk = {
          oldStart: parseInt(match[1], 10),
          oldLength: match[2] !== undefined ? parseInt(match[2], 10) : 1,
          newStart: parseInt(match[3], 10),
          newLength: match[4] !== undefined ? parseInt(match[4], 10) : 1,
          lines: [],
        };
        currentFile.hunks.push(currentHunk);
      }
      continue;
    }

    if (currentHunk) {
      if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line === '') {
        currentHunk.lines.push(line);
      }
    }
  }

  if (currentFile) {
    files.push(currentFile);
  }

  return files;
}

/**
 * Normalizes file content to LF lines for comparison
 */
function normalizeLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Resiliently applies a unified diff patch to a target repository directory.
 * If git apply fails (e.g. whitespace, line endings, deleted file content drift),
 * this falls back to progressive flag combinations, --reject + deleted file cleanup,
 * and intelligent file-level patch application.
 */
export function applyResilientPatch(
  patchText: string,
  targetDir: string,
  sessionId?: string
): { success: boolean; error?: string; appliedVia: string } {
  const patchFileName = `.jules_patch_${(sessionId || 'tmp').slice(0, 10)}.patch`;
  const patchFilePath = path.join(targetDir, patchFileName);
  fs.writeFileSync(patchFilePath, patchText, 'utf-8');

  const runGit = (cmd: string): string => {
    return execSync(cmd, {
      cwd: targetDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    }).trim();
  };

  const cleanRejAndOrig = () => {
    try {
      const scanAndClean = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && entry.name !== '.git' && entry.name !== 'node_modules') {
            scanAndClean(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith('.rej') || entry.name.endsWith('.orig'))) {
            try { fs.unlinkSync(fullPath); } catch (_) {}
          }
        }
      };
      scanAndClean(targetDir);
    } catch (_) {}
  };

  try {
    // 1. Check if already integrated
    try {
      runGit(`git apply --reverse --check --ignore-whitespace "${patchFileName}"`);
      cleanRejAndOrig();
      try { fs.unlinkSync(patchFilePath); } catch (_) {}
      return { success: true, appliedVia: 'already_integrated' };
    } catch (_) {}

    // 2. Progressive standard git apply candidates
    const candidates = [
      `git apply --ignore-whitespace --whitespace=nowarn "${patchFileName}"`,
      `git apply --3way --ignore-whitespace --whitespace=nowarn "${patchFileName}"`,
      `git apply --ignore-space-change --ignore-whitespace --recount --whitespace=nowarn "${patchFileName}"`,
      `git apply --whitespace=fix "${patchFileName}"`,
      `git apply -C1 --ignore-whitespace --whitespace=nowarn "${patchFileName}"`,
      `git apply -C0 --ignore-whitespace --whitespace=nowarn "${patchFileName}"`,
    ];

    for (const cmd of candidates) {
      try {
        runGit(cmd);
        cleanRejAndOrig();
        try { fs.unlinkSync(patchFilePath); } catch (_) {}
        return { success: true, appliedVia: cmd };
      } catch (_) {}
    }

    // 3. Resilient tier: git apply --reject
    // This applies all valid files cleanly, leaving .rej for mismatched hunks/files.
    let rejectSucceeded = false;
    try {
      runGit(`git apply --reject --ignore-space-change --ignore-whitespace --whitespace=nowarn "${patchFileName}"`);
      rejectSucceeded = true;
    } catch (_) {
      // Even if exit code is non-zero, git apply --reject writes valid files to working tree
    }

    // Parse the patch to discover files that should be deleted or created
    const parsedFiles = parseUnifiedDiff(patchText);

    // Clean up deleted files: If a file is marked deleted in the patch, git apply often
    // fails to delete it if any single line had encoding or whitespace divergence.
    for (const f of parsedFiles) {
      if (f.isDeleted && f.oldPath) {
        const fullOld = path.join(targetDir, f.oldPath);
        if (fs.existsSync(fullOld)) {
          try {
            fs.unlinkSync(fullOld);
          } catch (_) {}
        }
      }
    }

    // Ensure new files are created: If git apply missed any new file, write its content
    for (const f of parsedFiles) {
      if (f.isNew && f.newPath) {
        const fullNew = path.join(targetDir, f.newPath);
        if (!fs.existsSync(fullNew)) {
          const contentLines: string[] = [];
          for (const hunk of f.hunks) {
            for (const line of hunk.lines) {
              if (line.startsWith('+')) {
                contentLines.push(line.slice(1));
              }
            }
          }
          try {
            fs.mkdirSync(path.dirname(fullNew), { recursive: true });
            fs.writeFileSync(fullNew, contentLines.join('\n'), 'utf-8');
          } catch (_) {}
        }
      }
    }

    // Handle any .rej files: Attempt fuzzy hunk application
    const handleRejFiles = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== '.git' && entry.name !== 'node_modules') {
          handleRejFiles(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.rej')) {
          const originalTarget = fullPath.slice(0, -4); // remove .rej
          if (fs.existsSync(originalTarget)) {
            try {
              const rejText = fs.readFileSync(fullPath, 'utf-8');
              const rejFiles = parseUnifiedDiff(rejText);
              let targetContent = fs.readFileSync(originalTarget, 'utf-8');
              const targetLines = normalizeLines(targetContent);

              for (const rf of rejFiles) {
                for (const hunk of rf.hunks) {
                  const oldLines = hunk.lines.filter((l) => l.startsWith(' ') || l.startsWith('-')).map((l) => l.slice(1));
                  const newLines = hunk.lines.filter((l) => l.startsWith(' ') || l.startsWith('+')).map((l) => l.slice(1));

                  if (oldLines.length === 0 && newLines.length > 0) {
                    // Insertion hunk
                    targetLines.push(...newLines);
                  } else {
                    // Try to locate oldLines in targetLines (normalized / trimmed)
                    const oldStr = oldLines.map((l) => l.trim()).join('\n');
                    let foundIdx = -1;
                    for (let s = 0; s <= targetLines.length - oldLines.length; s++) {
                      const sliceStr = targetLines.slice(s, s + oldLines.length).map((l) => l.trim()).join('\n');
                      if (sliceStr === oldStr) {
                        foundIdx = s;
                        break;
                      }
                    }

                    if (foundIdx >= 0) {
                      targetLines.splice(foundIdx, oldLines.length, ...newLines);
                    }
                  }
                }
              }

              fs.writeFileSync(originalTarget, targetLines.join('\n'), 'utf-8');
            } catch (_) {}
          }
        }
      }
    };

    handleRejFiles(targetDir);
    cleanRejAndOrig();
    try { fs.unlinkSync(patchFilePath); } catch (_) {}

    // Verify if working tree was modified
    const status = runGit('git status --porcelain');
    if (status.trim().length > 0) {
      return { success: true, appliedVia: 'resilient_reject_and_patch' };
    }

    return {
      success: false,
      error: 'Git patch could not be applied and produced no working tree changes.',
      appliedVia: 'none',
    };
  } catch (err: any) {
    cleanRejAndOrig();
    try { fs.unlinkSync(patchFilePath); } catch (_) {}
    return {
      success: false,
      error: err.message || String(err),
      appliedVia: 'error',
    };
  }
}
