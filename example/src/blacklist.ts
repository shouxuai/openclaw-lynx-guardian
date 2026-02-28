/**
 * Blacklist rules — pure pattern matching, no LLM involved.
 * Two levels: "critical" (needs 3/3 LLM votes) and "warning" (needs 1/1).
 *
 * IMPORTANT: These patterns are checked against:
 *   - exec: the command string
 *   - write/edit: the file path
 * The caller (index.ts) decides what text to pass in.
 */

export type BlacklistMatch = {
  level: "critical" | "warning";
  pattern: string;
  reason: string;
};

interface Rule {
  pattern: RegExp;
  reason: string;
}

// ── CRITICAL: irreversible destruction or system compromise ────────
// Needs 3/3 LLM votes confirming user intent to pass

const CRITICAL_EXEC: Rule[] = [
  // Filesystem destruction — only recursive rm on system paths
  {
    pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+|--recursive\s+)\/(?!tmp\/|home\/clawdbot\/)/,
    reason: "rm -rf on root-level system path",
  },
  {
    pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+|--recursive\s+)~\//,
    reason: "rm -rf on home directory",
  },
  { pattern: /mkfs\b/, reason: "filesystem format (mkfs)" },
  { pattern: /dd\s+if=.*of=\/dev\//, reason: "raw disk write (dd)" },
  { pattern: />\s*\/dev\/sd/, reason: "redirect to block device" },
  // System auth files (write/modify, not read)
  {
    pattern: /(?:tee|>>?)\s*\/etc\/(?:passwd|shadow|sudoers)/,
    reason: "write to system auth file",
  },
  {
    pattern: /sed\s+-i.*\/etc\/(?:passwd|shadow|sudoers)/,
    reason: "in-place edit of system auth file",
  },
  // System shutdown
  { pattern: /\b(?:shutdown|reboot)\b/, reason: "system shutdown/reboot" },
  { pattern: /\binit\s+[06]\b/, reason: "system halt/reboot (init)" },
  // Kill SSH (locks out remote access)
  { pattern: /systemctl\s+(?:stop|disable)\s+sshd/, reason: "disable SSH (remote lockout)" },
  // === BYPASS PREVENTION ===
  // Absolute path to rm
  { pattern: /\/bin\/rm\s+(-[a-zA-Z]*r[a-zA-Z]*)\s+/, reason: "rm via absolute path" },
  { pattern: /\/usr\/bin\/rm\s+(-[a-zA-Z]*r[a-zA-Z]*)\s+/, reason: "rm via absolute path" },
  // eval with dangerous content
  { pattern: /\beval\s+/, reason: "eval execution (arbitrary code)" },

  // ── Interpreter inline code — dangerous operations ──

  // Node: child_process, exec/spawn
  {
    pattern:
      /\bnode\s+(-e|--eval)\s+.*\b(child_process|\.exec\s*\(|\.spawn\s*\(|\.execSync\s*\(|\.spawnSync\s*\()/,
    reason: "node -e with subprocess execution",
  },
  // Node: dangerous fs ops on system paths
  {
    pattern:
      /\bnode\s+(-e|--eval)\s+.*\b(unlinkSync|rmdirSync|rmSync|writeFileSync)\s*\(\s*['"]\/(?!tmp\/)/,
    reason: "node -e with dangerous fs op on system path",
  },
  // Node: network server creation
  {
    pattern:
      /\bnode\s+(-e|--eval)\s+.*(net\.createServer|http\.createServer|https\.createServer|dgram\.createSocket|tls\.createServer|require\s*\(\s*['"](?:net|http|https|dgram|tls)['"]\s*\)\.create|\.createServer\s*\(|\.createSocket\s*\()/,
    reason: "node -e with network server creation",
  },
  // Node: vm sandbox escape / eval+require
  {
    pattern: /\bnode\s+(-e|--eval)\s+.*\b(vm\.runInNewContext|vm\.runInThisContext)\b/,
    reason: "node -e with VM sandbox escape",
  },
  {
    pattern: /\bnode\s+(-e|--eval)\s+.*\beval\s*\(.*\brequire\b/,
    reason: "node -e with eval+require (code injection)",
  },

  // Python: os.system, subprocess, shutil.rmtree, dangerous file ops
  {
    pattern:
      /\bpython[23]?\s+(-c|--command)\s+.*\b(os\.system|subprocess|shutil\.rmtree|os\.remove|os\.unlink)\b/,
    reason: "python -c with dangerous system call",
  },
  {
    pattern: /\bpython[23]?\s+(-c|--command)\s+.*\bopen\s*\(\s*['"]\/etc\//,
    reason: "python -c writing to system config",
  },
  // Python: network server creation
  {
    pattern: /\bpython[23]?\s+(-c|--command)\s+.*\b(socket\.socket|http\.server|socketserver)\b/,
    reason: "python -c with network server/socket",
  },
  // Python: __import__('os').system() / exec()/eval() with dangerous ops
  {
    pattern: /\bpython[23]?\s+(-c|--command)\s+.*__import__\s*\(\s*['"]os['"]\s*\)/,
    reason: "python -c with __import__('os') (stealth import)",
  },
  {
    pattern:
      /\bpython[23]?\s+(-c|--command)\s+.*\b(exec|eval)\s*\(.*\b(os\.|subprocess|shutil|socket)\b/,
    reason: "python -c with exec/eval containing dangerous module",
  },

  // Perl: system(), exec(), unlink on system paths
  {
    pattern: /\bperl\s+(-e|--eval)\s+.*\b(system\s*\(|exec\s*\(|unlink\s+['"]\/(?!tmp\/))/,
    reason: "perl -e with dangerous system call",
  },
  // Perl: IO::Socket
  {
    pattern: /\bperl\s+(-e|--eval)\s+.*\bIO::Socket\b/,
    reason: "perl -e with network socket (IO::Socket)",
  },

  // Ruby: system(), exec(), File.delete on system paths
  {
    pattern: /\bruby\s+(-e|--eval)\s+.*\b(system\s*\(|exec\s*\(|File\.delete|FileUtils\.rm_rf)/,
    reason: "ruby -e with dangerous system call",
  },
  // Ruby: TCPServer / Socket
  {
    pattern: /\bruby\s+(-e|--eval)\s+.*\b(TCPServer|TCPSocket|Socket\.new|UDPSocket|UNIXServer)\b/,
    reason: "ruby -e with network socket/server",
  },

  // ── Reverse shell patterns ──
  {
    pattern: /bash\s+-i\s+>&?\s*\/dev\/tcp\//,
    reason: "bash reverse shell via /dev/tcp",
  },
  {
    pattern: /\bnc\s+.*-e\s+/,
    reason: "netcat reverse shell (nc -e)",
  },
  {
    pattern: /\bncat\s+.*--(?:exec|sh-exec)\b/,
    reason: "ncat reverse shell (--exec/--sh-exec)",
  },
  {
    pattern: /\bsocat\b.*\bexec\b/i,
    reason: "socat exec (reverse shell / command relay)",
  },

  // ── Process injection / debugging ──
  {
    pattern: /\bgdb\s+.*-p\s+\d+/,
    reason: "gdb process attach (process injection)",
  },
  {
    pattern: /\bstrace\s+.*-p\s+\d+/,
    reason: "strace process attach (process inspection)",
  },
  {
    pattern: /\bptrace\b/,
    reason: "ptrace (process injection/tracing)",
  },

  // ── Kernel module manipulation ──
  {
    pattern: /\b(?:insmod|modprobe|rmmod)\s+/,
    reason: "kernel module manipulation",
  },

  // ── Download and execute pattern (handled in CHAIN_ATTACKS above) ──

  // xargs with dangerous commands
  { pattern: /xargs\s+.*\brm\b/, reason: "xargs rm (indirect deletion)" },
  { pattern: /xargs\s+.*\bchmod\b/, reason: "xargs chmod (indirect permission change)" },
  // find -exec with dangerous commands
  { pattern: /find\s+.*-exec\s+.*\brm\b/, reason: "find -exec rm (indirect deletion)" },
  { pattern: /find\s+.*-delete\b/, reason: "find -delete (bulk deletion)" },
];

const CRITICAL_PATH: Rule[] = [
  { pattern: /^\/etc\/(?:passwd|shadow|sudoers)$/, reason: "write to system auth file" },
  { pattern: /^\/boot\//, reason: "write to boot partition" },
];

// ── WARNING: risky but possibly intentional ────────────────────────
// Needs 1/1 LLM vote confirming user intent to pass

const WARNING_EXEC: Rule[] = [
  // Recursive delete (non-system paths — CRITICAL already catches system paths)
  { pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*)\s+/, reason: "recursive file deletion" },
  // Privilege escalation
  { pattern: /\bsudo\s+/, reason: "privilege escalation (sudo)" },
  // Dangerous permissions on system files
  {
    pattern: /chmod\s+[47]77\s+\/(?:etc|bin|sbin|usr|var|boot|lib)\b/,
    reason: "world-writable permission on system path",
  },
  { pattern: /chmod\s+[47]77\b/, reason: "world-writable permission (chmod 777)" },
  { pattern: /chmod\s+-R\s+/, reason: "recursive permission change" },
  {
    pattern: /chown\s+.*\/(?:etc|bin|sbin|usr|var|boot|lib)\b/,
    reason: "chown on system path",
  },
  { pattern: /chown\s+-R\s+/, reason: "recursive ownership change" },
  // setuid/setgid
  { pattern: /chmod\s+[ug]\+s\b/, reason: "setuid/setgid bit (privilege escalation)" },
  { pattern: /chmod\s+[2-7][0-7]{3}\b/, reason: "special permission bits (setuid/setgid/sticky)" },
  // Force kill
  { pattern: /kill\s+-9\s+/, reason: "force kill process (SIGKILL)" },
  { pattern: /\bkillall\s+/, reason: "killall processes" },
  { pattern: /\bpkill\s+/, reason: "pkill processes" },
  // Service management
  { pattern: /systemctl\s+(?:stop|disable|restart)\s+/, reason: "systemctl service operation" },
  // Database destruction
  { pattern: /DROP\s+(?:DATABASE|TABLE)\b/i, reason: "DROP DATABASE/TABLE" },
  { pattern: /TRUNCATE\s+/i, reason: "TRUNCATE table" },
  // Network/firewall changes
  { pattern: /\biptables\s+/, reason: "firewall rule change (iptables)" },
  { pattern: /\bufw\s+(?:allow|deny|delete|disable)\b/, reason: "firewall rule change (ufw)" },
  // Crontab modification
  { pattern: /\bcrontab\s+(-r|-e|-)\s*$/, reason: "crontab modification" },
  { pattern: /\bcrontab\s+-/, reason: "crontab modification" },
  // Disk operations
  { pattern: /\bfdisk\s+/, reason: "disk partition operation" },
  { pattern: /\bparted\s+/, reason: "disk partition operation" },
  { pattern: /\bmount\s+/, reason: "filesystem mount operation" },
  { pattern: /\bumount\s+/, reason: "filesystem unmount operation" },
  // SSH key operations
  { pattern: /ssh-keygen\s+/, reason: "SSH key generation/modification" },
  // Environment variable manipulation that could affect security
  {
    pattern: /export\s+(?:PATH|LD_PRELOAD|LD_LIBRARY_PATH)=/,
    reason: "security-sensitive environment variable change",
  },
];

const WARNING_PATH: Rule[] = [
  { pattern: /^\/etc\//, reason: "write to /etc/ system config" },
  { pattern: /^\/root\//, reason: "write to /root/ directory" },
];

// ── Safe Command Patterns (whitelist, checked before blacklist) ─────

const SAFE_EXEC: RegExp[] = [
  // git rm --cached only removes from index, not filesystem
  /^git\s+rm\s+.*--cached/,
  // git operations are generally safe
  /^git\s+(?:add|commit|push|pull|fetch|log|status|diff|branch|checkout|merge|rebase|stash|tag|remote|clone)\b/,
  // echo/printf — ONLY safe if not piped to shell (pipe splits into separate segments)
  /^(?:echo|printf)\s+/,
  // read-only commands — exclude find (can be used with -exec/-delete)
  /^(?:cat|head|tail|less|more|grep|ls|stat|file|wc|du|df|which|whereis|type|id|whoami|hostname|uname|date|uptime)\s*/,
  // package info (not install)
  /^(?:apt|dpkg|pip|npm)\s+(?:list|show|info|search)\b/,
  // node -p is print-only (safe)
  /^node\s+-p\s+/,
];

// ── Quote/Comment Detection ────────────────────────────────────────

function isQuotedOrCommented(text: string, matchIndex: number): boolean {
  const before = text.slice(0, matchIndex);

  // Inside double quotes?
  const doubleQuotes = (before.match(/"/g) || []).length;
  if (doubleQuotes % 2 === 1) return true;

  // Inside single quotes?
  const singleQuotes = (before.match(/'/g) || []).length;
  if (singleQuotes % 2 === 1) return true;

  // After a comment character on the same line?
  const lastNewline = before.lastIndexOf("\n");
  const currentLine = before.slice(lastNewline + 1);
  if (currentLine.includes("#")) return true;

  return false;
}

// ── Matching ───────────────────────────────────────────────────────

function matchRules(
  text: string,
  rules: Rule[],
  level: "critical" | "warning",
): BlacklistMatch | null {
  for (const rule of rules) {
    const m = rule.pattern.exec(text);
    if (m && !isQuotedOrCommented(text, m.index)) {
      return { level, pattern: rule.pattern.source, reason: rule.reason };
    }
  }
  return null;
}

// ── Command Segmentation ───────────────────────────────────────────

function splitCommand(cmd: string): string[] {
  // Split on shell operators, but not inside quotes
  const segments: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (!inSingle && !inDouble) {
      // Check double-char operators first: && and ||
      if ((ch === "&" && cmd[i + 1] === "&") || (ch === "|" && cmd[i + 1] === "|")) {
        segments.push(current.trim());
        current = "";
        i++; // skip second char
        continue;
      }
      // Single-char separators: ; | \n
      if (ch === ";" || ch === "|" || ch === "\n") {
        segments.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) segments.push(current.trim());
  return segments.filter(Boolean);
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Check a command (exec) against blacklist.
 * Splits on shell operators and checks each segment.
 * Returns null if no match (99% of calls).
 */
export function checkExecBlacklist(command: string): BlacklistMatch | null {
  if (!command) return null;

  // Phase 1: Check the FULL command string for pipe-based attacks
  // These patterns span across pipe boundaries and must be checked before splitting
  const PIPE_ATTACKS: Rule[] = [
    {
      pattern: /base64\s+(-d|--decode).*\|\s*(?:bash|sh|zsh|dash)/,
      reason: "base64 decoded pipe to shell",
    },
    {
      pattern: /\bcurl\b.*\|\s*(?:bash|sh|zsh|dash|python|perl|ruby)/,
      reason: "curl pipe to shell (remote code execution)",
    },
    {
      pattern: /\bwget\b.*\|\s*(?:bash|sh|zsh|dash|python|perl|ruby)/,
      reason: "wget pipe to shell (remote code execution)",
    },
    { pattern: /\becho\b.*\|\s*(?:bash|sh|zsh|dash)\b/, reason: "echo pipe to shell" },
    { pattern: /\bprintf\b.*\|\s*(?:bash|sh|zsh|dash)\b/, reason: "printf pipe to shell" },
    { pattern: /\|\s*(?:bash|sh|zsh|dash)\s*$/, reason: "pipe to shell interpreter" },
    { pattern: /\|\s*(?:bash|sh|zsh|dash)\s*[;&|]/, reason: "pipe to shell interpreter" },
    // Encoding bypass: base64 decode piped to shell
    {
      pattern: /\bbase64\b.*\|\s*(?:bash|sh|zsh|dash)/,
      reason: "base64 pipe to shell (encoding bypass)",
    },
    // crontab stdin injection: echo ... | crontab -
    {
      pattern: /\|.*\bcrontab\s+-\s*$/,
      reason: "pipe to crontab stdin (crontab injection)",
    },
    {
      pattern: /\becho\b.*\|\s*crontab\b/,
      reason: "echo pipe to crontab (crontab injection)",
    },
  ];
  // Download + execute chain (must check full command before split)
  const CHAIN_ATTACKS: Rule[] = [
    {
      pattern: /\b(?:curl|wget)\b.*&&.*chmod\s+\+x\b/,
      reason: "download + chmod +x chain (download and execute)",
    },
    {
      pattern: /\b(?:curl|wget)\b.*&&.*\bsh\b/,
      reason: "download + shell execute chain",
    },
    {
      pattern: /\b(?:curl|wget)\b.*&&.*\bbash\b/,
      reason: "download + bash execute chain",
    },
  ];
  const fullMatch =
    matchRules(command, PIPE_ATTACKS, "critical") ?? matchRules(command, CHAIN_ATTACKS, "critical");
  if (fullMatch) return fullMatch;

  // Phase 2: Split on shell operators and check each segment
  const segments = splitCommand(command);
  for (const seg of segments) {
    // Whitelist check: safe commands skip blacklist entirely
    if (SAFE_EXEC.some((re) => re.test(seg))) continue;

    const m =
      matchRules(seg, CRITICAL_EXEC, "critical") ?? matchRules(seg, WARNING_EXEC, "warning");
    if (m) return m;
  }
  return null;
}

/**
 * Check a file path (write/edit) against blacklist.
 * Returns null if no match.
 */
export function checkPathBlacklist(filePath: string): BlacklistMatch | null {
  if (!filePath) return null;
  return (
    matchRules(filePath, CRITICAL_PATH, "critical") ?? matchRules(filePath, WARNING_PATH, "warning")
  );
}
