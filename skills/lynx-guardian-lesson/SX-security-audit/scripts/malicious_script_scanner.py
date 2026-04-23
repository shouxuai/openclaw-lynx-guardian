#!/usr/bin/env python3
"""
Malicious Script Scanner - 恶意脚本扫描器
检测写入skill的恶意脚本特征
"""

import math
import re
from pathlib import Path
from typing import Any, Dict, List


CRITICAL_PATTERN_NAMES = {
    "Reverse Shell",
    "Data Exfiltration",
    "Remote Code Execution",
    "PowerShell Encoded Command",
    "Base64 Loader Execution",
    "Compressed Loader Execution",
    "Certutil Decode Execution",
}


# ==================== 恶意脚本检测模式 ====================

MALICIOUS_PATTERNS = {
    # 反向 Shell
    "Reverse Shell": re.compile(
        r'(?:nc\s+-e\s+/dev/(?:tcp|udp)/[^;]+\s*\d+|bash\s+-i\s*>&\d+|nc\s+-lvpe\s+/dev/(?:tcp|udp)/[^;]+\s*\d+)',
        re.IGNORECASE,
    ),
    
    # 数据外泄
    "Data Exfiltration": re.compile(
        r'(?:curl|wget|requests\.(?:get|post|put))\s*\([^)]*(?:https?://(?:pastebin\.com|ngrok\.io|[^.]+\.txt\.com|[^.]+\.io/[^/]+))',
        re.IGNORECASE,
    ),
    
    # 敏感文件读取
    "Sensitive File Access": re.compile(
        r'(?:open|read|cat)\s*\([^)]*(?:/etc/passwd|\.ssh/|\.gnupg/|\.aws/)',
        re.IGNORECASE,
    ),
    
    # 权限提升
    "Privilege Escalation": re.compile(
        r'(?:chmod\s+[u\+]*777|sudo\s+chown|sudo\s+chmod)',
        re.IGNORECASE,
    ),
    
    # 代码执行
    "Code Execution": re.compile(
        r'(?:eval\s*\(|exec\s*\(|__import__\s*\(|subprocess\.(?:call|run|Popen))',
        re.IGNORECASE,
    ),
    
    # Base64 混淆
    "Base64 Obfuscation": re.compile(
        r'base64\.b64decode\s*\([^)]{20,}',
        re.IGNORECASE,
    ),

    # 编码后执行 / Loader 链
    "PowerShell Encoded Command": re.compile(
        r'(?:powershell|pwsh)(?:\.exe)?\s+[^\r\n;]*-(?:enc|encodedcommand)\s+(?:[A-Za-z0-9+/=]{20,}|\$[A-Za-z_][\w]*)',
        re.IGNORECASE,
    ),
    "Base64 Loader Execution": re.compile(
        r'(?:base64\.(?:b64decode|urlsafe_b64decode)|frombase64string|atob|buffer\.from\s*\([^)]*base64[^)]*\)).{0,120}(?:eval|exec|compile|invoke-expression|iex|os\.system|subprocess|function)',
        re.IGNORECASE | re.DOTALL,
    ),
    "Compressed Loader Execution": re.compile(
        r'(?:zlib|gzip|bz2|lzma|marshal|pickle)\.(?:decompress|loads)\s*\([^)]*\).{0,120}(?:eval|exec|compile|invoke-expression|iex|os\.system|subprocess)',
        re.IGNORECASE | re.DOTALL,
    ),
    "JavaScript CharCode Execution": re.compile(
        r'(?:string\.fromcharcode|fromcharcode)\s*\([^)]{10,}\).{0,120}(?:eval|function|settimeout|setinterval)',
        re.IGNORECASE | re.DOTALL,
    ),
    "Certutil Decode Execution": re.compile(
        r'certutil(?:\.exe)?\s+-decode\s+\S+\s+\S+.{0,120}(?:powershell|pwsh|cmd|wscript|cscript|mshta|rundll32|regsvr32|iex|invoke-expression)',
        re.IGNORECASE | re.DOTALL,
    ),
    
    # 外部代码下载执行
    "Remote Code Execution": re.compile(
        r'(?:curl|wget)\s+[^|]*\|\s*(?:bash|sh|python)',
        re.IGNORECASE,
    ),
    
    # 系统信息收集
    "System Reconnaissance": re.compile(
        r'(?:uname\s+-a|whoami|hostname|ifconfig|ip\s+addr)',
        re.IGNORECASE,
    ),
    
    # 环境变量窃取
    "Environment Theft": re.compile(
        r'(?:os\.environ|process\.env|getenv)',
        re.IGNORECASE,
    ),
    
    # 密码/密钥文件搜索
    "Credential Search": re.compile(
        r'(?:password|secret|key|token|credential)\s*(?:file|search|find)',
        re.IGNORECASE,
    ),
}

# 可疑URL模式
SUSPICIOUS_URL_PATTERNS = [
    r'pastebin\.com',
    r'ngrok\.io',
    r'serveo\.net',
    r'localtunnel\.me',
    r'raw\.githubusercontent\.com/(?!Panniantong/agent-reach)',  # 排除agent-reach
    r'\.txt\.com',
    r'webhook\.site',
]

# 可疑模块
SUSPICIOUS_MODULES = [
    'pty',
    'ptyprocess',
    'paramiko',
    'fabric',
    'ansible',
    'pexpect',
    'cryptography',
]


def shannon_entropy(s: str) -> float:
    """计算字符串的 Shannon 熵"""
    if not s:
        return 0.0
    freq = {}
    for c in s:
        freq[c] = freq.get(c, 0) + 1
    length = len(s)
    return -sum((count / length) * math.log2(count / length) for count in freq.values())


def is_code_obfuscated(content: str) -> bool:
    """检测代码是否被混淆"""
    try:
        # 检查常见的混淆特征
        obfuscation_patterns = [
            r'\\x[0-9a-fA-F]{20,}',  # 十六进制字符串
            r'\\u[0-9a-fA-F]{16,}',  # Unicode 转义串
            r'var\s+[a-z]{1,2}\s*=',  # 单字母变量名
            r'\$[a-z]{1,2}\s*=',  # 单字母变量名
            r'eval\s*\(',  # eval函数
            r'(?:String\.fromCharCode|fromCharCode)\s*\(',  # JS charcode
            r'(?:FromBase64String|base64\.(?:b64decode|urlsafe_b64decode)|atob\s*\(|Buffer\.from\s*\([^)]*base64[^)]*\))',  # Base64 loader
            r'(?:powershell|pwsh)(?:\.exe)?\s+[^\r\n;]*-(?:enc|encodedcommand)\b',  # PowerShell 编码命令
            r'(?:zlib|gzip|bz2|lzma|marshal|pickle)\.(?:decompress|loads)\s*\(',  # 压缩/序列化 loader
            r'(?:chr\s*\(\s*\d+\s*\)\s*\+?){4,}',  # chr 拼接
        ]
        
        for pattern in obfuscation_patterns:
            if re.search(pattern, content):
                return True
        
        # 检查代码行长度和可读性
        lines = content.split('\n')
        long_lines = [line for line in lines if len(line) > 200]
        if len(long_lines) > len(lines) * 0.3:  # 超过30%的行长度超过200字符
            return True
        
        # 检查非ASCII字符比例
        non_ascii = sum(1 for c in content if ord(c) > 127)
        if non_ascii > len(content) * 0.1:  # 超过10%非ASCII字符
            return True
        
        return False
    except Exception:
        return False


def scan_script_file(script_file: Path) -> List[Dict[str, Any]]:
    """扫描单个脚本文件，返回检测结果"""
    findings = []
    
    try:
        with open(script_file, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        # 1. 检测恶意模式
        malicious_findings = []
        for pattern_name, pattern in MALICIOUS_PATTERNS.items():
            matches = pattern.findall(content)
            if matches:
                malicious_findings.append({
                    'pattern': pattern_name,
                    'count': len(matches),
                    'severity': 'critical' if pattern_name in CRITICAL_PATTERN_NAMES else 'high'
                })
        
        if malicious_findings:
            # 构建描述信息
            desc_parts = [f"{m['pattern']}({m['count']}次)" for m in malicious_findings[:3]]
            desc_str = ', '.join(desc_parts)
            
            findings.append({
                'type': 'malicious_pattern',
                'file': str(script_file),
                'severity': 'critical' if len(malicious_findings) >= 3 else 'high',
                'description': f"检测到恶意行为模式: {desc_str}",
                'details': malicious_findings
            })
        
        # 2. 检查可疑URL
        suspicious_urls = []
        for url_pattern in SUSPICIOUS_URL_PATTERNS:
            if re.search(url_pattern, content, re.IGNORECASE):
                suspicious_urls.append(url_pattern)
        
        if suspicious_urls:
            findings.append({
                'type': 'suspicious_url',
                'file': str(script_file),
                'severity': 'medium',
                'description': f"检测到可疑URL: {', '.join(suspicious_urls[:3])}",
                'details': suspicious_urls
            })
        
        # 3. 检查可疑模块导入
        suspicious_imports = []
        for module in SUSPICIOUS_MODULES:
            if re.search(rf'(?:import|from)\s+{module}', content, re.IGNORECASE):
                suspicious_imports.append(module)
        
        if suspicious_imports:
            findings.append({
                'type': 'suspicious_import',
                'file': str(script_file),
                'severity': 'medium',
                'description': f"检测到可疑模块: {', '.join(suspicious_imports[:3])}",
                'details': suspicious_imports
            })
        
        # 4. 高熵字符串检测
        high_entropy_strings = []
        for match in re.finditer(r'''['"]([a-zA-Z0-9/+=_\-]{20,})['"]''', content):
            token = match.group(1)
            entropy = shannon_entropy(token)
            if entropy > 4.5:
                high_entropy_strings.append({
                    'token': token[:16] + '...',
                    'entropy': round(entropy, 2),
                    'position': match.start
                })
        
        if high_entropy_strings:
            findings.append({
                'type': 'high_entropy',
                'file': str(script_file),
                'severity': 'medium',
                'description': f"检测到高熵字符串 (可能的密钥): {high_entropy_strings[0]['token']} (entropy={high_entropy_strings[0]['entropy']})",
                'details': high_entropy_strings
            })
        
        # 5. 代码混淆检测
        if is_code_obfuscated(content):
            findings.append({
                'type': 'obfuscation',
                'file': str(script_file),
                'severity': 'medium',
                'description': "检测到可能的代码混淆，代码可读性较低",
                'details': None
            })
        
    except Exception as e:
        findings.append({
            'type': 'error',
            'file': str(script_file),
            'severity': 'low',
            'description': f"扫描失败: {str(e)}",
            'details': None
        })
    
    return findings


def scan_skill_markdown_file(skill_file: Path) -> List[Dict[str, Any]]:
    """SKILL.md 是文档层，不按可执行脚本模式做恶意代码扫描。"""
    findings = []

    try:
        with open(skill_file, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()

        suspicious_urls = []
        for url_pattern in SUSPICIOUS_URL_PATTERNS:
            if re.search(url_pattern, content, re.IGNORECASE):
                suspicious_urls.append(url_pattern)

        if suspicious_urls:
            findings.append({
                'type': 'suspicious_url',
                'file': str(skill_file),
                'severity': 'medium',
                'description': f"检测到可疑URL: {', '.join(suspicious_urls[:3])}",
                'details': suspicious_urls
            })
    except Exception as e:
        findings.append({
            'type': 'error',
            'file': str(skill_file),
            'severity': 'low',
            'description': f"扫描失败: {str(e)}",
            'details': None
        })

    return findings


def scan_skills_directory(skills_dir: Path) -> Dict[str, Any]:
    """扫描整个skills目录"""
    results = {
        'scanned_files': 0,
        'findings_count': 0,
        'critical_count': 0,
        'high_count': 0,
        'medium_count': 0,
        'findings': []
    }
    
    if not skills_dir.exists():
        return results
    
    # 扫描所有skill目录
    for skill_dir in skills_dir.iterdir():
        if not skill_dir.is_dir():
            continue
        
        # 扫描scripts目录
        scripts_dir = skill_dir / "scripts"
        if scripts_dir.exists() and scripts_dir.is_dir():
            for script_file in scripts_dir.glob("**/*"):
                if script_file.is_file() and not script_file.name.startswith('.'):
                    # 只扫描文本文件
                    if script_file.suffix in ['.py', '.sh', '.js', '.ts', '.rb', '.pl', '.php', '.bash', '.zsh']:
                        results['scanned_files'] += 1
                        findings = scan_script_file(script_file)
                        
                        if findings:
                            results['findings'].extend(findings)
                            results['findings_count'] += len(findings)
                            
                            for finding in findings:
                                if finding['severity'] == 'critical':
                                    results['critical_count'] += 1
                                elif finding['severity'] == 'high':
                                    results['high_count'] += 1
                                elif finding['severity'] == 'medium':
                                    results['medium_count'] += 1
        
        # 扫描SKILL.md文件
        skill_file = skill_dir / "SKILL.md"
        if skill_file.exists():
            results['scanned_files'] += 1
            # SKILL.md通常不会包含恶意代码，但也可以扫描
            findings = scan_skill_markdown_file(skill_file)
            if findings:
                # 过滤掉不太严重的发现
                serious_findings = [f for f in findings if f['type'] in ['malicious_pattern', 'suspicious_url']]
                if serious_findings:
                    results['findings'].extend(serious_findings)
                    results['findings_count'] += len(serious_findings)
                    
                    for finding in serious_findings:
                        if finding['severity'] == 'critical':
                            results['critical_count'] += 1
                        elif finding['severity'] == 'high':
                            results['high_count'] += 1
                        elif finding['severity'] == 'medium':
                            results['medium_count'] += 1
    
    return results


def generate_report(scan_results: Dict[str, Any]) -> str:
    """生成扫描报告"""
    report = []
    report.append("=" * 60)
    report.append("恶意脚本扫描报告")
    report.append("=" * 60)
    report.append("")
    report.append(f"扫描文件数: {scan_results['scanned_files']}")
    report.append(f"发现问题数: {scan_results['findings_count']}")
    report.append(f"  - 严重: {scan_results['critical_count']}")
    report.append(f"  - 高危: {scan_results['high_count']}")
    report.append(f"  - 中危: {scan_results['medium_count']}")
    report.append("")
    
    if scan_results['findings']:
        report.append("=" * 60)
        report.append("详细发现:")
        report.append("=" * 60)
        
        for finding in scan_results['findings']:
            report.append("")
            report.append(f"[{finding['severity'].upper()}] {finding['type'].upper()}")
            report.append(f"文件: {finding['file']}")
            report.append(f"描述: {finding['description']}")
            if finding.get('details'):
                report.append(f"详情: {finding['details']}")
    
    return "\n".join(report)


if __name__ == "__main__":
    import sys
    
    skills_dir = Path.home() / ".openclaw" / "workspace" / "skills"
    
    print("🔍 开始扫描skills目录...")
    print(f"目录: {skills_dir}")
    print()
    
    results = scan_skills_directory(skills_dir)
    report = generate_report(results)
    
    print(report)
    
    if results['findings_count'] > 0:
        sys.exit(1)  # 有问题则返回非零退出码
    else:
        sys.exit(0)
