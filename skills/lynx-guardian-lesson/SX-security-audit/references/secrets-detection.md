# 密钥检测规则

## 正则模式匹配

安全审计工具使用以下正则表达式检测各类密钥和凭据：

### 平台特定密钥

| 类型 | 正则模式 | 示例 |
|------|---------|------|
| AWS Access Key | `AKIA[0-9A-Z]{16}` | `AKIAIOSFODNN7EXAMPLE` |
| GitHub Token (classic) | `ghp_[a-zA-Z0-9]{36}` | `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| GitHub Token (fine-grained) | `github_pat_[a-zA-Z0-9_]{22,}` | `github_pat_xxxxxxxxx...` |
| Slack Token | `xox[bpas]-[a-zA-Z0-9\-]+` | `xoxb-123-456-abc` |
| OpenAI / Anthropic Key | `sk-[a-zA-Z0-9]{20,}` | `sk-proj-abcdefghij1234567890` |
| JWT Token | `eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+` | `eyJhbGci...eyJzdWIi...` |
| Private Key Block | `-----BEGIN (RSA \|EC )?PRIVATE KEY-----` | PEM 格式私钥 |
| Generic API Key 赋值 | `(api_key\|api_secret\|...) = "..."` | 代码中的硬编码赋值 |

### 高熵字符串检测

对于无法匹配已知模式的密钥，使用 Shannon 信息熵检测：
- 阈值: entropy > 4.5
- 目标: 引号内长度 >= 20 的字母数字字符串
- 原理: 随机生成的密钥通常具有高熵值（> 4.5），而普通文本熵值较低（< 4.0）

```python
import math

def shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    freq = {}
    for c in s:
        freq[c] = freq.get(c, 0) + 1
    length = len(s)
    return -sum((count / length) * math.log2(count / length)
                for count in freq.values())
```

常见熵值参考：
- `"hello world"` → ~2.8
- `"password123"` → ~3.3
- 真实 API key → ~4.5 - 5.8
- UUID → ~3.7

## 敏感关键词列表

以下关键词用于环境变量和配置扫描（不区分大小写）：

### 认证凭据类
- password, passwd, pwd
- secret, secrets
- token, tokens
- key, keys, api_key, api-key, apikey
- auth, authorization
- credential, credentials
- private_key, private-key
- access_token, access-token
- client_secret, client-secret
- session_token, session-key
- refresh_token

### 平台特定
- AWS: aws_access_key, aws_secret_key, aws_session_token
- GitHub: github_token, github_pat
- GitLab: gitlab_token, gitlab_pat
- Slack: slack_token, slack_webhook
- Telegram: telegram_bot_token
- OpenAI: openai_api_key, sk-
- Anthropic: anthropic_api_key
- Feishu: feishu_app_secret, app_secret

## 环境变量检测

扫描当前进程环境变量中的敏感信息模式：

| 模式 | 匹配说明 |
|------|---------|
| `API[_-]?KEY\|API[_-]?SECRET` | API 密钥 |
| `ACCESS[_-]?TOKEN\|AUTH[_-]?TOKEN\|BEARER` | 访问令牌 |
| `PASSWORD\|PASSWD\|PWD` (排除 PATH) | 密码 |
| `SECRET[_-]?KEY\|PRIVATE[_-]?KEY` | 私钥 |
| `DB[_-]?PASSWORD\|DATABASE[_-]?URL` | 数据库凭据 |

## Shell 配置检测

扫描 `.bashrc` / `.zshrc` 等文件中的明文导出：

```
export\s+\w*(KEY|SECRET|TOKEN|PASSWORD|PASSWD)\w*\s*=\s*['"]?[a-zA-Z0-9/+=_\-]{8,}['"]?
```

## Git 历史检测

扫描最近 10 个 commit 的 diff 中是否包含上述密钥模式。

## 误报处理

以下情况应标记为误报：

### 1. 文档说明
- "如何设置 API_KEY 环境变量"
- "请使用 YOUR_SECRET_TOKEN"

### 2. 示例代码
```javascript
// 这是一个示例，请替换为实际密钥
const API_KEY = "your-api-key-here"
```

### 3. 测试数据
```json
{
  "test_password": "test123",
  "mock_token": "mock-token-value"
}
```

## 最佳实践

### ✅ 推荐做法

1. **使用环境变量**
```bash
export API_KEY="your-api-key"
node app.js  # 代码中读取 process.env.API_KEY
```

2. **使用密钥管理服务**
```bash
# 使用 AWS Secrets Manager
aws secretsmanager get-secret-value --secret-id MySecret

# 使用 HashiCorp Vault
vault kv get secret/production/api-key
```

3. **配置文件分离**
```
.gitignore
---------
.env
.env.local
config/secrets.json
```

4. **使用掩码显示**
```json
{
  "apiKey": "__OPENCLAW_REDACTED__",
  "token": "sk-...xxxx"
}
```

### ❌ 避免做法

1. ❌ 硬编码密钥到代码库
2. ❌ 在配置文件中使用明文
3. ❌ 在日志中打印敏感信息
4. ❌ 将密钥提交到版本控制
5. ❌ 在公开代码中注释密钥
6. ❌ 在 .bashrc/.zshrc 中 export 密钥

## 检测后处理

发现敏感信息后的处理流程：

1. **立即标记严重性**
   - 生产环境密钥泄露 🔴 严重
   - 测试/开发密钥 🟡 中等
   - 示例/文档说明 🟢 低

2. **提供修复建议**
   - 移除敏感信息
   - 使用环境变量
   - 提交到 .env.example

3. **检查泄露历史**
   ```bash
   # 检查 Git 历史是否包含密钥
   git log --all --full-history -S "api_key" --source
   ```

4. **轮换凭证**
   - 撤销泄露的密钥
   - 生成新密钥
   - 更新所有使用位置
