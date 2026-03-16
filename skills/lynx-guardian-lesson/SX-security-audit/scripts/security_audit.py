#!/usr/bin/env python3
"""
Security Audit - 全方位安全审计脚本
检查 OpenClaw 配置、Skills、文件权限、依赖漏洞、环境变量、Git 安全、
网络端口、Shell 安全、macOS 安全等多维安全问题。

支持 CLI 参数、JSON 输出、配置文件、检查模块注册机制。
"""

import os
import sys
import json
import re
import math
import argparse
import subprocess
import platform
import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, Callable


# ==================== 颜色输出 ====================

class Colors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'


def print_success(msg: str):
    print(f"{Colors.OKGREEN}✅ {msg}{Colors.ENDC}")


def print_warning(msg: str):
    print(f"{Colors.WARNING}⚠️  {msg}{Colors.ENDC}")


def print_error(msg: str):
    print(f"{Colors.FAIL}❌ {msg}{Colors.ENDC}")


def print_info(msg: str):
    print(f"{Colors.OKCYAN}ℹ️  {msg}{Colors.ENDC}")


def print_header(msg: str):
    print(f"\n{Colors.BOLD}{Colors.HEADER}{msg}{Colors.ENDC}")


# ==================== 配置 ====================

OPENCLAW_DIR = Path.home() / ".openclaw"
WORKSPACE_DIR = OPENCLAW_DIR / "workspace"
SKILLS_DIR = WORKSPACE_DIR / "skills"
CONFIG_FILE = OPENCLAW_DIR / "openclaw.json"


# ==================== 数据模型 ====================

class AuditResult:
    def __init__(self, category: str, name: str, status: str,
                 severity: str, description: str, impact: str, fix: str):
        self.category = category
        self.name = name
        self.status = status      # 'pass', 'warning', 'fail'
        self.severity = severity   # 'low', 'medium', 'high', 'critical'
        self.description = description
        self.impact = impact
        self.fix = fix
        self.timestamp = datetime.datetime.now().isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "category": self.category,
            "name": self.name,
            "status": self.status,
            "severity": self.severity,
            "description": self.description,
            "impact": self.impact,
            "fix": self.fix,
            "timestamp": self.timestamp,
        }


# ==================== 检查模块注册 ====================

_CHECK_REGISTRY: Dict[str, Dict[str, Any]] = {}


def register_check(name: str, description: str = ""):
    """装饰器：注册一个检查模块"""
    def decorator(func: Callable[[], List[AuditResult]]):
        _CHECK_REGISTRY[name] = {
            "func": func,
            "description": description,
            "name": name,
        }
        return func
    return decorator


def get_registered_checks() -> Dict[str, Dict[str, Any]]:
    return _CHECK_REGISTRY


# ==================== 配置文件支持 ====================

def load_audit_config() -> Dict[str, Any]:
    """加载 .security-audit.json 配置文件"""
    default_config = {
        "excludePaths": [],
        "severityThreshold": "low",
        "autoFix": False,
        "reportFormat": "markdown",
    }

    config_locations = [
        Path.cwd() / ".security-audit.json",
        OPENCLAW_DIR / ".security-audit.json",
        WORKSPACE_DIR / ".security-audit.json",
    ]

    for config_path in config_locations:
        if config_path.exists():
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    user_config = json.load(f)
                default_config.update(user_config)
                print_info(f"已加载配置文件: {config_path}")
                return default_config
            except (json.JSONDecodeError, OSError) as e:
                print_warning(f"配置文件解析失败: {config_path}: {e}")

    return default_config


# ==================== 密钥正则模式 ====================

SECRET_PATTERNS = {
    "AWS Access Key": re.compile(r'AKIA[0-9A-Z]{16}'),
    "GitHub Token (classic)": re.compile(r'ghp_[a-zA-Z0-9]{36}'),
    "GitHub Token (fine-grained)": re.compile(r'github_pat_[a-zA-Z0-9_]{22,}'),
    "Slack Token": re.compile(r'xox[bpas]-[a-zA-Z0-9\-]+'),
    "OpenAI/Anthropic Key": re.compile(r'sk-[a-zA-Z0-9]{20,}'),
    "JWT Token": re.compile(r'eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+'),
    "Generic API Key assignment": re.compile(
        r'''(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)'''
        r'''[\s]*[=:]\s*['"][a-zA-Z0-9/+=_\-]{16,}['"]''',
        re.IGNORECASE,
    ),
    "Private Key Block": re.compile(r'-----BEGIN (?:RSA |EC )?PRIVATE KEY-----'),
}

# 恶意脚本检测模式
MALICIOUS_PATTERNS = {
    # 反向Shell
    "Reverse Shell (Bash)": re.compile(
        r'bash\s+-[ilcs]\s*[>&]\s*/dev/(?:tcp|udp)/',
        re.IGNORECASE
    ),
    "Reverse Shell (Python)": re.compile(
        r'(?:socket|subprocess|os\.system).*?(?:connect|dup2|exec)',
        re.IGNORECASE
    ),
    "Reverse Shell (nc/netcat)": re.compile(
        r'(?:nc|netcat).*?(?:-e|-c)\s+',
        re.IGNORECASE
    ),
    
    # 数据外泄
    "Data Exfiltration (curl)": re.compile(
        r'curl\s+.*?(?:--data|-d|-F)\s+.*?(?:password|secret|key|token|credential)',
        re.IGNORECASE
    ),
    "Data Exfiltration (wget)": re.compile(
        r'wget\s+.*?(?:--post-data|--post-file)',
        re.IGNORECASE
    ),
    "Data Exfiltration (Python requests)": re.compile(
        r'requests\.(?:post|put|patch).*?(?:password|secret|key|token|credential)',
        re.IGNORECASE
    ),
    
    # 敏感文件读取
    "Sensitive File Access (/etc/passwd)": re.compile(
        r'(?:open|read|cat|less|more|head|tail)\s+.*?/etc/passwd',
        re.IGNORECASE
    ),
    "Sensitive File Access (SSH keys)": re.compile(
        r'(?:open|read|cat|less|more|head|tail)\s+.*?\.ssh/(?:id_rsa|id_ed25519|authorized_keys)',
        re.IGNORECASE
    ),
    "Sensitive File Access (.env)": re.compile(
        r'(?:open|read|cat|less|more|head|tail)\s+.*?\.env',
        re.IGNORECASE
    ),
    
    # 权限提升
    "Privilege Escalation (sudo)": re.compile(
        r'sudo\s+.*?(?:chmod|chown|usermod|passwd)',
        re.IGNORECASE
    ),
    "Privilege Escalation (SUID)": re.compile(
        r'chmod\s+[uogs]\+s',
        re.IGNORECASE
    ),
    
    # 混淆代码
    "Obfuscated Code (Base64 exec)": re.compile(
        r'(?:base64|b64decode).*?(?:eval|exec|os\.system|subprocess)',
        re.IGNORECASE
    ),
    "Obfuscated Code (hex)": re.compile(
        r'(?:fromhex|bytes\.fromhex|\\x[0-9a-f]{2}).*?(?:eval|exec|os\.system)',
        re.IGNORECASE
    ),
    
    # 远程代码执行
    "Remote Code Execution (curl|bash)": re.compile(
        r'(?:curl|wget).*?\|\s*(?:bash|sh|python|python3)',
        re.IGNORECASE
    ),
    "Remote Code Execution (import from URL)": re.compile(
        r'__import__\s*\(\s*[\'"](?:http|ftp|file)',
        re.IGNORECASE
    ),
    
    # 可疑网络连接
    "Suspicious Network Connection": re.compile(
        r'(?:socket\.socket|requests\.get|urllib\.request).*?(?:pastebin|ngrok|serveo|localtunnel)',
        re.IGNORECASE
    ),
    
    # 文件加密/勒索软件特征
    "Ransomware Pattern (Encryption)": re.compile(
        r'(?:AES|RSA|Fernet).*?(?:encrypt|cipher).*?(?:walk|glob|listdir)',
        re.IGNORECASE
    ),
    
    # 可疑进程操作
    "Process Manipulation": re.compile(
        r'(?:ps|kill|killall|pkill)\s+.*?(?:grep|awk|sed)',
        re.IGNORECASE
    ),
    
    # 环境变量窃取
    "Environment Variable Theft": re.compile(
        r'(?:printenv|env|os\.environ|process\.env)',
        re.IGNORECASE
    ),
    
    # 危险系统命令
    "Dangerous System Command (rm -rf)": re.compile(
        r'rm\s+.*?-rf.*?/',
        re.IGNORECASE
    ),
    "Dangerous System Command (mkfs)": re.compile(
        r'mkfs\.(?:ext[234]|xfs|btrfs|ntfs|vfat)',
        re.IGNORECASE
    ),
    "Dangerous System Command (dd)": re.compile(
        r'dd\s+.*?if=.*?of=',
        re.IGNORECASE
    ),
}


def shannon_entropy(s: str) -> float:
    """计算字符串的 Shannon 熵"""
    if not s:
        return 0.0
    freq = {}
    for c in s:
        freq[c] = freq.get(c, 0) + 1
    length = len(s)
    return -sum((count / length) * math.log2(count / length) for count in freq.values())


# ==================== 检查模块 ====================

@register_check("permissions", "检查敏感文件权限")
def check_file_permissions() -> List[AuditResult]:
    """检查敏感文件权限"""
    results = []
    print_header("🔒 检查敏感文件权限")

    sensitive_files = [
        (Path.home() / ".ssh", 0o700),
        (Path.home() / ".ssh" / "id_rsa", 0o600),
        (Path.home() / ".ssh" / "id_ed25519", 0o600),
        (Path.home() / ".aws" / "credentials", 0o600),
        (Path.home() / ".gnupg", 0o700),
        (OPENCLAW_DIR, 0o700),
        (WORKSPACE_DIR, 0o700),
    ]

    for path, expected_mode in sensitive_files:
        if not path.exists():
            continue

        actual_mode = path.stat().st_mode & 0o777
        # BUG FIX: 原逻辑 `actual_mode < expected_mode` 反了。
        # 权限数值越大越宽松（0o777 > 0o700），应检查是否有超出预期的权限位。
        if actual_mode & ~expected_mode:
            results.append(AuditResult(
                category="权限与访问控制",
                name=f"敏感文件权限: {path.name}",
                status="fail",
                severity="high",
                description=f"文件权限过于宽松: {oct(actual_mode)}, 期望: {oct(expected_mode)}",
                impact=str(path),
                fix=f"chmod {oct(expected_mode)[2:]} {path}",
            ))
        else:
            results.append(AuditResult(
                category="权限与访问控制",
                name=f"敏感文件权限: {path.name}",
                status="pass",
                severity="low",
                description="文件权限设置正确",
                impact=str(path),
                fix="无需操作",
            ))

    return results


@register_check("world_writable", "检测世界可写及 SUID/SGID 文件")
def check_world_writable() -> List[AuditResult]:
    """检测 workspace 下世界可写文件和 SUID/SGID 文件"""
    results = []
    print_header("🔓 检测世界可写文件 / SUID/SGID 文件")

    scan_dir = WORKSPACE_DIR if WORKSPACE_DIR.exists() else Path.cwd()

    world_writable = []
    suid_sgid = []

    try:
        for path in scan_dir.rglob("*"):
            if not path.exists() or path.is_symlink():
                continue
            try:
                mode = path.stat().st_mode
            except OSError:
                continue

            if mode & 0o002:  # o+w
                world_writable.append(path)
            if mode & 0o6000:  # SUID or SGID
                suid_sgid.append((path, mode))
    except PermissionError:
        pass

    if world_writable:
        paths_str = "\n".join(str(p) for p in world_writable[:10])
        suffix = f"\n... 及其他 {len(world_writable) - 10} 个" if len(world_writable) > 10 else ""
        results.append(AuditResult(
            category="权限与访问控制",
            name="世界可写文件",
            status="fail",
            severity="high",
            description=f"发现 {len(world_writable)} 个世界可写文件",
            impact=f"{paths_str}{suffix}",
            fix="chmod o-w <file> 移除世界可写权限",
        ))
    else:
        results.append(AuditResult(
            category="权限与访问控制",
            name="世界可写文件",
            status="pass",
            severity="low",
            description="未发现世界可写文件",
            impact=str(scan_dir),
            fix="无需操作",
        ))

    if suid_sgid:
        paths_str = "\n".join(f"{p} ({oct(m & 0o7777)})" for p, m in suid_sgid[:10])
        results.append(AuditResult(
            category="权限与访问控制",
            name="SUID/SGID 文件",
            status="warning",
            severity="medium",
            description=f"发现 {len(suid_sgid)} 个 SUID/SGID 文件",
            impact=paths_str,
            fix="审查 SUID/SGID 设置的必要性，使用 chmod u-s,g-s <file> 移除",
        ))

    return results


@register_check("config", "检查 OpenClaw 配置文件安全性")
def check_openclaw_config() -> List[AuditResult]:
    """检查 OpenClaw 配置文件安全性"""
    results = []
    print_header("🔐 检查 OpenClaw 配置")

    if not CONFIG_FILE.exists():
        return [AuditResult(
            category="密钥与凭据安全",
            name="OpenClaw 配置文件",
            status="warning",
            severity="medium",
            description="配置文件不存在",
            impact="无法检查配置",
            fix="请检查 OpenClaw 安装",
        )]

    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            config = json.load(f)

        config_str = json.dumps(config, indent=2)

        # 用正则模式扫描配置中的真实密钥
        found_secrets = []
        for pattern_name, pattern in SECRET_PATTERNS.items():
            if pattern.search(config_str):
                found_secrets.append(pattern_name)

        if found_secrets:
            results.append(AuditResult(
                category="密钥与凭据安全",
                name="配置文件密钥泄露",
                status="fail",
                severity="critical",
                description=f"配置文件中检测到真实密钥模式: {', '.join(found_secrets)}",
                impact=str(CONFIG_FILE),
                fix="将密钥移至环境变量，配置文件中使用掩码占位符",
            ))

        # 检查是否有掩码
        if "__OPENCLAW_REDACTED__" not in config_str and not found_secrets:
            results.append(AuditResult(
                category="密钥与凭据安全",
                name="配置密钥掩码",
                status="warning",
                severity="medium",
                description="配置文件中未发现掩码标记，请确认敏感信息已处理",
                impact=str(CONFIG_FILE),
                fix="检查配置文件，确保敏感信息已通过掩码或环境变量处理",
            ))
        elif not found_secrets:
            results.append(AuditResult(
                category="密钥与凭据安全",
                name="配置密钥掩码",
                status="pass",
                severity="low",
                description="敏感信息已正确掩码",
                impact=str(CONFIG_FILE),
                fix="无需操作",
            ))

        # 检查 gateway 认证
        if 'gateway' in config:
            if config.get('gateway', {}).get('auth', {}).get('mode') == 'token':
                results.append(AuditResult(
                    category="密钥与凭据安全",
                    name="Gateway 认证方式",
                    status="warning",
                    severity="medium",
                    description="Gateway 使用 token 认证，请确保 token 安全存储",
                    impact="Gateway 访问",
                    fix="考虑使用更安全的认证方式或定期轮换 token",
                ))

        # 检查插件配置
        if 'plugins' in config and 'installs' in config['plugins']:
            for plugin_name, plugin_info in config['plugins']['installs'].items():
                if 'installPath' in plugin_info:
                    results.append(AuditResult(
                        category="系统安全",
                        name=f"插件安装: {plugin_name}",
                        status="pass",
                        severity="low",
                        description=f"插件已安装: {plugin_info.get('version', 'unknown')}",
                        impact=str(plugin_info.get('installPath', '')),
                        fix="定期更新插件版本",
                    ))

    except Exception as e:
        results.append(AuditResult(
            category="密钥与凭据安全",
            name="OpenClaw 配置解析",
            status="fail",
            severity="critical",
            description=f"配置文件解析失败: {str(e)}",
            impact=str(CONFIG_FILE),
            fix="检查配置文件 JSON 格式是否正确",
        ))

    return results


@register_check("skills", "检查 Skills 代码安全")
def check_skills_security() -> List[AuditResult]:
    """检查 Skills 安全性"""
    results = []
    print_header("📝 检查 Skills 代码安全")

    if not SKILLS_DIR.exists():
        return [AuditResult(
            category="代码安全",
            name="Skills 目录",
            status="warning",
            severity="medium",
            description="Skills 目录不存在",
            impact="无",
            fix="确保 Skills 目录正确配置",
        )]

    dangerous_functions = [
        'eval(', 'exec(', '__import__', 'subprocess.call(',
        'os.system(', 'os.popen(', 'subprocess.run(',
    ]

    for skill_dir in SKILLS_DIR.iterdir():
        if not skill_dir.is_dir():
            continue

        skill_file = skill_dir / "SKILL.md"
        if not skill_file.exists():
            continue

        try:
            with open(skill_file, 'r', encoding='utf-8') as f:
                content = f.read()

            # 用正则检测硬编码密钥
            found_secrets = []
            for pattern_name, pattern in SECRET_PATTERNS.items():
                if pattern.search(content):
                    found_secrets.append(pattern_name)

            if found_secrets:
                results.append(AuditResult(
                    category="密钥与凭据安全",
                    name=f"Skills 硬编码密钥: {skill_dir.name}",
                    status="fail",
                    severity="high",
                    description=f"发现密钥模式: {', '.join(found_secrets[:3])}",
                    impact=str(skill_file),
                    fix="将敏感信息移至环境变量或配置文件",
                ))

            # 检查危险函数
            content_lower = content.lower()
            found_dangerous = [fn for fn in dangerous_functions if fn in content_lower]
            if found_dangerous:
                results.append(AuditResult(
                    category="代码安全",
                    name=f"Skills 危险函数: {skill_dir.name}",
                    status="warning",
                    severity="medium",
                    description=f"发现可能的危险函数: {', '.join(found_dangerous[:3])}",
                    impact=str(skill_file),
                    fix="审查代码逻辑，确保不执行未经验证的输入",
                ))

            # 检查脚本文件
            scripts_dir = skill_dir / "scripts"
            if scripts_dir.exists():
                for script_file in scripts_dir.glob("*.py"):
                    _check_script_file(script_file, results)

        except Exception as e:
            results.append(AuditResult(
                category="代码安全",
                name=f"Skills 检查: {skill_dir.name}",
                status="warning",
                severity="low",
                description=f"检查失败: {str(e)}",
                impact=str(skill_dir),
                fix="检查文件编码和权限",
            ))

    return results


def _check_script_file(script_file: Path, results: List[AuditResult]):
    """检查单个脚本文件中的密钥模式和恶意脚本"""
    try:
        with open(script_file, 'r', encoding='utf-8') as f:
            content = f.read()

        # 检查密钥模式
        for pattern_name, pattern in SECRET_PATTERNS.items():
            if pattern.search(content):
                results.append(AuditResult(
                    category="密钥与凭据安全",
                    name=f"脚本密钥泄露: {script_file.name}",
                    status="fail",
                    severity="high",
                    description=f"检测到 {pattern_name} 模式",
                    impact=str(script_file),
                    fix="使用环境变量或配置文件管理密钥",
                ))
                break

        # 检查恶意脚本模式
        malicious_findings = []
        for pattern_name, pattern in MALICIOUS_PATTERNS.items():
            matches = pattern.findall(content)
            if matches:
                malicious_findings.append((pattern_name, len(matches)))

        if malicious_findings:
            findings_desc = ", ".join([f"{name}({count}次)" for name, count in malicious_findings[:3]])
            severity = "critical" if len(malicious_findings) >= 3 else "high"
            results.append(AuditResult(
                category="恶意脚本检测",
                name=f"恶意脚本特征: {script_file.name}",
                status="fail",
                severity=severity,
                description=f"检测到恶意行为模式: {findings_desc}",
                impact=str(script_file),
                fix="审查脚本内容，移除恶意代码；如非必要，建议删除此脚本",
            ))

        # 高熵字符串检测
        # 查找长引号字符串中的高熵内容
        for match in re.finditer(r'''['"]([a-zA-Z0-9/+=_\-]{20,})['"]''', content):
            token = match.group(1)
            if shannon_entropy(token) > 4.5:
                results.append(AuditResult(
                    category="密钥与凭据安全",
                    name=f"脚本高熵字符串: {script_file.name}",
                    status="warning",
                    severity="medium",
                    description=f"发现高熵字符串 (entropy={shannon_entropy(token):.1f}): {token[:16]}...",
                    impact=str(script_file),
                    fix="确认此字符串是否为密钥，如是请移至环境变量",
                ))
                break

        # 检查可疑的网络请求
        suspicious_urls = re.findall(
            r'https?://(?:pastebin\.com|ngrok\.io|serveo\.net|localtunnel\.me|raw\.githubusercontent\.com/(?!Panniantong/agent-reach))[^\'"\s]*',
            content,
            re.IGNORECASE
        )
        if suspicious_urls:
            results.append(AuditResult(
                category="恶意脚本检测",
                name=f"可疑网络请求: {script_file.name}",
                status="warning",
                severity="medium",
                description=f"检测到可疑URL: {suspicious_urls[0][:50]}...",
                impact=str(script_file),
                fix="确认此URL是否为必要的远程资源，警惕远程代码执行风险",
            ))

        # 检查可疑的导入模块
        suspicious_imports = re.findall(
            r'(?:import|from)\s+(?:pty|ptyprocess|paramiko|fabric|ansible)',
            content,
            re.IGNORECASE
        )
        if suspicious_imports:
            results.append(AuditResult(
                category="恶意脚本检测",
                name=f"可疑模块导入: {script_file.name}",
                status="warning",
                severity="medium",
                description=f"检测到可疑模块: {', '.join(suspicious_imports[:3])}",
                impact=str(script_file),
                fix="确认模块用途是否合法，警惕远程控制风险",
            ))

    except Exception:
        pass


@register_check("dependencies", "检查依赖漏洞")
def check_dependencies() -> List[AuditResult]:
    """检查依赖漏洞"""
    results = []
    print_header("📦 检查依赖漏洞")

    package_jsons = list(WORKSPACE_DIR.rglob("package.json")) if WORKSPACE_DIR.exists() else []

    for pkg_file in package_jsons:
        try:
            dir_path = pkg_file.parent

            if not (dir_path / "node_modules").exists():
                results.append(AuditResult(
                    category="依赖与供应链安全",
                    name=f"NPM 依赖未安装: {dir_path.name}",
                    status="info",
                    severity="low",
                    description="需要运行 npm install",
                    impact=str(dir_path),
                    fix=f"cd {dir_path} && npm install",
                ))
                continue

            result = subprocess.run(
                ['npm', 'audit', '--json'],
                cwd=dir_path,
                capture_output=True,
                text=True,
                timeout=60,
            )

            # BUG FIX: npm audit 发现漏洞时返回非零 returncode。
            # 无论 returncode 如何都应解析 JSON stdout。
            try:
                audit_data = json.loads(result.stdout)
                vulnerabilities = audit_data.get('vulnerabilities', {})

                if vulnerabilities:
                    total_vulns = len(vulnerabilities)
                    severity_counts = {}
                    for vuln_info in vulnerabilities.values():
                        sev = vuln_info.get('severity', 'unknown')
                        severity_counts[sev] = severity_counts.get(sev, 0) + 1

                    severity_str = ", ".join(f"{k}: {v}" for k, v in severity_counts.items())
                    max_sev = "critical" if "critical" in severity_counts else (
                        "high" if "high" in severity_counts else "medium"
                    )

                    results.append(AuditResult(
                        category="依赖与供应链安全",
                        name=f"NPM 漏洞: {dir_path.name}",
                        status="fail",
                        severity=max_sev,
                        description=f"发现 {total_vulns} 个已知漏洞 ({severity_str})",
                        impact=str(pkg_file),
                        fix=f"cd {dir_path} && npm audit fix",
                    ))
                else:
                    results.append(AuditResult(
                        category="依赖与供应链安全",
                        name=f"NPM 漏洞: {dir_path.name}",
                        status="pass",
                        severity="low",
                        description="无已知漏洞",
                        impact=str(pkg_file),
                        fix="定期运行 npm audit",
                    ))
            except json.JSONDecodeError:
                results.append(AuditResult(
                    category="依赖与供应链安全",
                    name=f"NPM 审计: {dir_path.name}",
                    status="warning",
                    severity="low",
                    description=f"npm audit 输出格式异常 (returncode={result.returncode})",
                    impact=str(pkg_file),
                    fix="检查 npm 版本",
                ))

        except subprocess.TimeoutExpired:
            results.append(AuditResult(
                category="依赖与供应链安全",
                name=f"NPM 审计超时: {dir_path.name}",
                status="warning",
                severity="low",
                description="npm audit 执行超时",
                impact=str(pkg_file),
                fix="稍后重试或手动检查",
            ))
        except FileNotFoundError:
            results.append(AuditResult(
                category="依赖与供应链安全",
                name="NPM 未安装",
                status="warning",
                severity="low",
                description="系统未安装 npm",
                impact="NPM 依赖审计不可用",
                fix="安装 Node.js / npm",
            ))
            break
        except Exception as e:
            results.append(AuditResult(
                category="依赖与供应链安全",
                name=f"NPM 审计: {dir_path.name}",
                status="warning",
                severity="low",
                description=f"检查失败: {str(e)}",
                impact=str(pkg_file),
                fix="检查 npm 是否正确安装",
            ))

    return results


@register_check("env", "扫描环境变量中的敏感信息")
def check_env_variables() -> List[AuditResult]:
    """扫描当前进程环境变量中的敏感信息"""
    results = []
    print_header("🌍 检查环境变量安全")

    sensitive_env_patterns = [
        (re.compile(r'(?:API[_-]?KEY|API[_-]?SECRET)', re.I), "API 密钥"),
        (re.compile(r'(?:ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|BEARER)', re.I), "访问令牌"),
        (re.compile(r'(?:PASSWORD|PASSWD|PWD)(?!.*PATH)', re.I), "密码"),
        (re.compile(r'(?:SECRET[_-]?KEY|PRIVATE[_-]?KEY)', re.I), "私钥"),
        (re.compile(r'(?:DB[_-]?PASSWORD|DATABASE[_-]?URL)', re.I), "数据库凭据"),
    ]

    exposed = []

    for env_name, env_value in os.environ.items():
        for pattern, desc in sensitive_env_patterns:
            if pattern.search(env_name):
                # 检查值是否是真实密钥（非占位符）
                if env_value and env_value not in ('', 'your-key-here', 'changeme', 'xxx'):
                    exposed.append((env_name, desc))
                break

        # 检查值中是否包含已知密钥格式
        if env_value:
            for pattern_name, pattern in SECRET_PATTERNS.items():
                if pattern.search(env_value):
                    exposed.append((env_name, f"值匹配 {pattern_name} 模式"))
                    break

    if exposed:
        details = "\n".join(f"  - {name}: {desc}" for name, desc in exposed[:10])
        results.append(AuditResult(
            category="密钥与凭据安全",
            name="环境变量敏感信息",
            status="warning",
            severity="medium",
            description=f"发现 {len(exposed)} 个可能含敏感信息的环境变量:\n{details}",
            impact="当前进程环境",
            fix="审查这些环境变量是否必要，避免在不需要的子进程中暴露",
        ))
    else:
        results.append(AuditResult(
            category="密钥与凭据安全",
            name="环境变量敏感信息",
            status="pass",
            severity="low",
            description="未发现异常敏感环境变量",
            impact="当前进程环境",
            fix="无需操作",
        ))

    return results


@register_check("git", "检查 Git 安全配置")
def check_git_security() -> List[AuditResult]:
    """检查 Git 安全：.gitignore、凭据存储、近期 commit 中的密钥"""
    results = []
    print_header("🔀 检查 Git 安全")

    # 查找 workspace 下的 git 仓库
    git_repos = []
    scan_dir = WORKSPACE_DIR if WORKSPACE_DIR.exists() else Path.cwd()

    for gitdir in scan_dir.rglob(".git"):
        if gitdir.is_dir():
            git_repos.append(gitdir.parent)

    if not git_repos:
        results.append(AuditResult(
            category="代码安全",
            name="Git 仓库",
            status="pass",
            severity="low",
            description="未发现 Git 仓库",
            impact=str(scan_dir),
            fix="无需操作",
        ))
        return results

    sensitive_gitignore_entries = [
        '.env', '.env.local', '.env.production',
        '*.pem', '*.key', '*.p12',
        'credentials.json', 'secrets.json', 'service-account.json',
        '.secret', '*.secret',
    ]

    for repo in git_repos[:5]:  # 限制扫描仓库数量
        # 检查 .gitignore
        gitignore = repo / ".gitignore"
        if gitignore.exists():
            try:
                with open(gitignore, 'r', encoding='utf-8') as f:
                    gitignore_content = f.read()
                missing = [
                    entry for entry in sensitive_gitignore_entries
                    if entry not in gitignore_content
                ]
                if missing:
                    results.append(AuditResult(
                        category="代码安全",
                        name=f"Git .gitignore 缺失条目: {repo.name}",
                        status="warning",
                        severity="medium",
                        description=f".gitignore 未包含: {', '.join(missing[:5])}",
                        impact=str(gitignore),
                        fix=f"将以下条目添加到 .gitignore: {', '.join(missing[:5])}",
                    ))
            except OSError:
                pass
        else:
            results.append(AuditResult(
                category="代码安全",
                name=f"Git .gitignore 缺失: {repo.name}",
                status="warning",
                severity="medium",
                description="仓库缺少 .gitignore 文件",
                impact=str(repo),
                fix="创建 .gitignore 并添加敏感文件模式",
            ))

        # 检查 git config 凭据存储
        try:
            result = subprocess.run(
                ['git', 'config', '--local', 'credential.helper'],
                cwd=repo, capture_output=True, text=True, timeout=5,
            )
            helper = result.stdout.strip()
            if helper == 'store':
                results.append(AuditResult(
                    category="密钥与凭据安全",
                    name=f"Git 凭据明文存储: {repo.name}",
                    status="fail",
                    severity="high",
                    description="Git 配置使用 credential.helper=store (明文存储)",
                    impact=str(repo / ".git" / "config"),
                    fix="git config --local credential.helper osxkeychain  (macOS) 或 cache",
                ))
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            pass

        # 扫描最近 commit 的 diff 中的密钥模式
        try:
            result = subprocess.run(
                ['git', 'log', '--oneline', '-10', '--diff-filter=A', '-p', '--'],
                cwd=repo, capture_output=True, text=True, timeout=15,
            )
            if result.stdout:
                for pattern_name, pattern in SECRET_PATTERNS.items():
                    if pattern.search(result.stdout):
                        results.append(AuditResult(
                            category="密钥与凭据安全",
                            name=f"Git 历史密钥泄露: {repo.name}",
                            status="fail",
                            severity="critical",
                            description=f"最近 commit 中检测到 {pattern_name} 模式",
                            impact=str(repo),
                            fix="使用 git-filter-repo 或 BFG 清理历史，并轮换泄露的密钥",
                        ))
                        break
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            pass

    return results


@register_check("network", "检查网络监听端口")
def check_network_ports() -> List[AuditResult]:
    """使用 lsof 检查监听端口"""
    results = []
    print_header("🌐 检查网络端口安全")

    try:
        result = subprocess.run(
            ['lsof', '-i', '-P', '-n', '-sTCP:LISTEN'],
            capture_output=True, text=True, timeout=10,
        )

        if result.returncode != 0 and not result.stdout:
            results.append(AuditResult(
                category="网络安全",
                name="端口扫描",
                status="pass",
                severity="low",
                description="未发现监听端口（或需要 sudo 权限）",
                impact="网络监听",
                fix="无需操作",
            ))
            return results

        lines = result.stdout.strip().split('\n')
        if len(lines) <= 1:
            results.append(AuditResult(
                category="网络安全",
                name="端口扫描",
                status="pass",
                severity="low",
                description="未发现监听端口",
                impact="网络监听",
                fix="无需操作",
            ))
            return results

        wildcard_listeners = []
        all_listeners = []

        for line in lines[1:]:  # 跳过 header
            parts = line.split()
            if len(parts) < 9:
                continue

            process_name = parts[0]
            pid = parts[1]
            name_field = parts[8]  # host:port

            all_listeners.append(f"{process_name}(pid={pid}) -> {name_field}")

            # 检查 0.0.0.0 或 * 监听（全接口暴露）
            if name_field.startswith('*:') or name_field.startswith('0.0.0.0:'):
                wildcard_listeners.append(f"{process_name}(pid={pid}) -> {name_field}")

        if wildcard_listeners:
            details = "\n".join(f"  - {l}" for l in wildcard_listeners[:10])
            results.append(AuditResult(
                category="网络安全",
                name="全接口监听端口",
                status="warning",
                severity="high",
                description=f"发现 {len(wildcard_listeners)} 个进程监听所有网络接口:\n{details}",
                impact="外部可能直接访问这些服务",
                fix="将监听地址限制为 127.0.0.1 或特定接口",
            ))

        if all_listeners:
            details = "\n".join(f"  - {l}" for l in all_listeners[:15])
            results.append(AuditResult(
                category="网络安全",
                name="监听端口清单",
                status="pass" if not wildcard_listeners else "warning",
                severity="low",
                description=f"当前监听 {len(all_listeners)} 个端口:\n{details}",
                impact="网络监听",
                fix="审查是否所有端口都是必要的",
            ))

    except FileNotFoundError:
        results.append(AuditResult(
            category="网络安全",
            name="端口扫描",
            status="warning",
            severity="low",
            description="lsof 命令不可用",
            impact="网络端口检查不可用",
            fix="安装 lsof 或使用 netstat",
        ))
    except subprocess.TimeoutExpired:
        results.append(AuditResult(
            category="网络安全",
            name="端口扫描超时",
            status="warning",
            severity="low",
            description="lsof 执行超时",
            impact="网络端口检查",
            fix="稍后重试",
        ))

    return results


@register_check("shell", "检查 Shell 历史与配置安全")
def check_shell_security() -> List[AuditResult]:
    """检查 shell 历史文件权限和配置文件中的明文密钥"""
    results = []
    print_header("🐚 检查 Shell 安全")

    home = Path.home()

    # 检查历史文件权限
    history_files = [
        home / ".bash_history",
        home / ".zsh_history",
        home / ".python_history",
    ]

    for hist_file in history_files:
        if not hist_file.exists():
            continue
        mode = hist_file.stat().st_mode & 0o777
        if mode & ~0o600:
            results.append(AuditResult(
                category="权限与访问控制",
                name=f"Shell 历史文件权限: {hist_file.name}",
                status="warning",
                severity="medium",
                description=f"权限过于宽松: {oct(mode)}，可能泄露命令历史",
                impact=str(hist_file),
                fix=f"chmod 600 {hist_file}",
            ))

    # 检查 rc 文件中的明文导出密钥
    rc_files = [
        home / ".bashrc",
        home / ".zshrc",
        home / ".bash_profile",
        home / ".profile",
    ]

    export_secret_pattern = re.compile(
        r'''export\s+\w*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD)\w*\s*=\s*['"]?[a-zA-Z0-9/+=_\-]{8,}['"]?''',
        re.IGNORECASE,
    )

    for rc_file in rc_files:
        if not rc_file.exists():
            continue
        try:
            with open(rc_file, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()

            matches = export_secret_pattern.findall(content)
            if matches:
                sanitized = [m[:50] + "..." if len(m) > 50 else m for m in matches[:3]]
                results.append(AuditResult(
                    category="密钥与凭据安全",
                    name=f"Shell 配置明文密钥: {rc_file.name}",
                    status="fail",
                    severity="high",
                    description=f"发现 {len(matches)} 处明文导出密钥: {'; '.join(sanitized)}",
                    impact=str(rc_file),
                    fix="将密钥移至 .env 文件或密钥管理服务，不在 shell 配置中硬编码",
                ))
        except OSError:
            pass

    if not any(r.status in ('fail', 'warning') for r in results):
        results.append(AuditResult(
            category="密钥与凭据安全",
            name="Shell 安全检查",
            status="pass",
            severity="low",
            description="Shell 配置未发现安全问题",
            impact="Shell 环境",
            fix="无需操作",
        ))

    return results


@register_check("macos", "检查 macOS 安全设置")
def check_macos_security() -> List[AuditResult]:
    """检查 macOS 特有的安全设置"""
    results = []

    if platform.system() != 'Darwin':
        return results

    print_header("🍎 检查 macOS 安全设置")

    # 检查防火墙
    try:
        result = subprocess.run(
            ['/usr/libexec/ApplicationFirewall/socketfilterfw', '--getglobalstate'],
            capture_output=True, text=True, timeout=5,
        )
        if 'enabled' in result.stdout.lower():
            results.append(AuditResult(
                category="系统安全",
                name="macOS 防火墙",
                status="pass",
                severity="low",
                description="防火墙已启用",
                impact="网络安全",
                fix="无需操作",
            ))
        else:
            results.append(AuditResult(
                category="系统安全",
                name="macOS 防火墙",
                status="fail",
                severity="high",
                description="防火墙未启用",
                impact="系统可能暴露不必要的网络服务",
                fix="系统偏好设置 > 安全性与隐私 > 防火墙 > 打开防火墙",
            ))
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        results.append(AuditResult(
            category="系统安全",
            name="macOS 防火墙",
            status="warning",
            severity="low",
            description="无法检查防火墙状态",
            impact="网络安全",
            fix="手动检查: /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate",
        ))

    # 检查 Gatekeeper
    try:
        result = subprocess.run(
            ['spctl', '--status'],
            capture_output=True, text=True, timeout=5,
        )
        output = result.stdout.strip() + result.stderr.strip()
        if 'enabled' in output.lower():
            results.append(AuditResult(
                category="系统安全",
                name="macOS Gatekeeper",
                status="pass",
                severity="low",
                description="Gatekeeper 已启用",
                impact="应用安全",
                fix="无需操作",
            ))
        else:
            results.append(AuditResult(
                category="系统安全",
                name="macOS Gatekeeper",
                status="fail",
                severity="high",
                description="Gatekeeper 已禁用，可能运行未签名应用",
                impact="系统可能运行恶意软件",
                fix="sudo spctl --master-enable",
            ))
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass

    # 检查 SIP
    try:
        result = subprocess.run(
            ['csrutil', 'status'],
            capture_output=True, text=True, timeout=5,
        )
        if 'enabled' in result.stdout.lower():
            results.append(AuditResult(
                category="系统安全",
                name="macOS SIP (系统完整性保护)",
                status="pass",
                severity="low",
                description="SIP 已启用",
                impact="系统完整性",
                fix="无需操作",
            ))
        else:
            results.append(AuditResult(
                category="系统安全",
                name="macOS SIP (系统完整性保护)",
                status="fail",
                severity="critical",
                description="SIP 已禁用，系统文件可能被篡改",
                impact="系统完整性保护缺失",
                fix="重启到恢复模式，运行 csrutil enable",
            ))
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass

    return results


# ==================== 报告生成 ====================

def generate_report(results: List[AuditResult]) -> str:
    """生成 Markdown 格式报告"""
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    total = len(results)
    passed = sum(1 for r in results if r.status == 'pass')
    warnings = sum(1 for r in results if r.status == 'warning')
    fails = sum(1 for r in results if r.status == 'fail')

    critical_count = sum(1 for r in results if r.severity == 'critical')
    high_count = sum(1 for r in results if r.severity == 'high')
    medium_count = sum(1 for r in results if r.severity == 'medium')
    low_count = sum(1 for r in results if r.severity == 'low')

    report = []
    report.append("# 🔒 OpenClaw 安全审计报告")
    report.append(f"\n**审计时间**: {now}")

    # 列出执行的检查模块
    categories = sorted(set(r.category for r in results))
    report.append(f"**审计范围**: {', '.join(categories)}")

    report.append("\n---\n## 📊 执行摘要")
    report.append(f"- ✅ 通过: {passed}")
    report.append(f"- ⚠️ 警告: {warnings}")
    report.append(f"- ❌ 失败: {fails}")
    report.append(f"- 📋 总计: {total}")

    report.append("\n### 风险等级分布")
    report.append(f"- 🔴 严重: {critical_count}")
    report.append(f"- 🟠 高: {high_count}")
    report.append(f"- 🟡 中: {medium_count}")
    report.append(f"- 🟢 低: {low_count}")

    severity_order = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}
    sorted_results = sorted(results, key=lambda x: severity_order.get(x.severity, 4))

    report.append("\n---\n## 🔍 详细检查结果")

    current_category = None
    for result in sorted_results:
        if result.category != current_category:
            current_category = result.category
            report.append(f"\n### {result.category}")

        status_icon = {"pass": "✅", "warning": "⚠️", "fail": "❌"}.get(result.status, "ℹ️")
        severity_icon = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}.get(result.severity, "⚪")

        report.append(f"\n{status_icon} **{result.name}**")
        report.append(f"- 状态: {result.status}")
        report.append(f"- 风险等级: {severity_icon} {result.severity}")

        if result.status != "pass":
            report.append(f"- 问题描述: {result.description}")
            report.append(f"- 影响范围: `{result.impact}`")
            report.append(f"- 修复建议: `{result.fix}`")

    failed_results = [r for r in sorted_results if r.status in ['fail', 'warning']]
    if failed_results:
        report.append("\n---\n## 📋 优先修复清单")

        for i, result in enumerate(failed_results, 1):
            severity_icon = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}.get(result.severity, "⚪")
            report.append(f"\n{i}. {severity_icon} **{result.name}**")
            report.append(f"   ```bash")
            report.append(f"   {result.fix}")
            report.append(f"   ```")

    return "\n".join(report)


def generate_json_report(results: List[AuditResult]) -> str:
    """生成 JSON 格式报告"""
    now = datetime.datetime.now().isoformat()

    report = {
        "audit_time": now,
        "summary": {
            "total": len(results),
            "passed": sum(1 for r in results if r.status == 'pass'),
            "warnings": sum(1 for r in results if r.status == 'warning'),
            "failed": sum(1 for r in results if r.status == 'fail'),
            "by_severity": {
                "critical": sum(1 for r in results if r.severity == 'critical'),
                "high": sum(1 for r in results if r.severity == 'high'),
                "medium": sum(1 for r in results if r.severity == 'medium'),
                "low": sum(1 for r in results if r.severity == 'low'),
            },
        },
        "results": [r.to_dict() for r in results],
    }

    return json.dumps(report, indent=2, ensure_ascii=False)


def save_report(report: str, output_file: Optional[str] = None, extension: str = "md"):
    """保存报告到文件"""
    if output_file is None:
        timestamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        output_file = OPENCLAW_DIR / "logs" / f"security-audit-{timestamp}.{extension}"

    output_path = Path(output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(report)

    print_success(f"报告已保存到: {output_path}")
    return str(output_path)


# ==================== CLI ====================

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="OpenClaw 安全审计工具 - 全方位安全检查",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
示例:
  %(prog)s                          运行所有检查
  %(prog)s --check permissions env  只运行权限和环境变量检查
  %(prog)s --severity high          只显示 high 及以上级别
  %(prog)s --json                   输出 JSON 格式
  %(prog)s --json --output report.json
  %(prog)s --list-checks            列出可用检查模块
""",
    )

    parser.add_argument(
        '--check', nargs='+', metavar='NAME',
        help="指定要运行的检查模块（默认全部）",
    )
    parser.add_argument(
        '--severity', choices=['low', 'medium', 'high', 'critical'],
        default='low',
        help="最低显示/报告的严重级别 (默认: low)",
    )
    parser.add_argument(
        '--output', '-o', metavar='FILE',
        help="报告输出路径",
    )
    parser.add_argument(
        '--json', action='store_true', dest='json_output',
        help="输出 JSON 格式报告",
    )
    parser.add_argument(
        '--list-checks', action='store_true',
        help="列出所有可用的检查模块",
    )
    parser.add_argument(
        '--quiet', '-q', action='store_true',
        help="静默模式，只输出报告不输出进度信息",
    )

    return parser


def filter_by_severity(results: List[AuditResult], min_severity: str) -> List[AuditResult]:
    """按最低严重级别过滤结果"""
    severity_levels = {'low': 0, 'medium': 1, 'high': 2, 'critical': 3}
    threshold = severity_levels.get(min_severity, 0)
    return [r for r in results if severity_levels.get(r.severity, 0) >= threshold]


# ==================== 主程序 ====================

def main():
    parser = build_parser()
    args = parser.parse_args()

    checks = get_registered_checks()

    # 列出检查模块
    if args.list_checks:
        print(f"\n可用检查模块 ({len(checks)} 个):\n")
        for name, info in checks.items():
            print(f"  {name:20s} - {info['description']}")
        print(f"\n使用 --check <name> 指定运行的模块")
        return

    # 加载配置
    config = load_audit_config()

    if not args.quiet:
        print(f"{Colors.BOLD}{Colors.HEADER}🔒 OpenClaw 安全审计工具{Colors.ENDC}")
        print(f"开始时间: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # 确定要运行的检查
    if args.check:
        selected = []
        for name in args.check:
            if name not in checks:
                print_error(f"未知检查模块: {name}")
                print_info(f"可用模块: {', '.join(checks.keys())}")
                sys.exit(1)
            selected.append(name)
    else:
        selected = list(checks.keys())

    # 运行检查
    all_results = []
    for name in selected:
        check_func = checks[name]["func"]
        try:
            results = check_func()
            all_results.extend(results)
        except Exception as e:
            print_error(f"检查模块 {name} 执行失败: {e}")
            all_results.append(AuditResult(
                category="系统",
                name=f"模块执行失败: {name}",
                status="warning",
                severity="low",
                description=str(e),
                impact=name,
                fix="检查模块代码",
            ))

    # 应用配置中的 severityThreshold
    config_severity = config.get("severityThreshold", "low")
    effective_severity = args.severity if args.severity != 'low' else config_severity
    filtered_results = filter_by_severity(all_results, effective_severity)

    # 生成报告
    if args.json_output:
        report = generate_json_report(filtered_results)
        extension = "json"
    else:
        report = generate_report(filtered_results)
        extension = "md"

    # 保存报告
    report_file = save_report(report, output_file=args.output, extension=extension)

    # 输出到控制台
    if not args.quiet:
        print("\n" + report)
        print_info(f"审计完成，共 {len(all_results)} 个检查项"
                   + (f"，显示 {len(filtered_results)} 个 (>= {effective_severity})"
                      if len(filtered_results) != len(all_results) else ""))

    return report_file


if __name__ == "__main__":
    main()
