/**
 * Security Audit Runner
 *
 * TypeScript bridge to run the Python security audit scripts from
 * the SX-security-audit skill. Provides programmatic access to run
 * audits, parse results, and trigger malicious script scanning.
 */

import { execFile, execFileSync } from "child_process";
import { existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface AuditFinding {
  category: string;
  name: string;
  status: "pass" | "warning" | "fail";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  impact: string;
  fix: string;
  timestamp: string;
}

export interface AuditReport {
  audit_time: string;
  summary: {
    total: number;
    passed: number;
    warnings: number;
    failed: number;
    by_severity: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
  };
  results: AuditFinding[];
}

export interface ScanFinding {
  type: string;
  file: string;
  severity: string;
  description: string;
  details: any;
}

function findScriptsDir(): string | null {
  const candidates = [
    join(__dirname, "skills", "lynx-guardian-lesson", "SX-security-audit", "scripts"),
    join(__dirname, "..", "skills", "lynx-guardian-lesson", "SX-security-audit", "scripts"),
    join(__dirname, "..", "..", "skills", "lynx-guardian-lesson", "SX-security-audit", "scripts"),
    join(homedir(), ".openclaw", "skills", "lynx-guardian-lesson", "SX-security-audit", "scripts"),
  ];

  for (const dir of candidates) {
    const resolved = resolve(dir);
    if (existsSync(resolved)) return resolved;
  }
  return null;
}

function findPython(): string {
  const candidates = ["python3", "python"];
  for (const cmd of candidates) {
    try {
      execFileSync("which", [cmd], { stdio: "ignore" });
      return cmd;
    } catch {
      continue;
    }
  }
  return "python3";
}

/**
 * Run a full security audit with optional module selection.
 * Returns parsed JSON results or null on failure.
 */
export function runSecurityAudit(
  checks?: string[],
  severity?: string,
): Promise<AuditReport | null> {
  return new Promise((done) => {
    const scriptsDir = findScriptsDir();
    if (!scriptsDir) {
      done(null);
      return;
    }

    const auditScript = join(scriptsDir, "security_audit.py");
    if (!existsSync(auditScript)) {
      done(null);
      return;
    }

    const python = findPython();
    const args = [auditScript, "--json", "--quiet"];
    if (checks && checks.length > 0) {
      args.push("--check", ...checks);
    }
    if (severity) {
      args.push("--severity", severity);
    }

    execFile(python, args, { timeout: 120000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout) => {
      if (error && !stdout) {
        done(null);
        return;
      }
      try {
        const report = JSON.parse(stdout) as AuditReport;
        done(report);
      } catch {
        done(null);
      }
    });
  });
}

/**
 * Run the malicious script scanner on the skills directory.
 * Returns structured findings or null on failure.
 */
export function runMaliciousScriptScan(): Promise<ScanFinding[] | null> {
  return new Promise((done) => {
    const scriptsDir = findScriptsDir();
    if (!scriptsDir) {
      done(null);
      return;
    }

    const scannerScript = join(scriptsDir, "malicious_script_scanner.py");
    if (!existsSync(scannerScript)) {
      done(null);
      return;
    }

    const python = findPython();
    execFile(python, [scannerScript], { timeout: 60000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      // The scanner returns exit code 1 when findings exist — that's expected
      if (!stdout) {
        done(error ? null : []);
        return;
      }

      // Parse the text output into structured findings
      const findings: ScanFinding[] = [];
      const lines = stdout.split("\n");

      let currentFinding: Partial<ScanFinding> | null = null;
      for (const line of lines) {
        const match = line.match(/^\[(\w+)\]\s+(\w+)/);
        if (match) {
          if (currentFinding?.type) {
            findings.push(currentFinding as ScanFinding);
          }
          currentFinding = {
            severity: match[1].toLowerCase(),
            type: match[2].toLowerCase(),
            file: "",
            description: "",
            details: null,
          };
        } else if (currentFinding) {
          if (line.startsWith("文件:") || line.startsWith("File:")) {
            currentFinding.file = line.split(":").slice(1).join(":").trim();
          } else if (line.startsWith("描述:") || line.startsWith("Description:")) {
            currentFinding.description = line.split(":").slice(1).join(":").trim();
          }
        }
      }
      if (currentFinding?.type) {
        findings.push(currentFinding as ScanFinding);
      }

      done(findings);
    });
  });
}

/**
 * Get a summary string suitable for logging or display.
 */
export function formatAuditSummary(report: AuditReport): string {
  const s = report.summary;
  const lines = [
    `🔒 安全审计完成 (${report.audit_time})`,
    `✅ 通过: ${s.passed} | ⚠️ 警告: ${s.warnings} | ❌ 失败: ${s.failed} | 📋 总计: ${s.total}`,
    `风险分布: 🔴 严重=${s.by_severity.critical} 🟠 高=${s.by_severity.high} 🟡 中=${s.by_severity.medium} 🟢 低=${s.by_severity.low}`,
  ];

  const criticalFindings = report.results.filter(
    (r) => r.status === "fail" && (r.severity === "critical" || r.severity === "high"),
  );
  if (criticalFindings.length > 0) {
    lines.push("", "⚠️ 需关注:");
    for (const f of criticalFindings.slice(0, 5)) {
      lines.push(`  - [${f.severity}] ${f.name}: ${f.description}`);
    }
  }

  return lines.join("\n");
}
