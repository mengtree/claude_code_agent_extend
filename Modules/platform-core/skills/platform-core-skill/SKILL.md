# Platform Core Module - Skill 文档

## 模块概述

平台核心模块（Platform Core）是整个平台的智能中枢，负责：

1. **Claude CLI SDK 对接**：提供与 Claude AI 模型的交互能力
2. **流式传输**：支持 SSE（Server-Sent Events）实时流式响应
3. **会话管理**：管理多轮对话的会话状态
4. **HTTP API**：提供 RESTful API 接口供其他模块调用

本模块是平台中唯一默认具备智能体能力的核心模块，其他模块通过统一协议与之交互。

## 模块标识

- **模块 ID**: `platform-core`
- **模块类型**: `core`
- **版本**: `0.1.0`

## 基础信息

- **HTTP 服务端口**: 默认 3000（可配置）
- **健康检查端点**: `GET /health`
- **就绪检查端点**: `GET /ready`

## 对外动作（Capabilities）

### 1. query - 执行 Claude 查询

**描述**: 执行 Claude AI 查询并返回结果（非流式）

**适用场景**:
- 需要一次性获取完整响应的场景
- 批量处理任务
- 不需要实时反馈的后台任务

**请求参数**:
```typescript
{
  prompt: string;          // 必填，用户提示词
  sessionId?: string;      // 可选，会话 ID，用于多轮对话
  systemPrompt?: string;   // 可选，系统提示词
  model?: string;          // 可选，指定模型
  timeoutMs?: number;      // 可选，超时时间（毫秒）
  jsonSchema?: object;     // 可选，JSON Schema 用于结构化输出
}
```

**返回结果**:
```typescript
{
  ok: boolean;             // 是否成功
  result: string;          // 结果内容
  sessionId?: string;      // 会话 ID
  claudeSessionId?: string; // Claude 会话 ID
  durationMs?: number;     // 执行时长（毫秒）
  costUsd?: number;        // 成本（美元）
  stopReason?: string;     // 停止原因
  raw?: object;            // 原始 SDK 响应
}
```

**超时时间**: 120000ms（2分钟）

**是否幂等**: 否

**示例**:
```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "解释什么是机器学习",
    "systemPrompt": "你是一个专业的AI助手"
  }'
```

### 2. stream_query - 流式查询

**描述**: 执行 Claude AI 查询并以流式方式返回结果（SSE）

**适用场景**:
- 需要实时反馈的场景
- 长时间运行的任务
- 需要展示思考过程的场景

**请求参数**: 同 `query`

**返回格式**: Server-Sent Events (SSE) 流

**事件类型**:
- `init`: 初始化消息
- `message`: SDK 消息
- `result`: 最终结果
- `error`: 错误信息
- `done`: 完成

**超时时间**: 120000ms（2分钟）

**是否幂等**: 否

**示例**:
```bash
curl -N -X POST http://localhost:3000/stream \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "写一个快速排序算法"
  }'
```

### 3. create_session - 创建会话

**描述**: 创建新的对话会话

**适用场景**:
- 开始新的对话
- 为外部系统创建独立会话
- 需要隔离不同对话场景

**请求参数**:
```typescript
{
  externalSource?: string;          // 可选，外部来源（如 IM 平台）
  externalConversationId?: string;  // 可选，外部会话 ID
}
```

**返回结果**:
```typescript
{
  sessionId: string;          // 会话 ID
  claudeSessionId?: string;   // Claude 会话 ID
  createdAt: string;          // 创建时间
}
```

**超时时间**: 5000ms

**是否幂等**: 是

**示例**:
```bash
curl -X POST http://localhost:3000/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "externalSource": "wechat",
    "externalConversationId": "chat_12345"
  }'
```

### 4. list_sessions - 列出会话

**描述**: 列出所有会话

**适用场景**:
- 查看活跃会话
- 会话管理和监控
- 数据分析

**请求参数**:
```typescript
{
  limit?: number;              // 可选，返回数量限制
  status?: 'active' | 'deleted'; // 可选，状态过滤
}
```

**返回结果**: 会话信息数组

**超时时间**: 5000ms

**是否幂等**: 是

### 5. delete_session - 删除会话

**描述**: 删除指定会话（软删除）

**适用场景**:
- 清理过期会话
- 用户主动删除会话
- 隐私合规要求

**请求参数**:
```typescript
{
  sessionId: string;     // 必填，会话 ID
  keepClaude?: boolean;  // 可选，是否保留 Claude 会话数据
}
```

**返回结果**:
```typescript
{
  deleted: boolean;
  sessionId: string;
}
```

**超时时间**: 5000ms

**是否幂等**: 是

### 6. get_health - 获取健康状态

**描述**: 获取模块健康状态

**适用场景**:
- 健康检查
- 监控和告警
- 负载均衡探测

**请求参数**: 无

**返回结果**:
```typescript
{
  ok: boolean;            // 是否健康
  uptime: number;         // 运行时长（秒）
  activeSessions: number; // 活跃会话数
  version: string;        // 版本
  startedAt: string;      // 启动时间
}
```

**超时时间**: 3000ms

**是否幂等**: 是

## 配置说明

### 环境变量配置

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `PORT` | HTTP 服务端口 | `3000` |
| `HOST` | HTTP 服务监听地址 | `127.0.0.1` |
| `DEFAULT_MODEL` | 默认模型 | `claude-sonnet-4-6` |
| `DEFAULT_TIMEOUT_MS` | 默认超时时间 | `120000` |
| `MAX_CONCURRENT_SESSIONS` | 最大并发会话数 | `100` |
| `SESSION_PERSISTENCE` | 是否持久化会话 | `true` |
| `LOG_LEVEL` | 日志级别 | `info` |

### 配置文件

可通过 `./config.json` 文件或 `PLATFORM_CORE_CONFIG` 环境变量指定配置文件路径。

## 数据存储

- **数据目录**: `runtime/data/`
- **会话文件**: `runtime/data/sessions.json`
- **日志目录**: `runtime/logs/`
- **临时目录**: `runtime/tmp/`

## 错误处理

### 常见错误码

| 错误码 | HTTP 状态 | 说明 |
|-------|----------|------|
| `VALIDATION_ERROR` | 400 | 请求参数验证失败 |
| `SESSION_NOT_FOUND` | 404 | 会话不存在 |
| `SDK_EXECUTION_ERROR` | 500 | SDK 调用失败 |

### 错误响应格式

```typescript
{
  error: string;    // 错误信息
  ok: false;        // 错误标识
}
```

## 与其他模块的协作

### 作为核心模块的职责

1. **接收外部请求**：从 IM、Webhook 等接入型模块接收用户消息
2. **理解用户意图**：使用 Claude AI 理解和分析用户需求
3. **编排任务流程**：调用其他执行型模块（如定时、文件处理）完成任务
4. **返回结果**：将处理结果通过接入型模块返回给用户

### 调用其他模块

核心模块通过统一消息信封（Message Envelope）调用其他模块：

```typescript
{
  messageId: string;
  traceId: string;
  fromModule: 'platform-core';
  toModule: '<目标模块ID>';
  action: '<动作名>';
  payload: object;
  replyTo: 'platform-core';
  callbackTopic: string;
  timeoutMs: number;
  context: {
    sessionId: string;
    userId?: string;
  };
  createdAt: string;
}
```

### 被其他模块调用

其他模块通过 HTTP API 调用核心模块的能力。

## 模块启停说明

### 启动

```bash
# 构建
npm run build

# 启动
npm start

# 或直接使用 node
node dist/index.js
```

### 停止

发送 `SIGTERM` 或 `SIGINT` 信号进行优雅关闭：
```bash
kill <PID>
```

### 健康检查

```bash
curl http://localhost:3000/health
```

## 最佳实践

1. **使用会话管理**: 对于多轮对话，始终使用 `sessionId` 来维持上下文
2. **合理设置超时**: 根据任务复杂度设置合适的 `timeoutMs`
3. **错误处理**: 始终检查响应中的 `ok` 字段
4. **流式传输**: 对于长时间运行的任务，使用 `stream_query` 获取实时反馈
5. **资源清理**: 定期调用 `delete_session` 清理过期会话

## 限制说明

1. **并发限制**: 最大并发会话数受 `MAX_CONCURRENT_SESSIONS` 限制
2. **超时限制**: 单次查询默认超时 2 分钟
3. **模型选择**: 需要有效的 Anthropic API 密钥
4. **网络依赖**: 需要能够访问 Anthropic API 端点

## 版本历史

- **0.1.0** (2025-03-11): 初始版本
  - Claude SDK 对接
  - 流式传输支持
  - 会话管理
  - HTTP API
