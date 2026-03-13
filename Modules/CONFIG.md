# 模块配置示例

本文档展示当前插件化集成模型下，Modules 中各模块如何声明配置并由 Platform 统一加载。

## 当前集成方式

- Platform 扫描 Modules 下的 module.json，并读取其中的 plugin 字段动态加载插件。
- 插件页面统一由宿主网关暴露，不再为 schedule、sessions 等模块单独启动集成面板端口。
- `messageBusURL` 默认应指向 Platform 控制面，例如 `http://localhost:3200`。

## 配置方式

### 方式 1: 环境变量（推荐）

```bash
# 设置消息总线地址
export MESSAGE_BUS_URL=http://localhost:3200

# 启动 platform-core
cd Modules/platform-core
npm start

# 启动 sessions 模块
cd Modules/sessions
npm start
```

### 方式 2: 配置文件

在每个模块的根目录下创建 `config.json` 文件。

## 各模块配置示例

### platform-core 模块

**文件**: `Modules/platform-core/config.json`

```json
{
  "port": 3001,
  "host": "127.0.0.1",
  "messageBusURL": "http://localhost:3200",
  "defaultModel": "claude-sonnet-4-6",
  "logLevel": "info"
}
```

**环境变量**:
```bash
export PLATFORM_CORE_PORT=3001
export PLATFORM_CORE_MESSAGE_BUS_URL=http://localhost:3200
```

### sessions 模块

**文件**: `Modules/sessions/config.json`

```json
{
  "port": 3010,
  "host": "127.0.0.1",
  "messageBusURL": "http://localhost:3200",
  "platformCoreUrl": "http://127.0.0.1:3200",
  "logLevel": "info"
}
```

**环境变量**:
```bash
export SESSIONS_PORT=3010
export SESSIONS_MESSAGE_BUS_URL=http://localhost:3200
export SESSIONS_PLATFORM_CORE_URL=http://127.0.0.1:3200
```

### schedule 模块

**文件**: `Modules/schedule/config.json`

```json
{
  "port": 3014,
  "host": "127.0.0.1",
  "messageBusURL": "http://localhost:3200",
  "scanIntervalMs": 1000,
  "claimTimeoutMs": 300000,
  "logLevel": "info"
}
```

**环境变量**:
```bash
export SCHEDULE_PORT=3014
export MESSAGE_BUS_URL=http://localhost:3200
```

## 完整启动示例

### 1. 启动 Platform 宿主

```bash
cd Platform
npm start

# 宿主将在 http://localhost:3200 运行，并自动加载标记为 autoStart 的插件模块
```

### 2. 启动 platform-core 模块

```bash
cd Modules/platform-core

# 方式 1: 使用环境变量
MESSAGE_BUS_URL=http://localhost:3200 npm start

# 方式 2: 使用配置文件（需先创建 config.json）
npm start

# 独立运行时模块将在 http://localhost:3001 运行
```

### 3. 启动 sessions 模块

```bash
cd Modules/sessions

# 方式 1: 使用环境变量
MESSAGE_BUS_URL=http://localhost:3200 npm start

# 方式 2: 使用配置文件
npm start

# 模块将在 http://localhost:3010 运行
```

### 4. 启动 schedule 模块

```bash
cd Modules/schedule

# 方式 1: 使用环境变量
MESSAGE_BUS_URL=http://localhost:3200 npm start

# 方式 2: 使用配置文件
npm start

# API 将在 http://localhost:3014 运行
# 插件模式下页面统一由 Platform 暴露：/plugin/schedule/
```

## 配置优先级

配置加载优先级（从高到低）：

1. **环境变量** - 最高优先级
2. **配置文件** (`config.json`)
3. **默认值** - 最低优先级

## 环境变量列表

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `MESSAGE_BUS_URL` | 消息总线地址 | `http://localhost:3200` |
| `PLATFORM_CORE_PORT` | platform-core 端口 | `3001` |
| `PLATFORM_CORE_HOST` | platform-core 地址 | `127.0.0.1` |
| `SESSIONS_PORT` | sessions 模块端口 | `3010` |
| `SESSIONS_HOST` | sessions 模块地址 | `127.0.0.1` |
| `SCHEDULE_PORT` | schedule 模块 API 端口 | `3014` |

## 验证配置

启动模块后，可以通过以下方式验证：

```bash
# 检查消息总线状态
curl http://localhost:3200/health

# 查看订阅者
curl http://localhost:3200/subscribers

# 检查模块健康状态
curl http://localhost:3200/health
curl http://localhost:3010/health
```

## 网络架构

```
┌─────────────────────────────────────────────┐
│           Platform (消息总线)               │
│           http://localhost:3000            │
│  - POST /messages                          │
│  - GET  /subscribe                         │
│  - GET  /subscribers                       │
└─────────────────┬───────────────────────────┘
                  │
       ┌──────────┴──────────┐
       │                     │
       ▼                     ▼
┌──────────────┐      ┌──────────────┐
│ platform-core│      │   sessions   │
│  :3000       │      │   :3010      │
│ (智能体核心)  │      │ (会话管理)    │
└──────────────┘      └──────────────┘
```

## 常见问题

### Q: 模块无法连接到消息总线

检查：
1. Platform 消息总线是否已启动
2. `MESSAGE_BUS_URL` 是否正确
3. 网络是否可达

```bash
# 测试连接
curl http://localhost:3000/health
```

### Q: 如何在 Docker 中运行

使用环境变量：

```bash
docker run -e MESSAGE_BUS_URL=http://platform:3000 platform-core
docker run -e MESSAGE_BUS_URL=http://platform:3000 sessions
```

### Q: 不同端口同时运行

确保每个模块使用不同的端口，但都连接到同一个消息总线：

```bash
# Platform
PORT=3000 npm start

# platform-core
PLATFORM_CORE_PORT=3001 MESSAGE_BUS_URL=http://localhost:3000 npm start

# sessions
SESSIONS_PORT=3010 MESSAGE_BUS_URL=http://localhost:3000 npm start
```
