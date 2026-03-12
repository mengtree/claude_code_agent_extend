# 模块配置示例

本文档展示如何为各个模块配置 `messageBusURL`。

## 配置方式

### 方式 1: 环境变量（推荐）

```bash
# 设置消息总线地址
export MESSAGE_BUS_URL=http://localhost:3000

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
  "port": 3000,
  "host": "127.0.0.1",
  "messageBusURL": "http://localhost:3000",
  "defaultModel": "claude-sonnet-4-6",
  "logLevel": "info"
}
```

**环境变量**:
```bash
export PLATFORM_CORE_PORT=3000
export PLATFORM_CORE_MESSAGE_BUS_URL=http://localhost:3000
```

### sessions 模块

**文件**: `Modules/sessions/config.json`

```json
{
  "port": 3010,
  "host": "127.0.0.1",
  "messageBusURL": "http://localhost:3000",
  "platformCoreUrl": "http://127.0.0.1:3000",
  "logLevel": "info"
}
```

**环境变量**:
```bash
export SESSIONS_PORT=3010
export SESSIONS_MESSAGE_BUS_URL=http://localhost:3000
export SESSIONS_PLATFORM_CORE_URL=http://127.0.0.1:3000
```

### schedule 模块

**文件**: `Modules/schedule/config.json`

```json
{
  "port": 3014,
  "host": "127.0.0.1",
  "panelPort": 0,
  "panelHost": "127.0.0.1",
  "messageBusURL": "http://localhost:3200",
  "scanIntervalMs": 1000,
  "claimTimeoutMs": 300000,
  "logLevel": "info"
}
```

**环境变量**:
```bash
export SCHEDULE_PORT=3014
export SCHEDULE_PANEL_PORT=0
export MESSAGE_BUS_URL=http://localhost:3200
```

## 完整启动示例

### 1. 启动 Platform 消息总线

```bash
cd Platform
npm start

# 消息总线将在 http://localhost:3000 运行
```

### 2. 启动 platform-core 模块

```bash
cd Modules/platform-core

# 方式 1: 使用环境变量
MESSAGE_BUS_URL=http://localhost:3000 npm start

# 方式 2: 使用配置文件（需先创建 config.json）
npm start

# 模块将在 http://localhost:3000 运行
```

### 3. 启动 sessions 模块

```bash
cd Modules/sessions

# 方式 1: 使用环境变量
MESSAGE_BUS_URL=http://localhost:3000 npm start

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
# 集成面板端口默认随机分配，并自动注册到 Platform Dashboard
```

## 配置优先级

配置加载优先级（从高到低）：

1. **环境变量** - 最高优先级
2. **配置文件** (`config.json`)
3. **默认值** - 最低优先级

## 环境变量列表

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `MESSAGE_BUS_URL` | 消息总线地址 | `http://localhost:3000` |
| `PLATFORM_CORE_PORT` | platform-core 端口 | `3000` |
| `PLATFORM_CORE_HOST` | platform-core 地址 | `127.0.0.1` |
| `SESSIONS_PORT` | sessions 模块端口 | `3010` |
| `SESSIONS_HOST` | sessions 模块地址 | `127.0.0.1` |
| `SCHEDULE_PORT` | schedule 模块 API 端口 | `3014` |
| `SCHEDULE_PANEL_PORT` | schedule 面板端口，`0` 为随机 | `0` |

## 验证配置

启动模块后，可以通过以下方式验证：

```bash
# 检查消息总线状态
curl http://localhost:3000/health

# 查看订阅者
curl http://localhost:3000/subscribers

# 检查模块健康状态
curl http://localhost:3000/health
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
