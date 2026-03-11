#!/usr/bin/env python3
"""
邮件发送脚本
支持发送纯文本邮件、HTML邮件和带附件的邮件
"""

import argparse
import os
import smtplib
import sys
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

# 尝试导入配置文件
try:
    from config import (
        SMTP_HOST,
        SMTP_PORT,
        SMTP_USE_TLS,
        EMAIL_FROM,
        EMAIL_PASSWORD,
        DEFAULT_TO,
        DEFAULT_SUBJECT,
        DEFAULT_FROM_NAME,
        EMAIL_TIMEOUT,
    )
    CONFIG_LOADED = True
except ImportError:
    CONFIG_LOADED = False
    print("⚠️  警告: 未找到 config.py 配置文件，请先配置邮件服务器信息")
    print("   可以参考 config.example.py 创建配置文件")


def validate_config():
    """验证配置是否完整"""
    if not CONFIG_LOADED:
        return False, "配置文件未加载"

    required_vars = {
        "SMTP_HOST": SMTP_HOST,
        "SMTP_PORT": SMTP_PORT,
        "EMAIL_FROM": EMAIL_FROM,
        "EMAIL_PASSWORD": EMAIL_PASSWORD,
    }

    for var_name, var_value in required_vars.items():
        if not var_value:
            return False, f"{var_name} 未配置"
        # 只对字符串类型检查是否使用默认值
        if isinstance(var_value, str) and var_value.startswith(("your_", "smtp.example")):
            return False, f"{var_name} 使用默认值，请配置实际值"

    # 验证邮箱格式
    if "@" not in EMAIL_FROM:
        return False, "发件人邮箱格式不正确"

    return True, "配置验证通过"


def send_email(to, subject, body=None, html=None, attachments=None):
    """
    发送邮件

    Args:
        to: 收件人邮箱
        subject: 邮件主题
        body: 纯文本正文（可选）
        html: HTML正文（可选）
        attachments: 附件文件路径列表（可选）

    Returns:
        (success: bool, message: str)
    """
    # 验证配置
    config_valid, config_msg = validate_config()
    if not config_valid:
        return False, f"配置验证失败: {config_msg}"

    # 使用默认值
    if not to and DEFAULT_TO:
        to = DEFAULT_TO
    if not subject and DEFAULT_SUBJECT:
        subject = DEFAULT_SUBJECT

    # 必填参数检查
    if not to:
        return False, "收件人邮箱不能为空"
    if not subject:
        return False, "邮件主题不能为空"
    if not body and not html:
        return False, "邮件正文不能为空（请提供 body 或 html）"

    try:
        # 创建邮件对象
        msg = MIMEMultipart()
        msg["From"] = f"{DEFAULT_FROM_NAME} <{EMAIL_FROM}>" if DEFAULT_FROM_NAME else EMAIL_FROM
        msg["To"] = to
        msg["Subject"] = subject

        # 添加正文
        if html:
            msg.attach(MIMEText(html, "html", "utf-8"))
        else:
            msg.attach(MIMEText(body, "plain", "utf-8"))

        # 添加附件
        if attachments:
            for attachment_path in attachments:
                if not os.path.exists(attachment_path):
                    return False, f"附件文件不存在: {attachment_path}"

                filename = os.path.basename(attachment_path)
                with open(attachment_path, "rb") as f:
                    part = MIMEBase("application", "octet-stream")
                    part.set_payload(f.read())

                encoders.encode_base64(part)
                part.add_header(
                    "Content-Disposition",
                    f"attachment; filename= {filename}",
                )
                msg.attach(part)

        # 连接SMTP服务器并发送
        if SMTP_USE_TLS:
            server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=EMAIL_TIMEOUT)
            server.starttls()
        else:
            server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=EMAIL_TIMEOUT)

        server.login(EMAIL_FROM, EMAIL_PASSWORD)
        server.send_message(msg)
        server.quit()

        return True, "邮件发送成功"

    except smtplib.SMTPAuthenticationError:
        return False, "SMTP认证失败，请检查邮箱地址和密码/授权码"
    except smtplib.SMTPException as e:
        return False, f"SMTP错误: {str(e)}"
    except Exception as e:
        return False, f"发送失败: {str(e)}"


def cmd_send(args):
    """发送邮件命令"""
    # 处理附件参数
    attachments = []
    if args.attach:
        for attach_path in args.attach.split(","):
            attach_path = attach_path.strip()
            if attach_path:
                attachments.append(attach_path)

    # 发送邮件
    success, message = send_email(
        to=args.to,
        subject=args.subject,
        body=args.body,
        html=args.html,
        attachments=attachments if attachments else None,
    )

    # 输出结果
    result = {
        "success": success,
        "message": message,
        "to": args.to,
        "subject": args.subject,
    }

    print(f"发送状态: {'✅ 成功' if success else '❌ 失败'}")
    print(f"详细信息: {message}")
    return 0 if success else 1


def cmd_test(args):
    """测试配置命令"""
    config_valid, config_msg = validate_config()

    if config_valid:
        print("✅ 配置验证通过")
        print(f"\n当前配置:")
        print(f"  SMTP服务器: {SMTP_HOST}:{SMTP_PORT}")
        print(f"  使用TLS: {SMTP_USE_TLS}")
        print(f"  发件人: {EMAIL_FROM}")
        if DEFAULT_TO:
            print(f"  默认收件人: {DEFAULT_TO}")
        return 0
    else:
        print(f"❌ 配置验证失败: {config_msg}")
        print("\n请检查 config.py 文件中的配置")
        return 1


def main(argv=None):
    p = argparse.ArgumentParser(description="邮件发送工具")
    sub = p.add_subparsers(dest="cmd", help="可用命令")

    # 发送邮件命令
    sp_send = sub.add_parser("send", help="发送邮件")
    sp_send.add_argument("--to", help="收件人邮箱地址")
    sp_send.add_argument("--subject", help="邮件主题")
    sp_send.add_argument("--body", help="纯文本正文内容")
    sp_send.add_argument("--html", help="HTML正文内容")
    sp_send.add_argument("--attach", help="附件文件路径（多个附件用逗号分隔）")
    sp_send.set_defaults(func=cmd_send)

    # 测试配置命令
    sp_test = sub.add_parser("test", help="测试配置是否正确")
    sp_test.set_defaults(func=cmd_test)

    args = p.parse_args(argv)

    if not args.cmd:
        p.print_help()
        return 1

    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
