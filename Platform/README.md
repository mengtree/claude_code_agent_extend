# Platform

Platform 目录现在承载平台级运行时，而不是智能体能力本身。它负责把整个 Modules 目录当作统一总线来管理，包括：

- 模块注册与发现
- 插件热拔插加载与卸载
- 平台内消息总线与消息历史
- 控制面 HTTP API 与插件网关

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
- http://127.0.0.1:3200/api/plugins

## 控制面接口

- GET /health: 平台健康状态
- GET /status: 平台运行时状态、模块状态、插件状态
- GET /deliveries: 当前消息总线历史
- GET /api/plugins: 当前已加载插件列表
- POST /modules/:id/start: 加载指定插件模块
- POST /modules/:id/stop: 卸载指定插件模块
- POST /modules/:id/restart: 重载指定插件模块
- /plugin/:id/*: 插件 HTTP 网关入口

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

## 插件模型

- Modules 下的模块不再由 Platform 以独立进程托管，改为同进程动态导入。
- 每个模块通过 module.json 中的 plugin 字段声明插件入口、宿主访问路径与 UI 元数据。
- 带页面的插件统一通过宿主网关暴露，例如 /plugin/sessions/playground、/plugin/schedule/。

## 边界

- Platform: 总线、插件加载、控制面、插件网关
- Modules/platform-core: 智能体查询与会话服务
- 其他 Modules/*: 宿主内热插拔能力插件