# 代码安全最佳实践

## 通用安全编码原则

### 1. 输入验证
✅ **永远验证用户输入**
```javascript
// ❌ 不好 - 直接使用
const query = req.params.q;
db.execute(`SELECT * FROM users WHERE name = '${query}'`);

// ✅ 好 - 参数化查询
const query = req.params.q;
db.execute('SELECT * FROM users WHERE name = ?', [query]);
```

### 2. 输出编码
✅ **防止 XSS，编码输出**
```javascript
// ❌ 不好
document.innerHTML = userComment;

// ✅ 好
document.textContent = userComment;
// 或
document.innerHTML = escapeHtml(userComment);
```

### 3. 最小权限原则
✅ **只授予必要的权限**
```python
# ❌ 不好 - 全可读
chmod 755 /path/to/file

# ✅ 好 - 最小权限
chmod 640 /path/to/file  # 所有者读写，组只读
```

### 4. 深度防御
✅ **多层安全控制**
```javascript
// 即使一层验证失败，仍有其他保护
if (!validateInput(userInput)) {
  throw new Error('Invalid input');
}
if (!hasPermission(user, resource)) {
  throw new Error('Unauthorized');
}
if (!isValidSession(session)) {
  throw new Error('Invalid session');
}
```

## 静态分析规则

### 危险函数检测

以下函数需要额外审查：

#### JavaScript/Node.js
| 函数 | 风险 | 替代方案 |
|-------|------|----------|
| `eval()` | 代码注入 | 避免使用，用 JSON.parse 或构建 AST |
| `Function()` | 代码注入 | 避免使用 |
| `setTimeout(code)` | 代码注入 | `setTimeout(() => {}, delay)` |
| `child_process.exec()` | 命令注入 | `execFile()` + 参数数组 |
| `fs.writeFileSync()` | 路径遍历 | 验证路径，使用 `path.resolve()` |
| `require(user_input)` | 模块注入 | 白名单验证模块名 |

#### Python
| 函数 | 风险 | 替代方案 |
|-------|------|----------|
| `eval()` | 代码注入 | 避免使用，用 `exec()` 或 `ast.literal_eval()` |
| `exec()` | 命令注入 | 使用 `subprocess.run()` + 参数数组 |
| `os.system()` | 命令注入 | 使用 `subprocess` 模块 |
| `__import__(user_input)` | 模块导入 | 白名单验证 |
| `pickle.loads()` | 不安全反序列化 | 使用 `json` 或 `yaml` |
| `input()` (Python 2) | 未验证输入 | Python 3 中已移除 |

#### Bash/Shell
| 命令 | 风险 | 替代方案 |
|-------|------|----------|
| `eval` | 代码注入 | 完全避免 |
| `$var` (未引号) | 命令注入 | `"$var"` 或 `${var@Q}` |
| `source $file` | 命令注入 | 验证文件路径 |

### 不安全模式检测

#### 1. 硬编码密钥
```javascript
// ❌ 检测到
const apiKey = "sk-proj-abc123...";

// ✅ 推荐
const apiKey = process.env.API_KEY;
```

#### 2. SQL 注入模式
```javascript
// ❌ 检测到
db.query(`SELECT * FROM users WHERE id = ${userId}`);

// ✅ 推荐
db.query('SELECT * FROM users WHERE id = ?', [userId]);
```

#### 3. 路径遍历模式
```javascript
// ❌ 检测到
const filePath = `./uploads/${req.params.filename}`;
fs.readFile(filePath);

// ✅ 推荐
import path from 'path';
const filePath = path.join('./uploads', req.params.filename);
const safePath = path.normalize(filePath);
if (!safePath.startsWith('./uploads/')) {
  throw new Error('Invalid path');
}
```

#### 4. 不安全的重定向
```javascript
// ❌ 检测到
res.redirect(userInput);

// ✅ 推荐
const allowedDomains = ['example.com', 'trusted.com'];
const url = new URL(userInput);
if (allowedDomains.includes(url.hostname)) {
  res.redirect(userInput);
}
```

## OpenClaw/Skills 特定规则

### 1. 子进程执行检查
```python
# ❌ 不推荐 - 直接执行用户输入
subprocess.run(user_command, shell=True)

# ✅ 推荐 - 使用参数列表
subprocess.run(['ls', '-la', path], shell=False)
```

### 2. 文件操作检查
```python
# ❌ 不推荐 - 未验证路径
with open(user_input, 'r') as f:
    ...

# ✅ 推荐 - 验证和规范化路径
safe_path = Path(user_input).resolve()
if str(safe_path).startswith('/allowed/'):
    with open(safe_path, 'r') as f:
        ...
```

### 3. 网络请求检查
```python
# ❌ 不推荐 - 未验证 URL
urllib.request.open(user_input)

# ✅ 推荐 - 验证 URL
from urllib.parse import urlparse
parsed = urlparse(user_input)
if parsed.netloc in ALLOWED_HOSTS:
    urllib.request.open(user_input)
```

### 4. 技能间数据传递检查
```json
// ❌ 不推荐 - 通过命令行传递敏感信息
{
  "command": "my-tool",
  "args": ["--api-key", "sk-abc123"]
}

// ✅ 推荐 - 使用环境变量
{
  "command": "my-tool",
  "env": {
    "API_KEY": "sk-abc123"
  }
}
```

## 代码审查清单

### 新技能开发时检查

- [ ] 是否验证所有外部输入？
- [ ] 是否使用参数化查询（防 SQLi）？
- [ ] 是否编码所有输出（防 XSS）？
- [ ] 是否避免 `eval()`、`exec()` 等危险函数？
- [ ] 是否使用最小权限原则？
- [ ] 是否记录错误但不泄露敏感信息？
- [ ] 是否使用 HTTPS 而非 HTTP？
- [ ] 是否验证重定向 URL？
- [ ] 是否使用安全的随机数生成？
- [ ] 是否正确处理异常？

### 静态分析工具集成

#### ESLint + Security Plugin (JavaScript)
```bash
# 安装
npm install eslint-plugin-security

# 配置 .eslintrc.json
{
  "plugins": ["security"],
  "rules": {
    "security/detect-eval-with-expression": "error",
    "security/detect-no-csrf-before-method-override": "error",
    "security/detect-object-injection": "error",
    "security/detect-unsafe-regex": "warn"
  }
}
```

#### Semgrep (多语言）
```bash
# 安装
pip install semgrep

# 扫描
semgrep --config=auto ./skills/
```

#### Snyk (依赖 + 代码）
```bash
# 安装
npm install -g snyk

# 扫描
snyk test
```

## 代码质量与安全

### 避免的安全反模式

#### 1. 魔法数字
```python
# ❌ 不好 - 硬编码密钥
if api_key == "12345":
    return True

# ✅ 好 - 使用安全比较
import hmac
return hmac.compare_digest(api_key, expected_key)
```

#### 2. 时间比较
```python
# ❌ 不好 - 可能被绕过
if stored_hash == computed_hash:
    return True

# ✅ 好 - 恒定时间比较
return hmac.compare_digest(stored_hash, computed_hash)
```

#### 3. 随机数生成
```javascript
// ❌ 不好 - 可预测
const randomId = Math.random();

// ✅ 好 - 加密安全
const randomId = crypto.randomBytes(16).toString('hex');
```

### 日志安全

#### ✅ 安全日志
```javascript
// 记录事件，不记录敏感数据
logger.info('User login', {
  userId: user.id,
  username: user.username,
  // ❌ 不要记录
  // password: user.password,
  // token: session.token
});
```

#### ❌ 不安全日志
```javascript
// 避免记录敏感信息
logger.info(`User login: ${username}:${password}:${token}`);
```

## 安全测试

### 单元测试安全场景

```python
# 测试输入验证
def test_sql_injection_protection():
    malicious_input = "'; DROP TABLE users; --"
    response = api.get_user(malicious_input)
    assert response.status_code != 500  # 不应崩溃
    
# 测试权限
def test_unauthorized_access():
    response = client.get('/admin/data')
    assert response.status_code == 401
```

### 模糊测试
```bash
# 使用 API Fuzzer
npm install -g api-fuzzer
api-fuzzer https://api.example.com

# 手动模糊测试
for i in range(1000):
    send_request(fuzzed_data(i))
```

## 持续改进

### 安全培训资源

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [SANS Top 25](https://www.sans.org/top25-software-errors/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security)
- [Python Security Guide](https://python.readthedocs.io/en/latest/security/index.html)

### 定期审计计划

1. **每周**: 运行静态分析工具
2. **每月**: 人工代码审查
3. **每季度**: 依赖漏洞扫描
4. **每年**: 渗透测试（生产）

---
**维护者**: 小小宝 🐾✨
**最后更新**: 2026-03-11
