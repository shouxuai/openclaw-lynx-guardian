---
name: SX-security-audit
description: 全方位安全审计技能。检查文件权限、环境变量、依赖漏洞、配置文件、网络端口、Git 安全、Shell 安全、macOS 安全、密钥检测等。支持 CLI 参数、JSON 输出、配置文件。当用户要求"安全检查"、"漏洞扫描"、"权限检查"、"安全审计"时使用此技能。
---

# Security Audit - 全方位安全审计技能

本技能提供全面的安全检查功能，涵盖系统、代码、配置等多个层面，并支持生成报告发送到飞书。

## 检查范围

本技能支持以下安全检查模块（可通过 `--check` 选择）：

### 🔒 permissions - 权限与访问控制
- **敏感文件权限** - 检查 .ssh、.aws、.gnupg、OpenClaw 目录权限
- 使用位掩码 `actual_mode & ~expected_mode` 精确检测超出预期的权限位

### 🔓 world_writable - 世界可写文件检测
- 在 workspace 目录下扫描 o+w 权限的文件
- 检测 SUID/SGID 位设置的文件

### 🔐 config - OpenClaw 配置安全
- 使用正则模式检测配置文件中的真实密钥（AWS、GitHub、Slack、OpenAI 等）
- 检查 Gateway 认证方式
- 检查插件安装状态

### 📝 skills - Skills 代码安全
- 用正则模式匹配检测硬编码密钥
- 检查不安全的函数调用（eval、exec、os.system 等）
- 高熵字符串检测（Shannon entropy > 4.5）

### 📦 dependencies - 依赖与供应链安全
- 运行 `npm audit --json` 检查 NPM 依赖漏洞
- 正确处理 npm audit 非零返回码（有漏洞时返回非零）
- 按漏洞严重级别统计

### 🌍 env - 环境变量安全
- 扫描当前进程环境变量中的敏感信息
- 检测已知 API key 格式（sk-、ghp_、xoxb-、AKIA 等）
- 检测环境变量名称中的敏感关键词

### 🔀 git - Git 安全检查
- 检查 .gitignore 是否忽略了 .env、.secret、credentials 等
- 检查 git credential.helper 是否使用明文存储
- 扫描最近 commit diff 中的密钥模式

### 🌐 network - 网络端口扫描
- 使用 `lsof -i -P -n` 检查监听端口
- 标记监听 0.0.0.0（全接口暴露）的进程
- 列出所有监听端口清单

### 🐚 shell - Shell 安全检查
- 检查 .bash_history / .zsh_history 文件权限
- 扫描 .bashrc / .zshrc 中的明文 export 密钥

### 🍎 macos - macOS 安全检查（仅 macOS）
- 检查防火墙状态（socketfilterfw）
- 检查 Gatekeeper 状态（spctl）
- 检查 SIP 系统完整性保护状态（csrutil）

## 增强密钥检测

使用正则模式精确匹配已知密钥格式：

| 类型 | 模式 |
|------|------|
| AWS Access Key | `AKIA[0-9A-Z]{16}` |
| GitHub Token | `ghp_[a-zA-Z0-9]{36}` / `github_pat_` |
| Slack Token | `xox[bpas]-` |
| OpenAI/Anthropic Key | `sk-[a-zA-Z0-9]{20,}` |
| JWT Token | `eyJ[a-zA-Z0-9_-]+\.eyJ` |
| Private Key | `-----BEGIN PRIVATE KEY-----` |

同时支持 Shannon 信息熵检测（> 4.5 的高熵字符串视为可疑密钥）。

## CLI 使用方式

### 完整审计
```bash
python3 scripts/security_audit.py
```

### 指定检查模块
```bash
python3 scripts/security_audit.py --check permissions env git
```

### 过滤严重级别
```bash
python3 scripts/security_audit.py --severity high
```

### JSON 输出
```bash
python3 scripts/security_audit.py --json
python3 scripts/security_audit.py --json --output report.json
```

### 列出可用模块
```bash
python3 scripts/security_audit.py --list-checks
```

### 静默模式
```bash
python3 scripts/security_audit.py --quiet --json --output report.json
```

## 配置文件支持

创建 `.security-audit.json` 自定义审计行为：

```json
{
  "excludePaths": [
    "/tmp",
    "node_modules"
  ],
  "severityThreshold": "medium",
  "autoFix": false,
  "reportFormat": "markdown"
}
```

配置文件搜索顺序：
1. 当前目录 `.security-audit.json`
2. `~/.openclaw/.security-audit.json`
3. `~/.openclaw/workspace/.security-audit.json`

## 飞书报告

### 发送报告
```bash
# 富文本格式（默认）
python3 scripts/send_report_to_feishu.py report.md

# 卡片格式
python3 scripts/send_report_to_feishu.py report.md --format card

# 指定 Webhook
python3 scripts/send_report_to_feishu.py report.md --webhook https://...
```

### 支持的消息格式
- **text** - 纯文本消息
- **rich** - 飞书富文本（post 类型），包含标题、加粗等样式
- **card** - 交互式卡片，支持颜色标签（红/橙/绿），摘要卡片化展示

### 发送方式优先级
1. OpenClaw 插件 API（如已配置飞书插件）
2. 飞书 Webhook（通过 `--webhook` 或 `FEISHU_WEBHOOK_URL` 环境变量）
3. 保存格式化消息供手动发送

## 报告格式

审计报告包含以下部分：

### 📊 执行摘要
- 审计时间、检查范围
- 通过/警告/失败统计
- 风险等级分布（严重/高/中/低）

### 🔍 详细检查结果
每个检查项包含：状态、风险等级、问题描述、影响范围、修复建议

### 📋 优先修复清单
按风险等级排序的问题列表，附带修复命令

## 参考资料

- [权限检查规则](references/permissions.md)
- [密钥检测规则](references/secrets-detection.md)
- [依赖漏洞扫描](references/dependency-audit.md)
- [代码安全最佳实践](references/code-security.md)

## 注意事项

- 首次运行可能需要安装额外依赖（`npm audit` 等）
- 某些检查需要 sudo/root 权限（如完整端口扫描）
- macOS 安全检查仅在 Darwin 平台执行
- 报告发送到飞书需要飞书插件已配置或提供 Webhook URL

---

**技能维护者**: 小小宝 🐾✨
**最后更新**: 2026-03-12
