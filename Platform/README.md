# Platform

Platform 目录现在承载平台级运行时，而不是智能体能力本身。它负责把整个 Modules 目录当作统一总线来管理，包括：

- 模块注册与发现
- 模块进程守护与健康检查
- 平台内消息总线与消息历史
- 控制面 HTTP API

智能体能力继续由 Modules/platform-core 提供，Platform 只负责平台治理与总线职责。

## 快速开始

```bash
cd Platform
npm install
npm run build
npm start
```

默认启动地址：

- http://127.0.0.1:3200/health
- http://127.0.0.1:3200/status
- http://127.0.0.1:3200/deliveries

## 控制面接口

- GET /health: 平台健康状态
- GET /status: 平台运行时状态、模块状态、进程状态
- GET /deliveries: 当前消息总线历史
- POST /modules/:id/start: 启动指定模块
- POST /modules/:id/stop: 停止指定模块
- POST /modules/:id/restart: 重启指定模块

## 配置

配置文件默认为 Platform/config.json，也可以通过环境变量覆盖：

- PLATFORM_APP_CONFIG
- PLATFORM_APP_PORT
- PLATFORM_APP_HOST
- PLATFORM_APP_MODULES_ROOT
- PLATFORM_APP_LOG_LEVEL
- PLATFORM_APP_HEALTH_CHECK_INTERVAL
- PLATFORM_APP_MAX_RESTARTS
- PLATFORM_APP_RESTART_BACKOFF_MS

## 边界

- Platform: 总线、守护、控制面
- Modules/platform-core: 智能体查询与会话服务
- 其他 Modules/*: 各自独立能力模块