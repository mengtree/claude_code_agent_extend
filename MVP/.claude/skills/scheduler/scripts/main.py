#!/usr/bin/env python3
"""
Scheduler Skill - 定时任务管理脚本
支持列出任务、查看任务详情、取消任务
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path


def get_session_dir(session_id=None):
    """获取当前会话的任务目录"""
    if session_id is None:
        # 如果没有指定 session_id，使用当前会话ID
        session_id = os.environ.get("CLAUDE_SESSION_ID", "c55e6f94-65cd-4662-afbb-2c914b7631ad")

    base_dir = Path.cwd() / ".agent-extend" / "schedules" / "sessions" / session_id
    if not base_dir.exists():
        return None
    return base_dir


def list_tasks(session_id=None):
    """列出当前会话的所有定时任务"""
    session_dir = get_session_dir(session_id)
    if session_dir is None:
        return []

    tasks = []
    for task_file in session_dir.glob("*.json"):
        try:
            with open(task_file, 'r', encoding='utf-8') as f:
                task_data = json.load(f)
                # 添加文件路径信息
                task_data['_file'] = str(task_file)
                task_data['_filename'] = task_file.name
                tasks.append(task_data)
        except Exception as e:
            print(f"⚠️  读取文件 {task_file.name} 失败: {e}", file=sys.stderr)

    # 按创建时间排序
    tasks.sort(key=lambda x: x.get('createdAt', ''))

    return tasks


def format_task_list(tasks):
    """格式化任务列表输出"""
    if not tasks:
        return "📭 当前没有定时任务"

    output = []
    output.append(f"📋 共有 {len(tasks)} 个定时任务\n")

    for i, task in enumerate(tasks, 1):
        task_id = task.get('id', '')[:8]  # 只显示前8位
        summary = task.get('summary', '无摘要')
        source_type = task.get('sourceType', 'unknown')
        status = task.get('status', 'unknown')
        next_run = task.get('nextRunAt', '未设置')

        # 状态图标
        status_icon = "🟢" if status == "active" else "⏸️"

        # 类型图标
        type_icons = {
            'one_time': '📅',
            'delay': '⏰',
            'cron': '🔄'
        }
        type_icon = type_icons.get(source_type, '📝')

        output.append(f"{i}. {type_icon} {summary}")
        output.append(f"   ID: {task_id} | 状态: {status_icon} {status}")
        output.append(f"   下次执行: {next_run}")
        output.append("")

    return "\n".join(output)


def get_task_detail(task_id, session_id=None):
    """获取任务详情"""
    session_dir = get_session_dir(session_id)
    if session_dir is None:
        return None, "未找到任务目录"

    # 尝试找到匹配的任务文件
    target_file = None
    for task_file in session_dir.glob("*.json"):
        if task_id in task_file.stem:  # 检查文件名是否包含 task_id
            target_file = task_file
            break

    if target_file is None:
        # 如果文件名没找到，尝试读取内容匹配
        for task_file in session_dir.glob("*.json"):
            try:
                with open(task_file, 'r', encoding='utf-8') as f:
                    task_data = json.load(f)
                    if task_data.get('id', '').startswith(task_id):
                        target_file = task_file
                        break
            except Exception:
                continue

    if target_file is None:
        return None, f"未找到任务ID: {task_id}"

    try:
        with open(target_file, 'r', encoding='utf-8') as f:
            task_data = json.load(f)
        task_data['_file'] = str(target_file)
        task_data['_filename'] = target_file.name
        return task_data, None
    except Exception as e:
        return None, f"读取任务文件失败: {e}"


def format_task_detail(task):
    """格式化任务详情输出"""
    output = []
    output.append("📋 任务详情")
    output.append("=" * 50)

    # 基本信息
    output.append(f"任务ID: {task.get('id', '')}")
    output.append(f"摘要: {task.get('summary', '无')}")
    output.append(f"状态: {task.get('status', 'unknown')}")
    output.append(f"任务类型: {task.get('sourceType', 'unknown')}")

    # 时间信息
    output.append(f"\n⏰ 时间信息:")
    output.append(f"创建时间: {task.get('createdAt', '未设置')}")
    output.append(f"更新时间: {task.get('updatedAt', '未设置')}")
    output.append(f"下次执行: {task.get('nextRunAt', '未设置')}")
    if 'runAt' in task:
        output.append(f"执行时间: {task.get('runAt', '未设置')}")

    # 周期任务特殊信息
    if 'cronExpression' in task:
        output.append(f"\n🔄 周期设置:")
        output.append(f"Cron表达式: {task.get('cronExpression', '')}")
        output.append(f"时区: {task.get('timezone', '系统默认')}")

    # 执行配置
    output.append(f"\n⚙️ 执行配置:")
    output.append(f"交付模式: {task.get('deliveryMode', 'unknown')}")

    # 任务内容
    output.append(f"\n📝 任务内容:")
    output.append(task.get('content', '无内容'))

    # 文件信息
    output.append(f"\n📁 文件信息:")
    output.append(f"文件名: {task.get('_filename', '未知')}")
    output.append(f"文件路径: {task.get('_file', '未知')}")

    output.append("=" * 50)

    return "\n".join(output)


def cancel_task(task_id, session_id=None):
    """取消任务"""
    task_data, error = get_task_detail(task_id, session_id)
    if error:
        return False, error

    task_file = Path(task_data['_file'])

    try:
        # 删除文件
        task_file.unlink()
        return True, f"✅ 任务已取消: {task_data.get('summary', '未知任务')}"
    except Exception as e:
        return False, f"❌ 取消任务失败: {e}"


def cmd_list(args):
    """列出所有任务"""
    tasks = list_tasks(args.session)
    print(format_task_list(tasks))
    return 0


def cmd_get(args):
    """获取任务详情"""
    task_data, error = get_task_detail(args.id, args.session)
    if error:
        print(f"❌ {error}")
        return 1

    print(format_task_detail(task_data))
    return 0


def cmd_cancel(args):
    """取消任务"""
    success, message = cancel_task(args.id, args.session)
    print(message)
    return 0 if success else 1


def main():
    parser = argparse.ArgumentParser(
        description='Scheduler Skill - 定时任务管理',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 列出所有任务
  python main.py list

  # 查看任务详情
  python main.py get --id 832ad502

  # 取消任务
  python main.py cancel --id 832ad502
        """
    )

    parser.add_argument('--session', '-s', help='会话ID（默认使用当前会话）')

    subparsers = parser.add_subparsers(dest='command', help='可用命令')

    # list 命令
    list_parser = subparsers.add_parser('list', help='列出所有定时任务')
    list_parser.set_defaults(func=cmd_list)

    # get 命令
    get_parser = subparsers.add_parser('get', help='查看任务详情')
    get_parser.add_argument('--id', required=True, help='任务ID（前几位即可）')
    get_parser.set_defaults(func=cmd_get)

    # cancel 命令
    cancel_parser = subparsers.add_parser('cancel', help='取消定时任务')
    cancel_parser.add_argument('--id', required=True, help='任务ID（前几位即可）')
    cancel_parser.set_defaults(func=cmd_cancel)

    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        return 1

    return args.func(args)


if __name__ == '__main__':
    sys.exit(main())
