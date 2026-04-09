export type BlacklistMatch = {
  level: "critical" | "warning";
  pattern: string;
  reason: string;
};

export interface CheckExecBlacklistContext {
  masqueradeTaintLevel?: "soft" | "hard";
}

interface Rule {
  pattern: RegExp;
  reason: string;
}

const PROTECTED_UNIX_TARGET = String.raw`\/(?:etc\/(?:passwd|shadow|sudoers)|boot(?:\/[^\n\r'"]*)?|bin(?:\/[^\n\r'"]*)?|sbin(?:\/[^\n\r'"]*)?|usr(?:\/[^\n\r'"]*)?|var(?:\/[^\n\r'"]*)?)`;
const PROTECTED_WINDOWS_TARGET =
  String.raw`[A-Za-z]:\\+(?:Windows|Program Files(?:\s\(x86\))?|ProgramData|Boot)(?:\\+[^\n\r'"]*)?`;
const PROTECTED_AUTH_TARGET =
  String.raw`(?:\/etc\/(?:passwd|shadow|sudoers)|[A-Za-z]:\\+Windows\\+System32\\+config\\+(?:SAM|SECURITY|SYSTEM))`;
const INLINE_PROTECTED_TARGET = String.raw`(?:${PROTECTED_UNIX_TARGET}|${PROTECTED_WINDOWS_TARGET})`;
const INLINE_QUOTE = String.raw`(?:['"]|\\['"])`;

const INLINE_NODE_FILE_OP =
  String.raw`(?:\b(?:unlinkSync|writeFileSync|appendFileSync|rmSync|rmdirSync)\s*\(\s*${INLINE_QUOTE}${INLINE_PROTECTED_TARGET}${INLINE_QUOTE}|\brenameSync\s*\(\s*[^,\n\r]+,\s*${INLINE_QUOTE}${INLINE_PROTECTED_TARGET}${INLINE_QUOTE})`;
const INLINE_PYTHON_FILE_OP =
  String.raw`(?:\b(?:os\.(?:remove|unlink)|shutil\.rmtree)\s*\(\s*${INLINE_QUOTE}${INLINE_PROTECTED_TARGET}${INLINE_QUOTE}|\b(?:os\.rename|shutil\.move)\s*\(\s*[^,\n\r]+,\s*${INLINE_QUOTE}${INLINE_PROTECTED_TARGET}${INLINE_QUOTE}|\bopen\s*\(\s*${INLINE_QUOTE}${INLINE_PROTECTED_TARGET}${INLINE_QUOTE}\s*,\s*${INLINE_QUOTE}[^'"]*[wa+][^'"]*${INLINE_QUOTE}|\bpathlib\.Path\s*\(\s*${INLINE_QUOTE}${INLINE_PROTECTED_TARGET}${INLINE_QUOTE}\s*\)\s*\.\s*(?:write_text|write_bytes)\b)`;
const INLINE_PERL_FILE_OP =
  String.raw`(?:\bunlink\s*(?:\(\s*)?${INLINE_QUOTE}${INLINE_PROTECTED_TARGET}${INLINE_QUOTE}|\bopen\b[^\n\r]*${INLINE_QUOTE}(?:>|>>|\+>|[wa]\+?)${INLINE_QUOTE}[^\n\r]*${INLINE_QUOTE}${INLINE_PROTECTED_TARGET}${INLINE_QUOTE}|\bsysopen\b[^\n\r]*${INLINE_QUOTE}${INLINE_PROTECTED_TARGET}${INLINE_QUOTE}[^\n\r]*\b(?:O_WRONLY|O_RDWR|O_APPEND|O_TRUNC|O_CREAT)\b|\brename\s*(?:\(\s*)?[^,\n\r]+,\s*${INLINE_QUOTE}${INLINE_PROTECTED_TARGET}${INLINE_QUOTE}|\bremove_tree\s*(?:\(\s*)?${INLINE_QUOTE}${INLINE_PROTECTED_TARGET}${INLINE_QUOTE})`;
const INLINE_RUBY_FILE_OP =
  String.raw`(?:\b(?:File\.(?:delete|unlink|write)|FileUtils\.rm_rf)\s*\(\s*${INLINE_QUOTE}${INLINE_PROTECTED_TARGET}${INLINE_QUOTE}|\b(?:File\.rename|FileUtils\.mv)\s*\(\s*[^,\n\r]+,\s*${INLINE_QUOTE}${INLINE_PROTECTED_TARGET}${INLINE_QUOTE}|\bFile\.open\s*\(\s*${INLINE_QUOTE}${INLINE_PROTECTED_TARGET}${INLINE_QUOTE}\s*,\s*${INLINE_QUOTE}[^'"]*[wa+][^'"]*${INLINE_QUOTE})`;
const INLINE_INTERPRETER_FILE_OP =
  String.raw`(?:${INLINE_NODE_FILE_OP}|${INLINE_PYTHON_FILE_OP}|${INLINE_PERL_FILE_OP}|${INLINE_RUBY_FILE_OP})`;

const WRAPPED_SHELL_HANDOFF = String.raw`(?:sh\s+-c|bash\s+-c|bash\s+-lc|cmd(?:\.exe)?\s+\/[cr]|powershell(?:\.exe)?(?:\s+-\S+)*\s+-Command|pwsh(?:\.exe)?(?:\s+-\S+)*\s+-Command)`;

const WRAPPED_DANGEROUS_PAYLOAD = String.raw`(?:rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+\/|curl\b[^\n\r]*\|\s*(?:bash|sh)\b|wget\b[^\n\r]*\|\s*(?:bash|sh)\b|(?:iwr|Invoke-WebRequest)\b[^\n\r]*\|\s*(?:iex|Invoke-Expression)\b|(?:>>?|(?:echo|tee)\b[^\n\r]*>>?)\s*(?:${PROTECTED_AUTH_TARGET})|(?:nc\b[^\n\r]*\s-e\s+|ncat\b[^\n\r]*--(?:exec|sh-exec)\b|socat\b[^\n\r]*\bexec\b|\/dev\/tcp\/|New-Object\s+[^\n\r]*TCPClient)|--privileged\b|(?:-v|--volume)\s*\/:\s*\/host\b|nsenter\b|chroot\s+\/host\b|Remove-Item\b[^\n\r]*(?:-Recurse|-r)\b[^\n\r]*${PROTECTED_WINDOWS_TARGET}|del\s+\/[fFsS][^\n\r]*${PROTECTED_WINDOWS_TARGET}|Start-Process\b[^\n\r]*-Verb\s+RunAs\b|\b(?:shutdown(?:\.exe)?|reboot|poweroff|halt|Restart-Computer|Stop-Computer)\b|\binit\s+[06]\b|\bsystemctl\s+(?:reboot|poweroff)\b|\bsystemctl\s+(?:start|stop|restart|enable|disable)\s+sshd\b|\bservice\s+ssh\s+(?:start|stop|restart)\b|\b(?:Start-Service|Stop-Service|Restart-Service|Set-Service)\s+sshd\b|\bsc(?:\.exe)?\s+(?:start|stop|config)\s+sshd\b|(?:>>?|tee|sed\s+-i|Set-Content|Add-Content|Out-File)[^\n\r]*\/etc\/ssh\/sshd_config\b|${INLINE_INTERPRETER_FILE_OP})`;
const MASQUERADE_SOURCE_EXEC = String.raw`(?:\/(?:usr\/)?bin\/)?(?:cat|less|more|head|tail|sh|bash|zsh|dash|python(?:3)?|node|perl|ruby|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?|curl|wget|nc|ncat|socat)\b`;
const KNOWN_EXECUTABLE_PREFIX =
  /^(?:git|cat|head|tail|less|more|grep|ls|stat|file|wc|du|df|which|whereis|type|id|whoami|hostname|uname|date|uptime|Get-ChildItem|gci|Get-Location|pwd|Get-Item|gi|dir|apt|dpkg|pip|npm|node|python[23]?|perl|ruby|powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd(?:\.exe)?|docker|podman|kubectl|ssh|osascript|mshta|curl|wget|nc|ncat|socat)\b/i;

const CRITICAL_EXEC: Rule[] = [
  {
    pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+|--recursive\s+)\/(?!tmp\/|home\/clawdbot\/)/,
    reason: "rm -rf on root-level system path",
  },
  {
    pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+|--recursive\s+)~\//,
    reason: "rm -rf on home directory",
  },
  {
    pattern: /\b(?:Remove-Item|ri)\b(?=.*(?:^|\s)-(?:Recurse|r)\b).*[A-Za-z]:\\(?:Windows(?:\\|$)|Program Files(?:\s\(x86\))?(?:\\|$)|ProgramData(?:\\|$)|Boot(?:\\|$))/i,
    reason: "rm -rf on root-level system path",
  },
  {
    pattern: /\b(?:rmdir|rd)\b\s+\/[sS]\b.*[A-Za-z]:\\(?:Windows(?:\\|$)|Program Files(?:\s\(x86\))?(?:\\|$)|ProgramData(?:\\|$)|Boot(?:\\|$))/i,
    reason: "rm -rf on root-level system path",
  },
  {
    pattern: /\b(?:Remove-Item|ri)\b(?=.*(?:^|\s)-(?:Recurse|r)\b).*[A-Za-z]:\\Users\\[^\\]+/i,
    reason: "rm -rf on home directory",
  },
  {
    pattern: /\b(?:rmdir|rd)\b\s+\/[sS]\b.*[A-Za-z]:\\Users\\[^\\]+/i,
    reason: "rm -rf on home directory",
  },
  { pattern: /mkfs\b/, reason: "filesystem format (mkfs)" },
  { pattern: /\bformat(?:\.com)?\b\s+[A-Za-z]:/i, reason: "filesystem format (mkfs)" },
  { pattern: /dd\s+if=.*of=\/dev\//, reason: "raw disk write (dd)" },
  { pattern: /\bdiskpart\b.*\bclean\b/i, reason: "raw disk write (dd)" },
  { pattern: />\s*\/dev\/sd/, reason: "redirect to block device" },
  { pattern: />\s*\\\\\.\\PhysicalDrive\d+/i, reason: "redirect to block device" },
  {
    pattern: /(?:tee|>>?)\s*\/etc\/(?:passwd|shadow|sudoers)/,
    reason: "write to system auth file",
  },
  {
    pattern: /sed\s+-i.*\/etc\/(?:passwd|shadow|sudoers)/,
    reason: "in-place edit of system auth file",
  },
  {
    pattern: /(?:>>?|Set-Content|Add-Content|Out-File)\s+[A-Za-z]:\\Windows\\System32\\config\\(?:SAM|SECURITY|SYSTEM)\b/i,
    reason: "write to system auth file",
  },
  { pattern: /\b(?:shutdown(?:\.exe)?|reboot|poweroff|halt)\b/i, reason: "system availability shutdown/reboot" },
  { pattern: /\b(?:Restart-Computer|Stop-Computer)\b/i, reason: "system availability shutdown/reboot" },
  { pattern: /\binit\s+[06]\b/i, reason: "system availability shutdown/reboot" },
  { pattern: /\bsystemctl\s+(?:reboot|poweroff)\b/i, reason: "system availability shutdown/reboot" },
  { pattern: /\bsystemctl\s+(?:start|stop|restart|enable|disable)\s+sshd\b/i, reason: "ssh remote login control" },
  { pattern: /\bservice\s+ssh\s+(?:start|stop|restart)\b/i, reason: "ssh remote login control" },
  { pattern: /\b(?:Start-Service|Stop-Service|Restart-Service|Set-Service)\s+sshd\b/i, reason: "ssh remote login control" },
  { pattern: /\bsc(?:\.exe)?\s+(?:start|stop|config)\s+sshd\b/i, reason: "ssh remote login control" },
  { pattern: /(?:>>?|tee|sed\s+-i|Set-Content|Add-Content|Out-File)[^\n\r]*\/etc\/ssh\/sshd_config\b/i, reason: "ssh remote login control" },
  { pattern: /\b(?:unlink|remove_tree|write(?:FileSync)?|append(?:FileSync)?|rename(?:Sync)?|File\.(?:delete|unlink|write|rename)|FileUtils\.(?:rm_rf|mv)|os\.(?:remove|unlink|rename)|shutil\.(?:move|rmtree)|pathlib\.Path\s*\([^)]*\)\s*\.\s*write_(?:text|bytes)|open\s*\()[^\n\r]*\/etc\/ssh\/sshd_config\b/i, reason: "ssh remote login control" },
  { pattern: /\/bin\/rm\s+(-[a-zA-Z]*r[a-zA-Z]*)\s+/, reason: "rm via absolute path" },
  { pattern: /\/usr\/bin\/rm\s+(-[a-zA-Z]*r[a-zA-Z]*)\s+/, reason: "rm via absolute path" },
  { pattern: /\beval\s+.*\b(base64|curl|wget|nc\b|bash\s+-i|\/dev\/tcp)/, reason: "eval with suspicious payload" },
  {
    pattern:
      /\bnode\s+(-e|--eval)\s+.*\b(child_process|\.exec\s*\(|\.spawn\s*\(|\.execSync\s*\(|\.spawnSync\s*\()/,
    reason: "node -e with subprocess execution",
  },
  {
    pattern: new RegExp(String.raw`\bnode\s+(-e|--eval)\s+.*${INLINE_NODE_FILE_OP}`, "i"),
    reason: "node -e with dangerous fs op on protected system target",
  },
  {
    pattern:
      /\bnode\s+(-e|--eval)\s+.*\b(unlinkSync|rmdirSync|rmSync|writeFileSync)\s*\(\s*['"]\/(?!tmp\/)/,
    reason: "node -e with dangerous fs op on system path",
  },
  {
    pattern:
      /\bnode\s+(-e|--eval)\s+.*\b(unlinkSync|rmdirSync|rmSync|writeFileSync)\s*\(\s*['"][A-Za-z]:\\\\(?:Windows(?:\\\\|['"])|Program Files(?:\s\(x86\))?(?:\\\\|['"])|ProgramData(?:\\\\|['"])|Users\\\\[^\\]+(?:\\\\|['"])|Boot(?:\\\\|['"]))/i,
    reason: "node -e with dangerous fs op on system path",
  },
  {
    pattern:
      /\bnode\s+(-e|--eval)\s+.*(net\.createServer|http\.createServer|https\.createServer|dgram\.createSocket|tls\.createServer|require\s*\(\s*['"](?:net|http|https|dgram|tls)['"]\s*\)\.create|\.createServer\s*\(|\.createSocket\s*\()/,
    reason: "node -e with network server creation",
  },
  {
    pattern: /\bnode\s+(-e|--eval)\s+.*\b(vm\.runInNewContext|vm\.runInThisContext)\b/,
    reason: "node -e with VM sandbox escape",
  },
  {
    pattern: /\bnode\s+(-e|--eval)\s+.*\beval\s*\(.*\brequire\b/,
    reason: "node -e with eval+require (code injection)",
  },
  {
    pattern:
      /\bpython[23]?\s+(-c|--command)\s+.*\b(os\.system|subprocess|shutil\.rmtree|os\.remove|os\.unlink)\b/,
    reason: "python -c with dangerous system call",
  },
  {
    pattern: new RegExp(String.raw`\bpython[23]?\s+(-c|--command)\s+.*${INLINE_PYTHON_FILE_OP}`, "i"),
    reason: "python -c with dangerous fs op on protected system target",
  },
  {
    pattern: /\bpython[23]?\s+(-c|--command)\s+.*\bopen\s*\(\s*['"]\/etc\//,
    reason: "python -c writing to system config",
  },
  {
    pattern: /\bpython[23]?\s+(-c|--command)\s+.*\bopen\s*\(\s*['"][A-Za-z]:\\\\Windows\\\\System32\\\\config\\\\(?:SAM|SECURITY|SYSTEM)/i,
    reason: "python -c writing to system config",
  },
  {
    pattern: /\bpython[23]?\s+(-c|--command)\s+.*\b(socket\.socket|http\.server|socketserver)\b/,
    reason: "python -c with network server/socket",
  },
  {
    pattern: /\bpython[23]?\s+(-c|--command)\s+.*__import__\s*\(\s*['"]os['"]\s*\)/,
    reason: "python -c with __import__('os') (stealth import)",
  },
  {
    pattern:
      /\bpython[23]?\s+(-c|--command)\s+.*\b(exec|eval)\s*\(.*\b(os\.|subprocess|shutil|socket)\b/,
    reason: "python -c with exec/eval containing dangerous module",
  },
  {
    pattern: new RegExp(String.raw`\bperl\b[^\n\r]*\s(-e|--eval)\s+.*(?:\b(system\s*\(|exec\s*\()|${INLINE_PERL_FILE_OP})`, "i"),
    reason: "perl -e with dangerous system call",
  },
  {
    pattern: /\bperl\s+(-e|--eval)\s+.*\bIO::Socket\b/,
    reason: "perl -e with network socket (IO::Socket)",
  },
  {
    pattern: new RegExp(String.raw`\bruby\s+(-e|--eval)\s+.*(?:\b(system\s*\(|exec\s*\()|${INLINE_RUBY_FILE_OP})`, "i"),
    reason: "ruby -e with dangerous system call",
  },
  {
    pattern: /\bruby\s+(-e|--eval)\s+.*\b(TCPServer|TCPSocket|Socket\.new|UDPSocket|UNIXServer)\b/,
    reason: "ruby -e with network socket/server",
  },
  {
    pattern: /bash\s+-i\s+>&?\s*\/dev\/tcp\//,
    reason: "bash reverse shell via /dev/tcp",
  },
  {
    pattern: /\bpowershell(?:\.exe)?\b.*\b(?:System\.Net\.Sockets\.TCPClient|Net\.Sockets\.TCPClient|New-Object\s+[^\n\r]*TCPClient|Invoke-PowerShellTcp)\b/i,
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
  {
    pattern: /\bgdb\s+.*-p\s+\d+/,
    reason: "gdb process attach (process injection)",
  },
  {
    pattern: /\b(?:windbg|cdb|ntsd|vsjitdebugger)\b.*-p\s+\d+/i,
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
  {
    pattern: /\b(?:insmod|modprobe|rmmod)\s+/,
    reason: "kernel module manipulation",
  },
  {
    pattern: /\b(?:sc(?:\.exe)?\s+create\b.*\btype=\s*kernel|drvload\b|fltmc\b|pnputil\b.*\/add-driver)\b/i,
    reason: "kernel module manipulation",
  },
  { pattern: /xargs\s+.*\brm\b/, reason: "xargs rm (indirect deletion)" },
  { pattern: /xargs\s+.*\bchmod\b/, reason: "xargs chmod (indirect permission change)" },
  { pattern: /find\s+.*-exec\s+.*\brm\b/, reason: "find -exec rm (indirect deletion)" },
  { pattern: /find\s+.*-delete\b/, reason: "find -delete (bulk deletion)" },
  { pattern: /\bGet-ChildItem\b.*\|\s*(?:Remove-Item|ri)\b/i, reason: "find -delete (bulk deletion)" },
  {
    pattern: /(?:cat|less|more|head|tail|type)\s+.*\/etc\/(?:passwd|shadow|sudoers)\b/,
    reason: "read system auth file (cat/less/...)",
  },
  {
    pattern: /\/etc\/shadow\b/,
    reason: "access to /etc/shadow (password hashes)",
  },
  {
    pattern: /(?:type|Get-Content|gc)\s+.*[A-Za-z]:\\Windows\\System32\\config\\(?:SAM|SECURITY|SYSTEM)\b/i,
    reason: "read system auth file (cat/less/...)",
  },
  {
    pattern: /[A-Za-z]:\\Windows\\System32\\config\\SAM\b/i,
    reason: "access to /etc/shadow (password hashes)",
  },
];

const CRITICAL_PATH: Rule[] = [
  { pattern: /^\/etc\/(?:passwd|shadow|sudoers)$/, reason: "write to system auth file" },
  { pattern: /^\/boot\//, reason: "write to boot partition" },
  { pattern: /^[A-Za-z]:\\Windows\\System32\\config\\(?:SAM|SECURITY|SYSTEM)$/i, reason: "write to system auth file" },
  { pattern: /^[A-Za-z]:\\(?:Boot\\|Windows\\Boot\\)/i, reason: "write to boot partition" },
];

const WARNING_EXEC: Rule[] = [
  { pattern: /\beval\s+/, reason: "eval execution (review recommended)" },
  { pattern: /\btrash\s+/, reason: "file deletion (trash)" },
  { pattern: /\brm\s+/, reason: "file deletion (rm)" },
  { pattern: /\brmdir\s+/, reason: "directory removal (rmdir)" },
  { pattern: /(?:rm\s+.*&&\s*){2,}/, reason: "multiple chained deletions" },
  { pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*)\s+/, reason: "recursive file deletion" },
  { pattern: /\bRemove-Item\b/i, reason: "file/directory deletion (Remove-Item)" },
  { pattern: /\bri\s+/i, reason: "file/directory deletion (ri alias)" },
  { pattern: /\brmdir\s+\/[sS]\b/, reason: "recursive directory removal (rmdir /s)" },
  { pattern: /\brd\s+\/[sS]\b/, reason: "recursive directory removal (rd /s)" },
  { pattern: /\bdel\s+\/[fFsS]/, reason: "forced/recursive file deletion (del /f or /s)" },
  { pattern: /\berase\s+\/[fFsS]/, reason: "forced file deletion (erase /f)" },
  { pattern: /\bDeleteDirectory\b/i, reason: "directory deletion (.NET/VB DeleteDirectory)" },
  { pattern: /\bSendToRecycleBin\b/i, reason: "send to recycle bin (DeleteDirectory)" },
  { pattern: /\[Microsoft\.VisualBasic\.FileIO\.FileSystem\]/i, reason: "VB FileSystem API (potentially destructive)" },
  { pattern: /\[System\.IO\.Directory\]::Delete\b/i, reason: "directory deletion (System.IO.Directory.Delete)" },
  { pattern: /\bDirectory\.Delete\s*\(/i, reason: "directory deletion (Directory.Delete)" },
  { pattern: /\bDirectoryInfo\b.*\bDelete\s*\(/i, reason: "directory deletion (DirectoryInfo.Delete)" },
  { pattern: /\bFileInfo\b.*\bDelete\s*\(/i, reason: "file deletion (FileInfo.Delete)" },
  { pattern: /\bFile\.Delete\s*\(/i, reason: "file deletion (File.Delete)" },
  { pattern: /\bsudo\s+/, reason: "privilege escalation (sudo)" },
  { pattern: /\brunas\b/i, reason: "privilege escalation (sudo)" },
  { pattern: /\bStart-Process\b.*(?:^|\s)-Verb\s+RunAs\b/i, reason: "privilege escalation (sudo)" },
  {
    pattern: /chmod\s+[47]77\s+\/(?:etc|bin|sbin|usr|var|boot|lib)\b/,
    reason: "world-writable permission on system path",
  },
  {
    pattern: /\bicacls\b.*[A-Za-z]:\\(?:Windows|Program Files(?:\s\(x86\))?|ProgramData|Boot)\\.*\/grant\b.*\bEveryone:\(F\)/i,
    reason: "world-writable permission on system path",
  },
  { pattern: /chmod\s+[47]77\b/, reason: "world-writable permission (chmod 777)" },
  { pattern: /\bicacls\b.*\/grant\b.*\bEveryone:\(F\)/i, reason: "world-writable permission (chmod 777)" },
  { pattern: /chmod\s+-R\s+/, reason: "recursive permission change" },
  { pattern: /\bicacls\b.*(?:^|\s)\/T(?:\s|$)/i, reason: "recursive permission change" },
  {
    pattern: /chown\s+.*\/(?:etc|bin|sbin|usr|var|boot|lib)\b/,
    reason: "chown on system path",
  },
  {
    pattern: /\b(?:takeown\b.*[A-Za-z]:\\(?:Windows|Program Files(?:\s\(x86\))?|ProgramData|Boot)\\|icacls\b.*[A-Za-z]:\\(?:Windows|Program Files(?:\s\(x86\))?|ProgramData|Boot)\\.*\/setowner\b)/i,
    reason: "chown on system path",
  },
  { pattern: /chown\s+-R\s+/, reason: "recursive ownership change" },
  { pattern: /\btakeown\b.*(?:^|\s)\/R(?:\s|$)/i, reason: "recursive ownership change" },
  { pattern: /chmod\s+[ug]\+s\b/, reason: "setuid/setgid bit (privilege escalation)" },
  { pattern: /chmod\s+[1-7][0-7]{3}\b/, reason: "special permission bits (setuid/setgid/sticky)" },
  { pattern: /kill\s+-9\s+/, reason: "force kill process (SIGKILL)" },
  { pattern: /\btaskkill\b.*(?:^|\s)\/F(?:\s|$)/i, reason: "force kill process (SIGKILL)" },
  { pattern: /\bStop-Process\b.*\b-Force\b/i, reason: "force kill process (SIGKILL)" },
  { pattern: /\bkillall\s+/, reason: "killall processes" },
  { pattern: /\bpkill\s+/, reason: "pkill processes" },
  { pattern: /systemctl\s+(?:stop|disable|restart)\s+/, reason: "systemctl service operation" },
  { pattern: /\b(?:sc(?:\.exe)?\s+(?:stop|config|start)|Stop-Service|Restart-Service|Set-Service)\b/i, reason: "systemctl service operation" },
  { pattern: /DROP\s+(?:DATABASE|TABLE)\b/i, reason: "DROP DATABASE/TABLE" },
  { pattern: /TRUNCATE\s+/i, reason: "TRUNCATE table" },
  { pattern: /\biptables\s+/, reason: "firewall rule change (iptables)" },
  { pattern: /\bufw\s+(?:allow|deny|delete|disable)\b/, reason: "firewall rule change (ufw)" },
  { pattern: /\b(?:netsh\s+advfirewall|New-NetFirewallRule|Set-NetFirewallProfile|Remove-NetFirewallRule)\b/i, reason: "firewall rule change (iptables)" },
  { pattern: /\bcrontab\s+(-r|-e|-)\s*$/, reason: "crontab modification" },
  { pattern: /\bcrontab\s+-/, reason: "crontab modification" },
  { pattern: /\b(?:schtasks\b.*\/(?:Create|Change|Delete)\b|Register-ScheduledTask\b|Set-ScheduledTask\b|Unregister-ScheduledTask\b)/i, reason: "crontab modification" },
  { pattern: /\bfdisk\s+/, reason: "disk partition operation" },
  { pattern: /\bparted\s+/, reason: "disk partition operation" },
  { pattern: /\bdiskpart\b/i, reason: "disk partition operation" },
  { pattern: /\bmount\s+/, reason: "filesystem mount operation" },
  { pattern: /\bumount\s+/, reason: "filesystem unmount operation" },
  { pattern: /\b(?:mountvol|Mount-DiskImage)\b/i, reason: "filesystem mount operation" },
  { pattern: /\bDismount-DiskImage\b/i, reason: "filesystem unmount operation" },
  { pattern: /ssh-keygen\s+/, reason: "SSH key generation/modification" },
  {
    pattern: /export\s+(?:PATH|LD_PRELOAD|LD_LIBRARY_PATH)=/,
    reason: "security-sensitive environment variable change",
  },
  {
    pattern: /\b(?:set|setx)\s+(?:PATH|PATHEXT)=/i,
    reason: "security-sensitive environment variable change",
  },
  {
    pattern: /\$env:(?:PATH|PSModulePath)\s*=/i,
    reason: "security-sensitive environment variable change",
  },
];

const WARNING_PATH: Rule[] = [
  { pattern: /^\/etc\//, reason: "write to /etc/ system config" },
  { pattern: /^\/root\//, reason: "write to /root/ directory" },
  { pattern: /^[A-Za-z]:\\Windows\\System32\\drivers\\etc\\/i, reason: "write to /etc/ system config" },
  { pattern: /^[A-Za-z]:\\Users\\[^\\]+\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\/i, reason: "write to /root/ directory" },
];

const SAFE_EXEC: RegExp[] = [
  /^git\s+rm\s+.*--cached/,
  /^git\s+(?:add|commit|push|pull|fetch|log|status|diff|branch|checkout|merge|rebase|stash|tag|remote|clone)\b/,
  /^(?:cat|head|tail|less|more|grep|ls|stat|file|wc|du|df|which|whereis|type|id|whoami|hostname|uname|date|uptime)\s*/,
  /^(?:Get-ChildItem|gci|Get-Location|pwd|Get-Item|gi|dir)\b/i,
  /^(?:apt|dpkg|pip|npm)\s+(?:list|show|info|search)\b/,
  /^node\s+-p\s+/,
  /^eval\s+["']?\$\((?:ssh-agent|brew\s+shellenv|direnv)/,
  /^(?:npm|npx|yarn|pnpm)\s+(?:run|test|start|build|dev|lint|format)\b/,
];

const EXECUTABLE_MASQUERADE_SETUP: Rule[] = [
  {
    pattern: new RegExp(String.raw`\b(?:cp|copy|mv|move)\b[^\n\r]*${MASQUERADE_SOURCE_EXEC}`, "i"),
    reason: "executable masquerade setup via copy/rename",
  },
  {
    pattern: new RegExp(String.raw`\bln\s+-s\b[^\n\r]*${MASQUERADE_SOURCE_EXEC}`, "i"),
    reason: "executable masquerade setup via copy/rename",
  },
  {
    pattern: /(?:^|\s)alias\s+\w+=["'][^"']*(?:cat|less|more|head|tail|sh|bash|zsh|dash|python(?:3)?|node|perl|ruby|powershell|pwsh)\b/i,
    reason: "executable masquerade setup via alias remap",
  },
  {
    pattern: /(?:^|\s)(?:function\s+\w+\s*\{|\w+\s*\(\)\s*\{)[^\n\r]*(?:cat|less|more|head|tail|sh|bash|zsh|dash|python(?:3)?|node|perl|ruby|powershell|pwsh)\b/i,
    reason: "executable masquerade setup via function remap",
  },
  {
    pattern: /(?:^|\s)Set-Alias\s+\w+\s+\S+/i,
    reason: "executable masquerade setup via function remap",
  },
];

const EXECUTABLE_MASQUERADE_HINT: Rule[] = [
  {
    pattern: /(?:^|\s)(?:export\s+PATH=|set\s+PATH=|\$env:PATH\s*=)/i,
    reason: "command resolution shadowing via PATH precedence change",
  },
  {
    pattern: /(?:^|\s)(?:set\s+PATHEXT=|\$env:(?:PATHEXT|PSModulePath)\s*=)/i,
    reason: "command resolution shadowing via executable resolution override",
  },
];

const WRAPPED_CRITICAL_EXEC: Rule[] = [
  {
    pattern: new RegExp(
      String.raw`\b(?:docker|podman)\s+(?:exec|run)\b(?=.*(?:` +
        WRAPPED_SHELL_HANDOFF +
        String.raw`|--privileged\b|(?:-v|--volume)\s*\/:\s*\/host\b|nsenter\b|chroot\s+\/host\b))(?=.*` +
        WRAPPED_DANGEROUS_PAYLOAD +
        String.raw`)`,
      "i",
    ),
    reason: "dangerous payload tunneled through container wrapper",
  },
  {
    pattern: new RegExp(
      String.raw`\bdocker\s+compose\s+(?:exec|run)\b(?=.*(?:` +
        WRAPPED_SHELL_HANDOFF +
        String.raw`|--privileged\b|(?:-v|--volume)\s*\/:\s*\/host\b|nsenter\b|chroot\s+\/host\b))(?=.*` +
        WRAPPED_DANGEROUS_PAYLOAD +
        String.raw`)`,
      "i",
    ),
    reason: "dangerous payload tunneled through container wrapper",
  },
  {
    pattern: new RegExp(
      String.raw`\bkubectl\s+(?:exec|run)\b(?=.*--\s*(?:sh\s+-c|bash\s+-c|bash\s+-lc)\b)(?=.*` +
        WRAPPED_DANGEROUS_PAYLOAD +
        String.raw`)`,
      "i",
    ),
    reason: "dangerous payload tunneled through kubectl wrapper",
  },
  {
    pattern: new RegExp(
      String.raw`\bkubectl\s+debug\b(?=.*` + WRAPPED_DANGEROUS_PAYLOAD + String.raw`)`,
      "i",
    ),
    reason: "dangerous payload tunneled through kubectl wrapper",
  },
  {
    pattern: new RegExp(
      String.raw`\bosascript\b(?=.*(?:do\s+shell\s+script|tell\s+application\s+"(?:Terminal|iTerm)"))(?=.*` +
        WRAPPED_DANGEROUS_PAYLOAD +
        String.raw`)`,
      "i",
    ),
    reason: "dangerous payload tunneled through AppleScript shell bridge",
  },
  {
    pattern: new RegExp(
      String.raw`\bssh\b(?=.*['"].*` + WRAPPED_DANGEROUS_PAYLOAD + String.raw`.*['"])`,
      "i",
    ),
    reason: "dangerous payload tunneled through remote shell wrapper",
  },
  {
    pattern: new RegExp(
      String.raw`\b(?:cmd(?:\.exe)?\s+\/[cr]|powershell(?:\.exe)?(?:\s+-\S+)*\s+-Command|pwsh(?:\.exe)?(?:\s+-\S+)*\s+-Command)\b(?=.*` +
        WRAPPED_DANGEROUS_PAYLOAD +
        String.raw`)`,
      "i",
    ),
    reason: "dangerous payload tunneled through Windows command host",
  },
  {
    pattern: /\bmshta\b\s+(?:https?:\/\/\S+|javascript:|vbscript:)/i,
    reason: "dangerous payload tunneled through Windows script host",
  },
];

function isQuotedOrCommented(text: string, matchIndex: number): boolean {
  const before = text.slice(0, matchIndex);
  const doubleQuotes = (before.match(/"/g) || []).length;
  if (doubleQuotes % 2 === 1) return true;

  const singleQuotes = (before.match(/'/g) || []).length;
  if (singleQuotes % 2 === 1) return true;

  const lastNewline = before.lastIndexOf("\n");
  const currentLine = before.slice(lastNewline + 1);
  if (currentLine.includes("#")) return true;

  return false;
}

function matchRules(
  text: string,
  rules: Rule[],
  level: "critical" | "warning",
): BlacklistMatch | null {
  for (const rule of rules) {
    const match = rule.pattern.exec(text);
    if (match && !isQuotedOrCommented(text, match.index)) {
      return { level, pattern: rule.pattern.source, reason: rule.reason };
    }
  }
  return null;
}

function splitCommand(cmd: string): string[] {
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
      if ((ch === "&" && cmd[i + 1] === "&") || (ch === "|" && cmd[i + 1] === "|")) {
        segments.push(current.trim());
        current = "";
        i++;
        continue;
      }
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

function hasDangerousTaintStructure(segment: string): boolean {
  return (
    /(?:^|\s)(?:-c|--command|--eval|-e|\/c|\/r|-Command)\b/i.test(segment) ||
    /\/etc\/(?:passwd|shadow|sudoers)\b/i.test(segment) ||
    /[A-Za-z]:\\Windows\\System32\\config\\(?:SAM|SECURITY|SYSTEM)\b/i.test(segment) ||
    /[><]/.test(segment) ||
    /\|\s*(?:bash|sh|zsh|dash|pwsh|powershell|cmd|iex|Invoke-Expression)\b/i.test(segment) ||
    new RegExp(WRAPPED_SHELL_HANDOFF, "i").test(segment)
  );
}

function isClearlyReadOnlySafeSegment(segment: string): boolean {
  return SAFE_EXEC.some((re) => re.test(segment)) && !hasDangerousTaintStructure(segment);
}

function shouldShortCircuitSafeExec(
  segment: string,
  context?: CheckExecBlacklistContext,
): boolean {
  if (!SAFE_EXEC.some((re) => re.test(segment))) return false;
  if (!context?.masqueradeTaintLevel) return true;
  return isClearlyReadOnlySafeSegment(segment);
}

function matchTaintedUnknownExec(
  segment: string,
  context?: CheckExecBlacklistContext,
): BlacklistMatch | null {
  if (!context?.masqueradeTaintLevel) return null;

  const trimmed = segment.trim();
  const token = trimmed.split(/\s+/, 1)[0];
  if (!token || KNOWN_EXECUTABLE_PREFIX.test(token)) return null;
  if (!hasDangerousTaintStructure(trimmed)) return null;

  return {
    level: context.masqueradeTaintLevel === "hard" ? "critical" : "warning",
    pattern: "tainted-unknown-exec",
    reason: "tainted session: untrusted executable name with dangerous execution structure",
  };
}

export function checkExecBlacklist(
  command: string,
  context?: CheckExecBlacklistContext,
): BlacklistMatch | null {
  if (!command) return null;

  const pipeAttacks: Rule[] = [
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
    {
      pattern: /\b(?:curl(?:\.exe)?|Invoke-WebRequest|iwr)\b.*\|\s*(?:Invoke-Expression|iex|powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd(?:\.exe)?)/i,
      reason: "curl pipe to shell (remote code execution)",
    },
    { pattern: /\becho\b.*\|\s*(?:bash|sh|zsh|dash)\b/, reason: "echo pipe to shell" },
    {
      pattern: /\b(?:echo|Write-Output)\b.*\|\s*(?:Invoke-Expression|iex|powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd(?:\.exe)?)\b/i,
      reason: "echo pipe to shell",
    },
    { pattern: /\bprintf\b.*\|\s*(?:bash|sh|zsh|dash)\b/, reason: "printf pipe to shell" },
    { pattern: /\|\s*(?:bash|sh|zsh|dash)\s*$/, reason: "pipe to shell interpreter" },
    { pattern: /\|\s*(?:bash|sh|zsh|dash)\s*[;&|]/, reason: "pipe to shell interpreter" },
    { pattern: /\|\s*(?:Invoke-Expression|iex|powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd(?:\.exe)?)\s*$/i, reason: "pipe to shell interpreter" },
    { pattern: /\|\s*(?:Invoke-Expression|iex|powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd(?:\.exe)?)\s*[;&|]/i, reason: "pipe to shell interpreter" },
    {
      pattern: /\bbase64\b.*\|\s*(?:bash|sh|zsh|dash)/,
      reason: "base64 pipe to shell (encoding bypass)",
    },
    {
      pattern: /\b(?:certutil\b.*-decode|FromBase64String)\b.*\|\s*(?:Invoke-Expression|iex|powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd(?:\.exe)?)/i,
      reason: "base64 pipe to shell (encoding bypass)",
    },
    {
      pattern: /\|.*\bcrontab\s+-\s*$/,
      reason: "pipe to crontab stdin (crontab injection)",
    },
    {
      pattern: /\becho\b.*\|\s*crontab\b/,
      reason: "echo pipe to crontab (crontab injection)",
    },
    {
      pattern: /\b(?:echo|Write-Output)\b.*\|\s*(?:schtasks|Register-ScheduledTask)\b/i,
      reason: "echo pipe to crontab (crontab injection)",
    },
    {
      pattern: /\bGet-ChildItem\b.*\|\s*(?:Remove-Item|ri)\b/i,
      reason: "find -delete (bulk deletion)",
    },
  ];

  const chainAttacks: Rule[] = [
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
    matchRules(command, pipeAttacks, "critical") ??
    matchRules(command, chainAttacks, "critical") ??
    matchRules(command, WRAPPED_CRITICAL_EXEC, "critical") ??
    matchRules(command, EXECUTABLE_MASQUERADE_SETUP, "critical") ??
    matchRules(command, EXECUTABLE_MASQUERADE_HINT, "warning");
  if (fullMatch) return fullMatch;

  const segments = splitCommand(command);

  const criticalOverride: Rule[] = [
    {
      pattern: /(?:cat|less|more|head|tail|type)\s+.*\/etc\/(?:passwd|shadow|sudoers)\b/,
      reason: "read system auth file (bypasses safe-command whitelist)",
    },
    { pattern: /\/etc\/shadow\b/, reason: "access to /etc/shadow (password hashes)" },
    {
      pattern: /(?:type|Get-Content|gc)\s+.*[A-Za-z]:\\Windows\\System32\\config\\(?:SAM|SECURITY|SYSTEM)\b/i,
      reason: "read system auth file (bypasses safe-command whitelist)",
    },
    { pattern: /[A-Za-z]:\\Windows\\System32\\config\\SAM\b/i, reason: "access to /etc/shadow (password hashes)" },
  ];

  for (const segment of segments) {
    const override = matchRules(segment, criticalOverride, "critical");
    if (override) return override;

    const taintedUnknown = matchTaintedUnknownExec(segment, context);
    if (taintedUnknown) return taintedUnknown;

    if (shouldShortCircuitSafeExec(segment, context)) continue;

    const match =
      matchRules(segment, CRITICAL_EXEC, "critical") ?? matchRules(segment, WARNING_EXEC, "warning");
    if (match) return match;
  }

  return null;
}

export function checkPathBlacklist(filePath: string): BlacklistMatch | null {
  if (!filePath) return null;
  return (
    matchRules(filePath, CRITICAL_PATH, "critical") ?? matchRules(filePath, WARNING_PATH, "warning")
  );
}
