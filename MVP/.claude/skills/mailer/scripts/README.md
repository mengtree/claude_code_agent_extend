# Mailer Skill - 快速开始

## 安装步骤

### 1. 创建配置文件

复制配置示例并编辑：

```bash
cd .claude/skills/mailer/scripts
cp config.example.py config.py
```

### 2. 编辑配置文件

打开 `config.py`，填写您的邮箱配置：

```python
# SMTP 服务器配置
SMTP_HOST = "smtp.qq.com"        # 改为您的SMTP服务器
SMTP_PORT = 587                   # 改为您的端口
SMTP_USE_TLS = True               # 是否使用TLS

# 发件人账户
EMAIL_FROM = "your@qq.com"        # 您的邮箱
EMAIL_PASSWORD = "授权码"          # 邮箱授权码（不是登录密码）
```

### 3. 测试配置

```bash
python main.py test
```

如果看到 "✅ 配置验证通过"，说明配置正确。

## 使用示例

### 发送纯文本邮件

```bash
python main.py send \
  --to "recipient@example.com" \
  --subject "测试邮件" \
  --body "这是一封测试邮件"
```

### 发送HTML邮件

```bash
python main.py send \
  --to "recipient@example.com" \
  --subject "HTML测试" \
  --html "<h1>标题</h1><p>内容</p>"
```

### 发送带附件的邮件

```bash
python main.py send \
  --to "recipient@example.com" \
  --subject "带附件的邮件" \
  --body "请查收附件" \
  --attach "/path/to/file.pdf"
```

### 使用默认配置快速发送

在 `config.py` 中设置好默认收件人和主题后：

```bash
python main.py send --body "快速发送的内容"
```

## 常见问题

### Q: 提示 "SMTP认证失败"
A: 请检查：
1. 邮箱地址是否正确
2. 使用的是"授权码"而非登录密码
3. SMTP服务是否已开启

### Q: QQ邮箱如何获取授权码？
A:
1. 登录QQ邮箱网页版
2. 设置 -> 账户
3. 开启"POP3/SMTP服务"
4. 生成授权码

### Q: Gmail如何配置？
A:
1. 开启两步验证
2. 生成应用专用密码
3. 使用应用专用密码作为 EMAIL_PASSWORD
