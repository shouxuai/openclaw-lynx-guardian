# 权限检查规则

## 文件权限标准

### 敏感文件最小权限
| 文件类型 | 推荐权限 | 命令 | 说明 |
|-----------|-----------|-------|------|
| SSH 私钥 | 600 | `chmod 600 ~/.ssh/id_rsa` | 仅所有者可读写 |
| SSH 目录 | 700 | `chmod 700 ~/.ssh` | 仅所有者可访问 |
| AWS 凭据 | 600 | `chmod 600 ~/.aws/credentials` | 保护 AWS 密钥 |
| GPG 目录 | 700 | `chmod 700 ~/.gnupg` | 保护 GPG 密钥 |
| OpenClaw 配置 | 600/700 | `chmod 700 ~/.openclaw` | 保护配置 |
| 日志文件 | 600/644 | `chmod 600 logs/*.log` | 控制日志访问 |

### 权限检查命令

```bash
# 查看文件权限
ls -la ~/.ssh

# 查找权限过宽松的文件
find ~ -perm -o+rwx -type f 2>/dev/null | head -20

# 修复 SSH 密钥权限
chmod 600 ~/.ssh/id_rsa
chmod 644 ~/.ssh/id_rsa.pub

# 修复 OpenClaw 目录权限
chmod 700 ~/.openclaw
chmod 600 ~/.openclaw/openclaw.json
```

### 常见权限问题

#### 问题 1: SSH 密钥权限过宽
- **症状**: SSH 连接提示 "Permissions 0644 are too open"
- **风险**: 其他用户可读取私钥
- **修复**: `chmod 600 ~/.ssh/id_*`

#### 问题 2: 配置文件全局可读
- **症状**: 敏感信息可能被其他用户访问
- **风险**: 信息泄露
- **修复**: `chmod 600 ~/.config/file.conf`

#### 问题 3: 日志文件权限不当
- **症状**: 日志可能包含敏感信息且可被任意用户读取
- **风险**: 信息泄露
- **修复**: `chmod 640 /var/log/app.log` (所有者读写，组只读)
