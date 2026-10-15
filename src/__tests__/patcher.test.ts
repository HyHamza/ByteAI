import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff, applyResilientPatch } from '../main/services/git/patcher';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

describe('Resilient Patcher Service', () => {
  it('should parse unified diff correctly into new, deleted, and modified files', () => {
    const diff = `diff --git a/test-del.js b/test-del.js
deleted file mode 100644
index 1234567..0000000
--- a/test-del.js
+++ /dev/null
@@ -1,3 +0,0 @@
-line1
-line2
-line3
diff --git a/test-new.js b/test-new.js
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/test-new.js
@@ -0,0 +1,2 @@
+const a = 1;
+const b = 2;
diff --git a/test-mod.js b/test-mod.js
index 1234567..89abcdef 100644
--- a/test-mod.js
+++ b/test-mod.js
@@ -1,3 +1,3 @@
 line1
-old_line2
+new_line2
 line3
`;

    const parsed = parseUnifiedDiff(diff);
    expect(parsed.length).toBe(3);

    expect(parsed[0].oldPath).toBe('test-del.js');
    expect(parsed[0].isDeleted).toBe(true);

    expect(parsed[1].newPath).toBe('test-new.js');
    expect(parsed[1].isNew).toBe(true);

    expect(parsed[2].newPath).toBe('test-mod.js');
    expect(parsed[2].isNew).toBe(false);
    expect(parsed[2].isDeleted).toBe(false);
  });

  it('should resiliently apply patch with deleted files even when contents have whitespace or encoding differences', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byte-patcher-test-'));
    try {
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'ignore' });

      // Create an existing file that will be deleted, with slightly different whitespace
      fs.writeFileSync(path.join(tempDir, 'to-delete.js'), 'line1\r\nline2_different\r\nline3\r\n');
      fs.writeFileSync(path.join(tempDir, 'existing.js'), 'hello\nworld\n');
      execSync('git add -A && git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });

      // Patch that deletes to-delete.js and modifies existing.js
      const patch = `diff --git a/to-delete.js b/to-delete.js
deleted file mode 100644
--- a/to-delete.js
+++ /dev/null
@@ -1,3 +0,0 @@
-line1
-line2_original
-line3
diff --git a/existing.js b/existing.js
--- a/existing.js
+++ b/existing.js
@@ -1,2 +1,3 @@
 hello
+beautiful
 world
`;

      const res = applyResilientPatch(patch, tempDir, 'test-session');
      expect(res.success).toBe(true);

      // Verify to-delete.js is deleted
      expect(fs.existsSync(path.join(tempDir, 'to-delete.js'))).toBe(false);

      // Verify existing.js has new content
      const modifiedContent = fs.readFileSync(path.join(tempDir, 'existing.js'), 'utf-8');
      expect(modifiedContent).toContain('beautiful');
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });
});
