# Platform Core Module

> 智能体核心模块，负责 Claude SDK、会话与消息处理；平台运行时已迁移到 Platform/

## 简介

platform-core 现在只承载智能体相关能力，负责：

- **Claude CLI SDK 对接**：提供与 Claude AI 模型的交互能力
- **流式传输**：支持 SSE（Server-Sent Events）实时流式响应
- **会话管理**：管理多轮对话的会话状态
- **HTTP API**：提供 RESTful API 接口供其他模块调用

平台级职责已经拆到 Platform/ 启动项目中，包括模块注册、模块守护、平台控制面和统一消息总线统计。

本模块采用 **MVC 架构设计**：

- **Model（模型层）**：负责数据存储和会话管理
- **View（视图层）**：通过 SSE 提供流式数据输出
- **Controller（控制器层）**：处理 HTTP 请求和业务逻辑

## 快速开始

### 安装依赖

```bash
cd Modules/platform-core
npm install
```

### 构建

```bash
npm run build
```

### 配置

可以通过环境变量或配置文件进行配置：

**环境变量配置**：

```bash
export PORT=3000
export HOST=127.0.0.1
export DEFAULT_MODEL=claude-sonnet-4-6
export LOG_LEVEL=info
```

**配置文件** (`config.json`)：

```json
{
  "port": 3000,
  "host": "127.0.0.1",
  "defaultModel": "claude-sonnet-4-6",
  "defaultTimeoutMs": 120000,
  "maxConcurrentSessions": 100,
  "sessionPersistence": true,
  "logLevel": "info"
}
```

### 启动服务

```bash
npm start
```

服务将在 `http://127.0.0.1:3001` 启动。

### 健康检查

```bash
curl http://localhost:3000/health
```

## API 使用

### 1. 执行查询（非流式）

```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "解释什么是机器学习",
    "systemPrompt": "你是一个专业的AI助手"
  }'
```

### 2. 流式查询

```bash
curl -N -X POST http://localhost:3000/stream \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "写一个快速排序算法"
  }'
```

### 3. 创建会话

```bash
curl -X POST http://localhost:3000/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "externalSource": "wechat",
    "externalConversationId": "chat_12345"
  }'
```

### 4. 列出会话

```bash
curl http://localhost:3000/sessions
```

### 5. 删除会话

```bash
curl -X DELETE http://localhost:3000/sessions/{sessionId}
```

### 6. 通用模块消息

```bash
curl -X POST http://localhost:3000/messages \
  -H "Content-Type: application/json" \
  -d '{
    "traceId": "trace-001",
    "fromModule": "sessions",
    "toModule": "platform-core",
    "action": "submit_user_message",
    "payload": {
      "message": "请回复 OK"
    },
    "replyTo": "sessions",
    "timeoutMs": 30000,
    "context": {
      "sessionId": "session-001"
    }
  }'
```

返回统一的 reply envelope，供调用模块继续处理。

## 目录结构

```
platform-core/
├── src/
│   ├── types/           # 类型定义
│   │   └── index.ts
│   ├── models/          # 会话模型
│   │   └── Session.ts
│   ├── controllers/     # 查询、会话、健康、消息控制器
│   ├── services/        # Claude SDK 服务
│   ├── routes/          # HTTP 路由
│   ├── utils/           # 配置与日志
│   └── index.ts         # 智能体模块入口
├── skills/
│   └── SKILL.md         # Skill 文档
├── tests/
│   └── api.test.ts      # 测试文件
├── runtime/
│   ├── data/            # 数据存储
│   ├── logs/            # 日志文件
│   └── tmp/             # 临时文件
├── module.json          # 模块清单（Manifest）
├── package.json
├── tsconfig.json
└── README.md
```

## 模块边界

- Platform/: 平台总线、模块注册、进程守护、控制面
- Modules/platform-core: 智能体查询、会话、消息回复
- Modules/sessions: 会话管理与浏览器验证页

## 架构设计

### MVC 模式

本模块采用经典的 MVC 架构模式：

1. **Model（模型层）**
   - `SessionModel`：负责会话的 CRUD 操作
   - 数据持久化到本地文件系统
   - 提供会话查询和管理功能

2. **View（视图层）**
   - 通过 SSE（Server-Sent Events）提供流式数据输出
   - 实时推送 Claude AI 的响应进度
   - 支持多种事件类型（init, message, result, error, done）

3. **Controller（控制器层）**
   - `QueryController`：处理查询相关请求
   - `SessionController`：处理会话管理请求
   - `HealthController`：处理健康检查请求

### 流式传输

流式传输通过 SSE 实现，支持以下事件类型：

| 事件类型 | 说明 |
|---------|------|
| `connected` | 连接建立 |
| `init` | SDK 初始化 |
| `message` | SDK 消息 |
| `result` | 最终结果 |
| `error` | 错误信息 |
| `done` | 完成 |
| `heartbeat` | 心跳（每15秒） |

## 开发

### 构建

```bash
npm run build
```

### 开发模式（监听文件变化）

```bash
npm run dev
```

### 测试

```bash
npm test
```

### 清理

```bash
npm run clean
```

## 配置说明

| 配置项 | 说明 | 默认值 |
|-------|------|--------|
| `port` | HTTP 服务端口 | `3000` |
| `host` | HTTP 服务监听地址 | `127.0.0.1` |
| `defaultModel` | 默认使用的 Claude 模型 | `claude-sonnet-4-6` |
| `defaultTimeoutMs` | 默认超时时间（毫秒） | `120000` |
| `maxConcurrentSessions` | 最大并发会话数 | `100` |
| `sessionPersistence` | 是否持久化会话 | `true` |
| `logLevel` | 日志级别 | `info` |

## 依赖项

- `@anthropic-ai/claude-agent-sdk`: Claude Agent SDK
- Node.js >= 18.0.0
- TypeScript >= 5.0.0

## 许可证

MIT

## 作者

Agent Platform Team

---

更多详细信息请参阅 [Skill 文档](./skills/SKILL.md)。
