# Sessions Module

会话管理模块 - 提供会话创建、查询、管理和对话功能。

## 功能特性

- ✅ 会话生命周期管理（创建、查询、更新、删除）
- ✅ 多渠道会话映射（支持外部系统会话关联）
- ✅ HTTP API 接口
- ✅ 模块间消息总线通信
- ✅ 健康检查端点
- ✅ 数据持久化

## 快速开始

### 安装依赖

```bash
npm install
```

### 编译

```bash
npm run build
```

### 启动服务

```bash
npm start
```

服务将在 `http://127.0.0.1:3010` 启动。

### 开发模式

```bash
npm run dev
```

使用 TypeScript 监听模式自动编译。

## API 端点

### 健康检查

```
GET /health
```

返回服务状态和运行信息。

### 创建会话

```
POST /sessions
Content-Type: application/json

{
  "externalSource": "wechat",
  "externalConversationId": "conv-001"
}
```

返回：
```json
{
  "sessionId": "uuid",
  "claudeSessionId": null,
  "createdAt": "2026-03-11T12:00:00.000Z"
}
```

### 获取会话

```
GET /sessions/{sessionId}
```

返回会话详细信息。

### 列出会话

```
GET /sessions?limit=10&status=active
```

返回会话列表。

### 删除会话

```
DELETE /sessions/{sessionId}
```

软删除指定会话。

## 配置

### 配置文件

编辑 `config.json`:

```json
{
  "port": 3010,
  "host": "127.0.0.1",
  "logLevel": "info",
  "dataDir": "./runtime/data",
  "sessionTimeoutDays": 30
}
```

### 环境变量

- `SESSIONS_PORT`: 服务端口
- `SESSIONS_HOST`: 监听地址
- `SESSIONS_LOG_LEVEL`: 日志级别
- `SESSIONS_DATA_DIR`: 数据目录
- `SESSIONS_TIMEOUT_DAYS`: 会话超时天数

## 与核心平台集成

### 消息总线通信

模块通过 Message Envelope 与核心平台通信：

```json
{
  "messageId": "uuid",
  "traceId": "trace-001",
  "fromModule": "platform-core",
  "toModule": "sessions",
  "action": "create_session",
  "payload": {
    "externalSource": "wechat",
    "externalConversationId": "conv-001"
  },
  "replyTo": "platform-core",
  "timeoutMs": 5000,
  "context": {
    "sessionId": "optional-session-id"
  },
  "createdAt": "2026-03-11T12:00:00.000Z"
}
```

### 支持的动作

- `create_session`: 创建新会话
- `get_session`: 获取会话信息
- `list_sessions`: 列出会话
- `delete_session`: 删除会话
- `find_by_external`: 根据外部映射查找会话
- `update_session`: 更新会话信息
- `submit_message`: 提交用户消息进行对话

## 目录结构

```
sessions/
├── module.json           # 模块 Manifest
├── skills/
│   └── sessions-skill/
│       └── SKILL.md      # 模块 Skill 文档
├── src/
│   ├── controllers/      # 控制器
│   ├── models/           # 数据模型
│   ├── routes/           # 路由
│   ├── utils/            # 工具类
│   ├── types/            # 类型定义
│   └── index.ts          # 主入口
├── tests/                # 测试
├── runtime/
│   ├── data/             # 数据目录
│   ├── logs/             # 日志目录
│   └── tmp/              # 临时目录
├── package.json
├── tsconfig.json
└── config.json
```

## 开发指南

### 添加新功能

1. 在 `src/types/index.ts` 中添加类型定义
2. 在 `src/models/` 中添加数据模型
3. 在 `src/controllers/` 中添加控制器
4. 在 `src/routes/Router.ts` 中添加路由
5. 更新 `module.json` 中的 capabilities
6. 更新 `skills/sessions-skill/SKILL.md` 文档

### 测试

```bash
npm test
```

## 许可证

MIT
