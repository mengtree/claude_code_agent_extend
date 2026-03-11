# ============================================================================
# 邮件发送配置示例
# ============================================================================
# 请将此文件复制为 config.py 并填写您的实际配置信息
# 注意：config.py 已被 .gitignore 忽略，不会被提交到版本控制
# ============================================================================

# ==================== SMTP 服务器配置 ====================
SMTP_HOST = "smtp.163.com"     # SMTP 服务器地址
SMTP_PORT = 994                     # SMTP 端口 (587 for TLS, 465 for SSL)
SMTP_USE_TLS = False                 # 是否使用 TLS 加密

# ==================== 发件人账户配置 ====================
EMAIL_FROM = "timemotion@163.com"  # 发件人邮箱地址
EMAIL_PASSWORD = "EXRvmWpjWeRuMbJk"  # 邮箱密码或授权码

# ==================== 默认配置（可选） ====================
DEFAULT_TO = ""                     # 默认收件人邮箱
DEFAULT_SUBJECT = ""                # 默认邮件主题
DEFAULT_FROM_NAME = "skills create test"              # 默认发件人显示名称

# ==================== 发送配置 ====================
EMAIL_TIMEOUT = 30                  # 连接超时时间（秒）
MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024  # 最大附件大小（25MB，单位：字节）

# ==================== 常见邮箱配置参考 ====================
"""
QQ邮箱:
    SMTP_HOST = "smtp.qq.com"
    SMTP_PORT = 587  # 或 465
    SMTP_USE_TLS = True
    # 注意：需要在QQ邮箱设置中开启SMTP服务并获取授权码

Gmail:
    SMTP_HOST = "smtp.gmail.com"
    SMTP_PORT = 587
    SMTP_USE_TLS = True
    # 注意：需要在Google账户中开启两步验证并生成应用专用密码

163邮箱:
    SMTP_HOST = "smtp.163.com"
    SMTP_PORT = 465
    SMTP_USE_TLS = True
    # 注意：需要在邮箱设置中开启SMTP服务并获取授权码

126邮箱:
    SMTP_HOST = "smtp.126.com"
    SMTP_PORT = 465
    SMTP_USE_TLS = True

企业邮箱（以腾讯企业邮为例）:
    SMTP_HOST = "smtp.exmail.qq.com"
    SMTP_PORT = 465
    SMTP_USE_TLS = True
"""
