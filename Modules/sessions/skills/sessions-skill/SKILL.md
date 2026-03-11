# Sessions Module Skill

## 模块概述

sessions 模块负责会话管理和对话功能。它提供统一的会话生命周期管理，支持多渠道会话映射和对话交互。

## 适用场景

- 需要创建和管理用户会话
- 需要跟踪来自不同渠道（如 IM、Web）的对话
- 需要查询和操作现有会话
- 需要提交消息并获取 AI 响应

## 对外动作列表

### create_session
创建新的会话。

**参数：**
- `externalSource` (可选): 外部系统来源标识，如 "wechat", "web", "browser"
- `externalConversationId` (可选): 外部系统的会话 ID

**返回：**
- `sessionId`: 会话 ID
- `claudeSessionId`: Claude 会话 ID
- `createdAt`: 创建时间

**典型用法：**
```
当用户首次与系统交互时，创建新会话。
如果用户来自特定渠道（如微信），提供 externalSource 和 externalConversationId 以便后续关联。
```

### get_session
获取指定会话的详细信息。

**参数：**
- `sessionId` (必需): 会话 ID

**返回：**
- `sessionId`: 会话 ID
- `claudeSessionId`: Claude 会话 ID
- `status`: 会话状态 (active/deleted)
- `createdAt`: 创建时间
- `lastActiveAt`: 最后活跃时间
- `externalMappings`: 外部映射列表

**典型用法：**
```
在处理用户请求前，获取会话信息以验证会话是否存在且有效。
```

### list_sessions
列出会话列表，支持过滤和分页。

**参数：**
- `limit` (可选): 返回数量限制
- `status` (可选): 状态过滤 ("active" 或 "deleted")

**返回：**
会话信息数组，每个包含 sessionId, claudeSessionId, status, createdAt, lastActiveAt

**典型用法：**
```
管理界面查看所有活跃会话，或统计会话数量。
```

### delete_session
删除指定会话（软删除）。

**参数：**
- `sessionId` (必需): 会话 ID

**返回：**
- `deleted`: 是否成功删除
- `sessionId`: 被删除的会话 ID

**典型用法：**
```
用户明确要求清除对话历史，或会话长期不活跃需要清理。
```

### find_by_external
根据外部映射查找会话。

**参数：**
- `source` (必需): 外部系统标识
- `conversationId` (必需): 外部会话 ID

**返回：**
- `sessionId`: 会话 ID
- `claudeSessionId`: Claude 会话 ID
- `status`: 会话状态

**典型用法：**
```
当收到来自 IM 模块的消息时，根据外部会话 ID 查找对应的内部会话。
```

### update_session
更新会话信息。

**参数：**
- `sessionId` (必需): 会话 ID
- `claudeSessionId` (可选): 更新 Claude 会话 ID
- `status` (可选): 更新状态

**返回：**
- `sessionId`: 会话 ID
- `claudeSessionId`: Claude 会话 ID
- `status`: 会话状态

**典型用法：**
```
在首次调用 Claude SDK 后，将 claudeSessionId 关联到会话。
```

### submit_message
提交用户消息并获取 AI 响应。

**参数：**
- `sessionId` (必需): 会话 ID
- `message` (必需): 用户消息内容
- `stream` (可选): 是否使用流式响应，默认 false

**返回：**
- `response`: AI 响应内容
- `usage`: Token 使用情况

**典型用法：**
```
用户发送消息后，调用此动作获取 AI 回复。
支持流式响应以提供更好的用户体验。
```

## 参数格式说明

### externalSource
标识外部系统的字符串，建议使用以下规范：
- `wechat`: 微信
- `web`: Web 界面
- `browser`: 浏览器 IM
- `email`: 邮件
- 其他自定义标识

### SessionStatus
- `active`: 活跃状态，可正常使用
- `deleted`: 已删除，不再响应新请求

## 返回结果结构

### 成功响应
```json
{
  "ok": true,
  "data": { /* 具体动作的返回数据 */ }
}
```

### 错误响应
```json
{
  "ok": false,
  "error": "错误信息",
  "code": "ERROR_CODE"
}
```

## 常见错误与排障方式

### SESSION_NOT_FOUND
**原因：** 指定的会话 ID 不存在

**处理方式：**
1. 检查 sessionId 是否正确
2. 检查会话是否已被删除
3. 如需新会话，调用 create_session

### INVALID_EXTERNAL_MAPPING
**原因：** 提供的外部映射参数无效

**处理方式：**
1. 确保 source 和 conversationId 都不为空
2. 检查 source 是否符合命名规范

### CLAUDE_SDK_ERROR
**原因：** Claude SDK 调用失败

**处理方式：**
1. 检查 API Key 配置
2. 检查网络连接
3. 查看详细错误日志
4. 考虑重试机制

### SESSION_EXPIRED
**原因：** 会话已超时

**处理方式：**
1. 检查会话最后活跃时间
2. 如需继续，创建新会话
3. 或更新会话状态为 active

## 模块启停方式

### 启动
```bash
cd Modules/sessions
npm start
# 或
node dist/index.js
```

### 停止
```bash
# 发送 SIGTERM 信号
kill <PID>
# 或使用 Ctrl+C
```

### 重启
```bash
# 模块支持自动重启策略
# 在 module.json 中配置 restartPolicy
```

## 与其他模块的协作方式

### 与 IM 模块协作
1. IM 模块收到用户消息
2. 调用 `find_by_external` 查找会话
3. 如不存在，调用 `create_session` 创建新会话
4. 调用 `submit_message` 获取 AI 响应
5. IM 模块将响应推送给用户

### 与 platform-core 协作
1. platform-core 通过 Message Bus 调用 sessions 模块
2. sessions 模块处理完成后回复 platform-core
3. platform-core 将结果转发给请求方

### 消息格式
模块间通信使用统一的 Message Envelope 格式：
```json
{
  "messageId": "uuid",
  "traceId": "trace-id",
  "fromModule": "platform-core",
  "toModule": "sessions",
  "action": "create_session",
  "payload": { /* 动作参数 */ },
  "replyTo": "platform-core",
  "timeoutMs": 5000,
  "context": {
    "sessionId": "optional-session-id"
  },
  "createdAt": "2026-03-11T12:00:00.000Z"
}
```

## 配置说明

### 必需配置
- `port`: HTTP 服务端口
- `host`: 监听地址
- `dataDir`: 数据目录路径

### 可选配置
- `logLevel`: 日志级别
- `sessionTimeoutDays`: 会话超时天数

### 环境变量
可通过环境变量覆盖配置：
- `SESSIONS_PORT`: 端口
- `SESSIONS_HOST`: 监听地址
- `SESSIONS_DATA_DIR`: 数据目录
- `SESSIONS_LOG_LEVEL`: 日志级别

## 健康检查

### HTTP 端点
```
GET /health
```

### 返回
```json
{
  "ok": true,
  "uptime": 3600,
  "activeSessions": 10,
  "version": "0.1.0"
}
```

## 测试与验证

### 单元测试
```bash
npm test
```

### 集成测试
```bash
# 启动模块
npm start

# 测试创建会话
curl -X POST http://localhost:3010/sessions \
  -H "Content-Type: application/json" \
  -d '{"externalSource": "test", "externalConversationId": "conv-001"}'

# 测试健康检查
curl http://localhost:3010/health
```
