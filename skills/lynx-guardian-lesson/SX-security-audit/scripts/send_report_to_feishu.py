#!/usr/bin/env python3
"""
Send Security Audit Report to Feishu
将安全审计报告发送到飞书，支持富文本 (post) 消息格式和 OpenClaw 插件 API。
"""

import sys
import json
import os
from pathlib import Path
import urllib.request
import urllib.error


def print_success(msg: str):
    print(f"✅ {msg}")


def print_error(msg: str):
    print(f"❌ {msg}")


def print_info(msg: str):
    print(f"ℹ️  {msg}")


def load_feishu_config():
    """加载飞书配置"""
    openclaw_dir = Path.home() / ".openclaw"
    config_file = openclaw_dir / "openclaw.json"

    if not config_file.exists():
        print_error("OpenClaw 配置文件不存在")
        return None

    with open(config_file, 'r', encoding='utf-8') as f:
        config = json.load(f)

    return config


def _build_rich_text_content(report_file: Path) -> dict:
    """构建飞书富文本 (post) 消息体"""
    with open(report_file, 'r', encoding='utf-8') as f:
        full_report = f.read()

    lines = full_report.split('\n')

    # 提取标题
    title = "🔒 安全审计报告"
    for line in lines:
        if line.startswith("# "):
            title = line.lstrip("# ").strip()
            break

    # 构建富文本内容行
    content_lines = []

    # 摘要部分
    summary_items = []
    in_summary = False
    for line in lines:
        if '执行摘要' in line or '📊' in line:
            in_summary = True
            continue
        if in_summary:
            if line.startswith('---') or (line.startswith('##') and '执行摘要' not in line):
                break
            stripped = line.strip()
            if stripped.startswith('- '):
                summary_items.append(stripped)

    if summary_items:
        content_lines.append([{"tag": "text", "text": "📊 执行摘要", "style": ["bold"]}])
        for item in summary_items:
            content_lines.append([{"tag": "text", "text": item}])
        content_lines.append([{"tag": "text", "text": ""}])

    # 风险分布
    risk_items = []
    in_risk = False
    for line in lines:
        if '风险等级分布' in line:
            in_risk = True
            continue
        if in_risk:
            if line.startswith('---') or (line.startswith('#') and '风险' not in line):
                break
            stripped = line.strip()
            if stripped.startswith('- '):
                risk_items.append(stripped)

    if risk_items:
        content_lines.append([{"tag": "text", "text": "🎯 风险等级分布", "style": ["bold"]}])
        for item in risk_items:
            content_lines.append([{"tag": "text", "text": item}])
        content_lines.append([{"tag": "text", "text": ""}])

    # 优先修复清单
    fix_items = []
    in_fix = False
    for line in lines:
        if '优先修复清单' in line:
            in_fix = True
            continue
        if in_fix:
            stripped = line.strip()
            if stripped and not stripped.startswith('```'):
                fix_items.append(stripped)
            if len(fix_items) > 15:
                break

    if fix_items:
        content_lines.append([{"tag": "text", "text": "📋 优先修复清单", "style": ["bold"]}])
        for item in fix_items[:10]:
            content_lines.append([{"tag": "text", "text": item}])
        if len(fix_items) > 10:
            content_lines.append([
                {"tag": "text", "text": f"... 还有 {len(fix_items) - 10} 项，查看完整报告"}
            ])
    else:
        content_lines.append([{"tag": "text", "text": "✅ 未发现需要紧急修复的问题"}])

    return {
        "msg_type": "post",
        "content": {
            "post": {
                "zh_cn": {
                    "title": title,
                    "content": content_lines,
                }
            }
        }
    }


def _build_interactive_card(report_file: Path) -> dict:
    """构建飞书卡片消息（适用于 Bot API）"""
    with open(report_file, 'r', encoding='utf-8') as f:
        full_report = f.read()

    lines = full_report.split('\n')

    # 提取统计数据
    stats = {"pass": 0, "warning": 0, "fail": 0, "total": 0}
    for line in lines:
        if '通过:' in line:
            try:
                stats["pass"] = int(line.split(':')[-1].strip())
            except ValueError:
                pass
        elif '警告:' in line:
            try:
                stats["warning"] = int(line.split(':')[-1].strip())
            except ValueError:
                pass
        elif '失败:' in line:
            try:
                stats["fail"] = int(line.split(':')[-1].strip())
            except ValueError:
                pass
        elif '总计:' in line:
            try:
                stats["total"] = int(line.split(':')[-1].strip())
            except ValueError:
                pass

    # 确定卡片颜色
    if stats["fail"] > 0:
        header_color = "red"
        header_title = f"🔴 安全审计: 发现 {stats['fail']} 个问题"
    elif stats["warning"] > 0:
        header_color = "orange"
        header_title = f"🟡 安全审计: {stats['warning']} 个警告"
    else:
        header_color = "green"
        header_title = "🟢 安全审计: 全部通过"

    card = {
        "msg_type": "interactive",
        "card": {
            "header": {
                "title": {"tag": "plain_text", "content": header_title},
                "template": header_color,
            },
            "elements": [
                {
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": (
                            f"**检查结果统计**\n"
                            f"✅ 通过: {stats['pass']}  |  "
                            f"⚠️ 警告: {stats['warning']}  |  "
                            f"❌ 失败: {stats['fail']}  |  "
                            f"📋 总计: {stats['total']}"
                        ),
                    },
                },
                {"tag": "hr"},
            ],
        },
    }

    # 添加修复清单
    fix_content = []
    in_fix = False
    for line in lines:
        if '优先修复清单' in line:
            in_fix = True
            continue
        if in_fix:
            stripped = line.strip()
            if stripped and not stripped.startswith('```'):
                fix_content.append(stripped)
            if len(fix_content) > 5:
                break

    if fix_content:
        card["card"]["elements"].append({
            "tag": "div",
            "text": {
                "tag": "lark_md",
                "content": "**📋 优先修复**\n" + "\n".join(fix_content[:5]),
            },
        })

    return card


def send_to_feishu_webhook(content: dict, webhook_url: str) -> bool:
    """通过 Webhook 发送消息（支持富文本和卡片）"""
    try:
        data = json.dumps(content, ensure_ascii=False).encode('utf-8')

        req = urllib.request.Request(
            webhook_url,
            data=data,
            headers={'Content-Type': 'application/json'},
        )

        with urllib.request.urlopen(req, timeout=10) as response:
            resp_data = json.loads(response.read().decode('utf-8'))
            if resp_data.get('code') == 0 or response.getcode() == 200:
                print_success("飞书消息发送成功")
                return True
            else:
                print_error(f"飞书返回错误: {resp_data}")
                return False

    except urllib.error.URLError as e:
        print_error(f"网络请求失败: {e}")
        return False
    except Exception as e:
        print_error(f"发送失败: {e}")
        return False


def send_via_openclaw_plugin(report_file: str, session_key: str = None) -> bool:
    """通过 OpenClaw 插件 API 发送报告"""
    config = load_feishu_config()
    if not config:
        return False

    # 查找飞书插件配置
    plugins = config.get('plugins', {}).get('installs', {})
    feishu_plugin = None
    for name, info in plugins.items():
        if 'feishu' in name.lower() or 'lark' in name.lower():
            feishu_plugin = info
            break

    if not feishu_plugin:
        print_info("未找到飞书插件配置，尝试使用 Webhook")
        return False

    # 尝试通过插件 API 端点发送
    api_base = feishu_plugin.get('apiEndpoint', '')
    if not api_base:
        print_info("飞书插件未配置 API 端点")
        return False

    report_path = Path(report_file)
    content = _build_rich_text_content(report_path)

    payload = {
        "action": "send_message",
        "session_key": session_key,
        "content": content,
    }

    try:
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(
            api_base,
            data=data,
            headers={'Content-Type': 'application/json'},
        )

        with urllib.request.urlopen(req, timeout=15) as response:
            if response.getcode() == 200:
                print_success("通过 OpenClaw 插件 API 发送成功")
                return True
    except Exception as e:
        print_info(f"插件 API 发送失败 ({e})，回退到其他方式")

    return False


def format_report_for_feishu(report_file: Path, max_length: int = 2000) -> str:
    """格式化报告为纯文本（兼容旧版 webhook）"""
    with open(report_file, 'r', encoding='utf-8') as f:
        full_report = f.read()

    lines = full_report.split('\n')

    # 提取摘要
    summary_lines = []
    in_summary = False
    for line in lines:
        if '执行摘要' in line or '📊' in line:
            in_summary = True
        if in_summary:
            summary_lines.append(line)
            if len(summary_lines) > 15:
                break
        if in_summary and not line.strip() and len(summary_lines) > 5:
            break

    summary = '\n'.join(summary_lines[:15])

    # 提取问题
    issues = []
    in_failed = False
    for line in lines:
        if '优先修复清单' in line or '📋' in line:
            in_failed = True
            continue
        if in_failed:
            if line.startswith('##') or line.startswith('---'):
                break
            if line.strip().startswith('-') or line.strip().startswith('1.'):
                issues.append(line.strip())

    message = "🔒 安全审计报告\n\n"
    message += summary
    message += "\n\n---\n"

    if issues:
        message += "📋 需要关注的问题\n"
        for issue in issues[:5]:
            message += issue + "\n"
        if len(issues) > 5:
            message += f"\n... 还有 {len(issues) - 5} 个问题，查看完整报告\n"
    else:
        message += "✅ 未发现严重问题\n"

    if len(message) > max_length:
        message = message[:max_length - 30]
        message += "\n\n... (消息过长，查看完整报告)"

    return message


def send_report(report_file: str, webhook_url: str = None,
                session_key: str = None, format_type: str = "rich"):
    """发送报告的统一入口"""
    report_path = Path(report_file)
    if not report_path.exists():
        print_error(f"报告文件不存在: {report_file}")
        return False

    print_info(f"准备发送报告: {report_file}")

    # 1. 尝试 OpenClaw 插件 API
    if send_via_openclaw_plugin(report_file, session_key):
        return True

    # 2. 尝试 Webhook
    if not webhook_url:
        webhook_url = os.environ.get('FEISHU_WEBHOOK_URL', '')

    if webhook_url:
        if format_type == "card":
            content = _build_interactive_card(report_path)
        elif format_type == "rich":
            content = _build_rich_text_content(report_path)
        else:
            content = {
                "msg_type": "text",
                "content": {"text": format_report_for_feishu(report_path)},
            }
        return send_to_feishu_webhook(content, webhook_url)

    # 3. 兜底：保存格式化消息
    formatted = format_report_for_feishu(report_path)
    print_info("消息内容预览:")
    print("-" * 50)
    print(formatted[:500])
    print("-" * 50)
    print_success("报告已准备，请使用 OpenClaw message 工具发送或配置飞书 Webhook")

    return False


def main():
    import argparse

    parser = argparse.ArgumentParser(description="发送安全审计报告到飞书")
    parser.add_argument('report_file', help="报告文件路径")
    parser.add_argument('--webhook', help="飞书 Webhook URL")
    parser.add_argument('--session', help="飞书会话 Key")
    parser.add_argument(
        '--format', choices=['text', 'rich', 'card'], default='rich',
        help="消息格式: text(纯文本), rich(富文本), card(卡片) (默认: rich)",
    )

    args = parser.parse_args()

    if not Path(args.report_file).exists():
        print_error(f"报告文件不存在: {args.report_file}")
        sys.exit(1)

    success = send_report(
        args.report_file,
        webhook_url=args.webhook,
        session_key=args.session,
        format_type=args.format,
    )

    # 保存格式化消息副本
    output_file = Path(args.report_file).parent / f"{Path(args.report_file).stem}-feishu.txt"
    formatted = format_report_for_feishu(Path(args.report_file))
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(formatted)
    print_success(f"飞书消息副本已保存到: {output_file}")

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
