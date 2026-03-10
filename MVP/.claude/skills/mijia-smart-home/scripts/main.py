import argparse
import json
import logging
import sys

from mijiaAPI import mijiaAPI, mijiaDevice, get_device_info
from mijiaAPI import LoginError

logging.getLogger("mijiaAPI").setLevel(logging.WARNING)


def make_api(auth_path=None):
	api = mijiaAPI(auth_path) if auth_path else mijiaAPI()
	try:
		api.login()
	except LoginError as e:
		print(f"登录失败: {e}")
		sys.exit(1)
	return api


def cmd_list(args):
	api = make_api(args.auth)
	devices = api.get_devices_list()
	print(json.dumps(devices, ensure_ascii=False, indent=2))


def cmd_list_homes(args):
	api = make_api(args.auth)
	homes = api.get_homes_list()
	print(json.dumps(homes, ensure_ascii=False, indent=2))


def cmd_info(args):
	if not args.model:
		print("请通过 --model 指定设备 model，例如从 --list_devices 输出中获取")
		return
	info = get_device_info(args.model)
	print(json.dumps(info, ensure_ascii=False, indent=2))


def find_device(api, did, dev_name):
	if did:
		return mijiaDevice(api, did=did)
	if dev_name:
		return mijiaDevice(api, dev_name=dev_name)
	raise ValueError("需要指定 --did 或 --dev_name")


def cmd_get(args):
	api = make_api(args.auth)
	try:
		device = find_device(api, args.did, args.dev_name)
	except Exception as e:
		print(f"设备初始化失败: {e}")
		return
	if not args.prop_name:
		print(device)
		return
	try:
		value = device.get(args.prop_name)
		print(json.dumps({"prop": args.prop_name, "value": value}, ensure_ascii=False, indent=2))
	except Exception as e:
		print(f"获取属性失败: {e}")


def cmd_set(args):
	api = make_api(args.auth)
	try:
		device = find_device(api, args.did, args.dev_name)
	except Exception as e:
		print(f"设备初始化失败: {e}")
		return
	if args.prop_name is None or args.value is None:
		print("请同时指定 --prop_name 和 --value")
		return
	# 尝试将字符串值解析为 bool/int/float，否则保留字符串
	val = args.value
	if val.lower() in ("true", "false"):
		val = val.lower() == "true"
	else:
		try:
			if "." in val:
				val = float(val)
			else:
				val = int(val)
		except Exception:
			pass
	try:
		device.set(args.prop_name, val)
		print("设置成功")
	except Exception as e:
		print(f"设置属性失败: {e}")


def cmd_action(args):
	api = make_api(args.auth)
	try:
		device = find_device(api, args.did, args.dev_name)
	except Exception as e:
		print(f"设备初始化失败: {e}")
		return
	if not args.action:
		print("请通过 --action 指定要执行的动作名称")
		return
	try:
		device.run_action(args.action)
		print("动作执行成功")
	except Exception as e:
		print(f"执行动作失败: {e}")


def main(argv=None):
	p = argparse.ArgumentParser(description="简单的 mijiaAPI CLI: 列设备、获取/设置属性、执行动作")
	p.add_argument("-p", "--auth", dest="auth", help="认证文件路径，默认 ~/.config/mijia-api/auth.json")
	sub = p.add_subparsers(dest="cmd")

	sp_list = sub.add_parser("list_devices", help="列出所有设备")
	sp_list.set_defaults(func=cmd_list)

	sp_homes = sub.add_parser("list_homes", help="列出家庭列表")
	sp_homes.set_defaults(func=cmd_list_homes)

	sp_info = sub.add_parser("info", help="获取设备 model 的规格信息")
	sp_info.add_argument("--model", help="设备 model，例如 yeelink.light.lamp4")
	sp_info.set_defaults(func=cmd_info)

	sp_get = sub.add_parser("get", help="获取设备属性（使用 mijiaDevice 封装）")
	sp_get.add_argument("--did", help="设备 did，优先使用")
	sp_get.add_argument("--dev_name", help="设备名称")
	sp_get.add_argument("--prop_name", help="属性名称，例如 brightness 或 on")
	sp_get.set_defaults(func=cmd_get)

	sp_set = sub.add_parser("set", help="设置设备属性（使用 mijiaDevice 封装）")
	sp_set.add_argument("--did", help="设备 did，优先使用")
	sp_set.add_argument("--dev_name", help="设备名称")
	sp_set.add_argument("--prop_name", help="属性名称，例如 brightness 或 on")
	sp_set.add_argument("--value", help="要设置的值，支持数字/布尔/字符串")
	sp_set.set_defaults(func=cmd_set)

	sp_action = sub.add_parser("action", help="执行设备动作（使用 mijiaDevice.run_action）")
	sp_action.add_argument("--did", help="设备 did，优先使用")
	sp_action.add_argument("--dev_name", help="设备名称")
	sp_action.add_argument("--action", help="动作名称，例如 toggle")
	sp_action.set_defaults(func=cmd_action)

	args = p.parse_args(argv)
	if not hasattr(args, "func"):
		p.print_help()
		return
	args.func(args)


if __name__ == "__main__":
	main()

