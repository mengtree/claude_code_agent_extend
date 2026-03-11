---
name: mailer
description: 当用户需要发送邮件时使用；支持发送纯文本邮件、HTML邮件，支持附件。
---

# Mailer Skill

## 适用场景

当用户提到以下需求时使用本 Skill：
- 发送邮件通知
- 发送带附件的邮件
- 发送HTML格式邮件
- 批量发送邮件

## 前置条件

1. 已安装依赖：无（使用Python标准库 smtplib/email）
2. 首次使用需要配置邮件服务器信息

## 配置说明

首次使用前，请在脚本中配置以下参数：

```python
# SMTP 服务器配置
SMTP_HOST = "smtp.example.com"     # SMTP 服务器地址
SMTP_PORT = 587                     # SMTP 端口（587 for TLS, 465 for SSL）
SMTP_USE_TLS = True                 # 是否使用 TLS

# 发件人账户配置
EMAIL_FROM = "your_email@example.com"  # 发件人邮箱
EMAIL_PASSWORD = "your_password"       # 邮箱密码或授权码

# 默认配置（可选）
DEFAULT_TO = ""                     # 默认收件人
DEFAULT_SUBJECT = ""                # 默认主题
```

### 常见邮箱配置参考

**QQ邮箱**
- SMTP: smtp.qq.com
- 端口: 587 (TLS) 或 465 (SSL)
- 需要使用"授权码"而非登录密码

**Gmail**
- SMTP: smtp.gmail.com
- 端口: 587 (TLS)
- 需要开启"应用专用密码"

**163邮箱**
- SMTP: smtp.163.com
- 端口: 465 (SSL)
- 需要使用"授权码"

**企业邮箱**
- 请咨询您的邮件服务提供商

## 执行流程

1. 检查配置文件，如未配置则提示用户填写配置
2. 验证配置是否正确
3. 构建邮件内容
4. 发送邮件
5. 返回发送结果

## 命令说明

### 发送纯文本邮件
```bash
python main.py send --to "recipient@example.com" --subject "主题" --body "邮件内容"
```

### 发送HTML邮件
```bash
python main.py send --to "recipient@example.com" --subject "主题" --html "<h1>HTML内容</h1>"
```

### 发送带附件的邮件
```bash
python main.py send --to "recipient@example.com" --subject "主题" --body "内容" --attach "/path/to/file.pdf"
```

### 使用默认配置发送
```bash
python main.py send --body "快速发送内容"
```

## 参数说明

| 参数 | 说明 | 必填 |
|------|------|------|
| `--to` | 收件人邮箱地址 | 否 |
| `--subject` | 邮件主题 | 否 |
| `--body` | 纯文本正文 | 否 |
| `--html` | HTML正文 | 否 |
| `--attach` | 附件文件路径 | 否 |

注：`--body` 和 `--html` 二选一，都提供时优先使用 `--html`

## 安全与边界

- 配置文件包含敏感信息，请勿提交到版本控制系统
- 建议使用环境变量或独立的配置文件存储邮箱密码
- 不要在代码中硬编码密码
- 发送失败时返回详细错误信息供排查
