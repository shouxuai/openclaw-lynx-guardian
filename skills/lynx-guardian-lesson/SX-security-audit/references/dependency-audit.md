# 依赖漏洞扫描

## NPM 依赖安全

### 检查命令

#### 基础审计
```bash
npm audit
```

#### JSON 输出（推荐）
```bash
npm audit --json
```

#### 自动修复（谨慎使用）
```bash
npm audit fix
```

#### 强制修复（可能破坏兼容性）
```bash
npm audit fix --force
```

### 审计结果解读

| 严重程度 | 描述 | 处理建议 |
|-----------|-------|-----------|
| Critical | 严重安全漏洞，可能导致 RCE | 立即修复 |
| High | 高危漏洞，可能导致数据泄露 | 24小时内修复 |
| Moderate | 中危漏洞，需关注 | 下个版本修复 |
| Low | 低危漏洞，信息泄露风险 | 计划修复 |
| Info | 信息性提示 | 评估后决定 |

### 常见 NPM 漏洞类型

#### 1. 原型污染污染 (Prototype Pollution)
- **风险**: 可绕过安全检查，执行任意代码
- **影响**: 特别是在对象合并操作中
- **修复**: 使用安全的合并库，更新到最新版本

#### 2. 正则表达式拒绝服务 (ReDoS)
- **风险**: 恶意正则表达式导致应用挂起
- **影响**: 服务不可用
- **修复**: 限制正则执行时间，使用验证库

#### 3. 路径遍历 (Path Traversal)
- **风险**: 访问预期之外的文件
- **影响**: 信息泄露、代码执行
- **修复**: 验证和规范化文件路径

#### 4. 依赖混淆 (Dependency Confusion)
- **风险**: 安装恶意包而非官方包
- **影响**: 供应链攻击
- **修复**: 使用 npm publish 2FA，锁定包范围

## Python 依赖安全

### 检查工具

#### 1. Safety
```bash
# 安装
pip install safety

# 扫描 requirements.txt
safety check -r requirements.txt

# 扫描漏到的虚拟环境
safety check

# JSON 输出
safety check --json > safety-report.json
```

#### 2. pip-audit
```bash
# 安装
pip install pip-audit

# 扫描
pip-audit

# 检查本地虚拟环境
pip-audit -v venv/
```

#### 3. Bandit - 静态分析
```bash
# 安装
pip install bandit

# 扫描 Python 代码
bandit -r ./myproject

# 生成报告
bandit -r ./myproject -f json -o report.json
```

### 依赖锁定

#### 使用 requirements.txt
```
Django==3.2.18  # 锁定具体版本
requests==2.27.1
numpy cryptography>=3.3,<4.0  # 范围约束
```

#### 使用 pip-tools
```bash
# 生成
pip-compile requirements.in --output-file requirements.txt

# 更新
pip-compile requirements.in --upgrade

# 检查不一致
pip-sync requirements.txt
```

#### 使用 poetry（现代推荐）
```bash
# 锁定依赖
poetry lock

# 安装精确版本
poetry install

# 更新
poetry update package-name
```

## 供应链安全最佳实践

### ✅ 推荐实践

1. **使用锁定文件**
   - `package-lock.json` (NPM)
   - `requirements.txt` (Python)
   - `poetry.lock` (Poetry)

2. **启用双因子认证 (2FA)**
   ```bash
   npm profile enable-2fa
   ```

3. **定期更新依赖**
   ```bash
   # 每周检查更新
   npm outdated
   pip list --outdated
   ```

4. **审查新依赖**
   - 检查包维护者
   - 查看包历史记录
   - 检查下载量（太少可能可疑）

5. **使用私有注册表**
   ```bash
   # 配置企业私有 NPM
   npm config set registry https://npm.example.com
   ```

### ❌ 避免风险

1. ❌ 忽略 `npm audit` 警告
2. ❌ 使用 `npm install` 而非 `npm ci` (生产)
3. ❌ 提交 `node_modules` 到版本控制
4. ❌ 在 CI 中使用 `npm install`@latest
5. ❌ 从不可信源安装包

## CI/CD 集成

### GitHub Actions 示例
```yaml
name: Security Audit

on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run npm audit
        run: npm audit --audit-level=moderate
      - name: Fail on high/critical
        run: |
          if npm audit --json | jq '.metadata.vulnerabilities | .high + .critical' > 0; then
            echo "发现高危漏洞！"
            exit 1
          fi
```

### GitLab CI 示例
```yaml
security_audit:
  stage: security
  script:
    - npm audit --audit-level=high
    - pip install safety && safety check
  allow_failure: false
```

## 漏洞数据库参考

- **NPM Advisory Database**: https://github.com/npm/advisories
- **PyPI Security**: https://pypi.org/security
- **CVE Database**: https://cve.mitre.org/
- **OWASP Top 10**: https://owasp.org/www-project-top-ten/

## 自动修复策略

### 保守策略（推荐）
1. 获取审计报告
2. 人工审查修复方案
3. 测试每个修复
4. 逐步应用修复
5. 回归测试

### 激进策略（谨慎）
```bash
# 自动修复所有中危以上漏洞
npm audit fix --audit-level=moderate --force
```

### 回滚计划
```bash
# 修复前提交
git commit -am "Before audit fix"

# 应用修复
npm audit fix

# 测试失败时回滚
npm audit fix --force
git checkout HEAD~1 -- node_modules
```

## 监控和告警

### 设置自动扫描
```bash
# Cron 任务 - 每天审计
0 0 * * * npm audit --json > /var/log/npm-audit.log

# 检查告警
if grep -q '"high":1\|"critical":1' /var/log/npm-audit.log; then
  send_alert "发现高危漏洞"
fi
```
