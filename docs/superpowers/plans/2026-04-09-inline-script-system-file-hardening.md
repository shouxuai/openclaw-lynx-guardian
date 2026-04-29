# Inline Script System-File Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the blacklist so inline `node`, `python`, `perl`, and `ruby` commands that delete, overwrite, append to, rename into, or recursively remove protected system targets are blocked as `critical`, including when these inline interpreters appear inside wrapper executors.

**Architecture:** Extract shared protected-target regex fragments and shared inline file-operation fragments in `src/blacklist.ts`, then compose them into per-language direct `CRITICAL_EXEC` rules and reuse the same fragments inside `WRAPPED_DANGEROUS_PAYLOAD`. Keep evaluation order unchanged apart from reusing the stronger payload fragments in the existing wrapper layer.

**Tech Stack:** TypeScript, Vitest, regex-based blacklist matching in Lynx Guardian.

---

## File Structure

- Modify: `src/blacklist.ts`
  - add shared protected-target fragments and inline-script file-operation fragments;
  - expand `node`, `python`, `perl`, and `ruby` direct critical rules;
  - reuse the same fragments in `WRAPPED_DANGEROUS_PAYLOAD`.
- Modify: `test/blacklist.test.ts`
  - add direct-block, wrapped-block, and safe-allow inline interpreter coverage.

## Task 1: Add Failing Contract Tests

**Files:**
- Modify: `test/blacklist.test.ts`
- Test: `test/blacklist.test.ts`

- [ ] **Step 1: Write the failing critical coverage**

Add this test block inside `describe('checkExecBlacklist (Critical)'...)` in `test/blacklist.test.ts`:

```ts
    it('should block inline interpreters modifying protected system targets', () => {
      const inlineCriticalCommands = [
        'perl -e "unlink \'/etc/passwd\'"',
        'perl -e "open my $fh, \'>\', \'/etc/sudoers\'"',
        'perl -MFile::Path=remove_tree -e "remove_tree(\'C:\\\\Windows\')"',
        'python -c "open(\'/etc/shadow\',\'w\').write(\'x\')"',
        'python -c "import pathlib; pathlib.Path(\'C:\\\\Windows\\\\System32\\\\config\\\\SAM\').write_text(\'x\')"',
        'python -c "import os; os.rename(\'tmp\', \'/etc/passwd\')"',
        'ruby -e "File.delete(\'/etc/passwd\')"',
        'ruby -e "File.write(\'/etc/shadow\', \'x\')"',
        'ruby -e "require \'fileutils\'; FileUtils.rm_rf(\'C:\\\\Windows\')"',
        'node -e "require(\'fs\').unlinkSync(\'/etc/passwd\')"',
        'node -e "require(\'fs\').appendFileSync(\'/etc/sudoers\', \'x\')"',
        'node -e "require(\'fs\').renameSync(\'tmp\', \'C:\\\\Windows\\\\System32\\\\config\\\\SAM\')"',
        'ssh prod \'perl -e "unlink \\"/etc/passwd\\""\'',
      ];

      for (const command of inlineCriticalCommands) {
        expect(checkExecBlacklist(command)?.level, command).toBe('critical');
      }
    });
```

- [ ] **Step 2: Write the failing safe coverage**

Add this test block inside `describe('checkExecBlacklist (Safe)'...)`:

```ts
    it('should allow inline interpreters on non-protected targets', () => {
      const inlineSafeCommands = [
        'perl -e "unlink \'notes.txt\'"',
        'perl -e "open my $fh, \'<\', \'/tmp/demo\'"',
        'python -c "open(\'notes.txt\',\'w\').write(\'x\')"',
        'python -c "import pathlib; pathlib.Path(\'README.md\').write_text(\'x\')"',
        'ruby -e "File.write(\'notes.txt\', \'x\')"',
        'node -e "require(\'fs\').writeFileSync(\'notes.txt\', \'x\')"',
      ];

      for (const command of inlineSafeCommands) {
        expect(checkExecBlacklist(command), command).toBeNull();
      }
    });
```

- [ ] **Step 3: Run the focused test to verify it fails**

Run: `npx vitest run test/blacklist.test.ts`

Expected: FAIL because the current `perl`, `python`, `ruby`, and `node` rules do not consistently connect protected targets to destructive inline file primitives, and wrapper payload detection does not yet reuse those stronger fragments.

## Task 2: Extract Shared Protected-Target Fragments

**Files:**
- Modify: `src/blacklist.ts`
- Test: `test/blacklist.test.ts`

- [ ] **Step 1: Add shared target fragments near the top of the file**

Insert these constants after the `Rule` interface:

```ts
const PROTECTED_UNIX_FILE = String.raw`\/etc\/(?:passwd|shadow|sudoers)`;
const PROTECTED_UNIX_ROOT = String.raw`\/(?:boot|bin|sbin|usr|var)(?:\/|['"]|$)`;
const PROTECTED_WINDOWS_FILE = String.raw`[A-Za-z]:\\\\Windows\\\\System32\\\\config\\\\(?:SAM|SECURITY|SYSTEM)`;
const PROTECTED_WINDOWS_ROOT =
  String.raw`[A-Za-z]:\\\\(?:Windows(?:\\\\|['"]|$)|Program Files(?:\s\(x86\))?(?:\\\\|['"]|$)|ProgramData(?:\\\\|['"]|$)|Boot(?:\\\\|['"]|$))`;
const INLINE_PROTECTED_TARGET =
  String.raw`(?:${PROTECTED_UNIX_FILE}|${PROTECTED_UNIX_ROOT}|${PROTECTED_WINDOWS_FILE}|${PROTECTED_WINDOWS_ROOT})`;
```

- [ ] **Step 2: Add shared inline file-operation fragments**

Insert these constants below the target fragments:

```ts
const INLINE_WRITE_MODE = String.raw`(?:>|>>|['"][wa]\+?['"])`;
const INLINE_NODE_FILE_OP =
  String.raw`\b(?:unlinkSync|rmSync|rmdirSync|writeFileSync|appendFileSync|renameSync)\b[^\n\r]*${INLINE_PROTECTED_TARGET}`;
const INLINE_PYTHON_FILE_OP =
  String.raw`(?:\b(?:os\.(?:remove|unlink|rename)|shutil\.(?:rmtree|move))\b[^\n\r]*${INLINE_PROTECTED_TARGET}|\bopen\s*\(\s*['"]${INLINE_PROTECTED_TARGET}['"]\s*,\s*['"][wa+][^'"]*['"]|\bpathlib\.Path\s*\(\s*['"]${INLINE_PROTECTED_TARGET}['"]\s*\)\.(?:write_text|write_bytes)\b)`;
const INLINE_PERL_FILE_OP =
  String.raw`(?:\bunlink\s*['"]${INLINE_PROTECTED_TARGET}['"]|\b(?:open|sysopen)\b[^\n\r]*${INLINE_WRITE_MODE}[^\n\r]*${INLINE_PROTECTED_TARGET}|\brename\b[^\n\r]*${INLINE_PROTECTED_TARGET}|\bremove_tree\b[^\n\r]*${INLINE_PROTECTED_TARGET})`;
const INLINE_RUBY_FILE_OP =
  String.raw`(?:\b(?:File\.(?:delete|unlink|write|rename)|FileUtils\.(?:rm_rf|mv))\b[^\n\r]*${INLINE_PROTECTED_TARGET}|\bFile\.open\s*\(\s*['"]${INLINE_PROTECTED_TARGET}['"]\s*,\s*['"][wa]\+?['"])`;
const INLINE_INTERPRETER_FILE_OP =
  String.raw`(?:${INLINE_NODE_FILE_OP}|${INLINE_PYTHON_FILE_OP}|${INLINE_PERL_FILE_OP}|${INLINE_RUBY_FILE_OP})`;
```

- [ ] **Step 3: Update `WRAPPED_DANGEROUS_PAYLOAD` to reuse the shared inline fragment**

Replace the current `WRAPPED_DANGEROUS_PAYLOAD` definition with:

```ts
const WRAPPED_DANGEROUS_PAYLOAD =
  String.raw`(?:rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+\/|curl\b[^\n\r]*\|\s*(?:bash|sh)\b|wget\b[^\n\r]*\|\s*(?:bash|sh)\b|(?:iwr|Invoke-WebRequest)\b[^\n\r]*\|\s*(?:iex|Invoke-Expression)\b|(?:>>?|(?:echo|tee)\b[^\n\r]*>>?)\s*(?:${PROTECTED_UNIX_FILE}|${PROTECTED_WINDOWS_FILE})|(?:nc\b[^\n\r]*\s-e\s+|ncat\b[^\n\r]*--(?:exec|sh-exec)\b|socat\b[^\n\r]*\bexec\b|\/dev\/tcp\/|New-Object\s+[^\n\r]*TCPClient)|--privileged\b|(?:-v|--volume)\s*\/:\s*\/host\b|nsenter\b|chroot\s+\/host\b|Remove-Item\b[^\n\r]*(?:-Recurse|-r)\b[^\n\r]*${PROTECTED_WINDOWS_ROOT}|del\s+\/[fFsS][^\n\r]*${PROTECTED_WINDOWS_ROOT}|Start-Process\b[^\n\r]*-Verb\s+RunAs\b|${INLINE_INTERPRETER_FILE_OP})`;
```

## Task 3: Replace Narrow Per-Language Rules

**Files:**
- Modify: `src/blacklist.ts`
- Test: `test/blacklist.test.ts`

- [ ] **Step 1: Replace the narrow Node filesystem rules**

Replace the two existing `node -e` dangerous filesystem rules with this pair:

```ts
  {
    pattern: new RegExp(String.raw`\bnode\s+(-e|--eval)\s+.*${INLINE_NODE_FILE_OP}`, "i"),
    reason: "node -e with dangerous fs op on protected system target",
  },
```

Keep the separate subprocess, socket, VM, and eval rules unchanged.

- [ ] **Step 2: Replace the narrow Python filesystem rules**

Replace the existing Python file-delete and protected-write path rules with:

```ts
  {
    pattern: new RegExp(String.raw`\bpython[23]?\s+(-c|--command)\s+.*${INLINE_PYTHON_FILE_OP}`, "i"),
    reason: "python -c with dangerous fs op on protected system target",
  },
```

Keep the existing Python socket, `__import__`, and exec/eval rules unchanged.

- [ ] **Step 3: Replace the narrow Perl rule**

Replace the current Perl filesystem rule with:

```ts
  {
    pattern: new RegExp(String.raw`\bperl\s+(-e|--eval)\s+.*${INLINE_PERL_FILE_OP}`, "i"),
    reason: "perl -e with dangerous fs op on protected system target",
  },
```

- [ ] **Step 4: Replace the broad Ruby filesystem rule**

Replace the current Ruby filesystem rule with:

```ts
  {
    pattern: new RegExp(String.raw`\bruby\s+(-e|--eval)\s+.*${INLINE_RUBY_FILE_OP}`, "i"),
    reason: "ruby -e with dangerous fs op on protected system target",
  },
```

Keep the Ruby socket rule unchanged.

- [ ] **Step 5: Run the focused blacklist test to verify it passes**

Run: `npx vitest run test/blacklist.test.ts`

Expected: PASS, including the new direct inline-interpreter critical cases, the wrapped Perl case, and the non-protected safe samples.

## Task 4: Verification Sweep

**Files:**
- Modify: `src/blacklist.ts`
- Modify: `test/blacklist.test.ts`
- Test: `test/blacklist.test.ts`

- [ ] **Step 1: Run the exact verification command**

Run: `npx vitest run test/blacklist.test.ts`

Expected: PASS with all blacklist tests green.

- [ ] **Step 2: Re-check key direct and wrapped commands**

Confirm these remain blocked:

```ts
[
  'perl -e "unlink \'/etc/passwd\'"',
  'python -c "open(\'/etc/shadow\',\'w\').write(\'x\')"',
  'ruby -e "File.write(\'/etc/shadow\', \'x\')"',
  'node -e "require(\'fs\').unlinkSync(\'/etc/passwd\')"',
  'ssh prod \'perl -e "unlink \\"/etc/passwd\\""\'',
]
```

Confirm these remain allowed:

```ts
[
  'perl -e "unlink \'notes.txt\'"',
  'python -c "open(\'notes.txt\',\'w\').write(\'x\')"',
  'ruby -e "File.write(\'notes.txt\', \'x\')"',
  'node -e "require(\'fs\').writeFileSync(\'notes.txt\', \'x\')"',
]
```

- [ ] **Step 3: Commit**

```bash
git add src/blacklist.ts test/blacklist.test.ts
git commit -m "feat: harden inline script system file blacklist"
```
