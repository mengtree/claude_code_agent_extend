# Claude Code Wrapper MVP

这是一个基于 TypeScript 的最小智能体运行时原型，用于验证“通过 TypeScript SDK 二次封装调用 Claude Code 能力”在会话管理、异步任务队列和主动推送场景下的可行性。

## 设计目标

- 当前目录作为 Claude Code SDK 会话的工作区。
- 项目级配置、skills 和本地个性化配置都留在当前应用目录上下文中生效。
- 会话管理层负责本地会话、外部 IM 会话映射、任务队列和会话清理。
- 用户输入先做意图解析，再决定是入队、列队查询、任务移除、中断还是清空会话。
- 后台 worker 顺序消费每个会话的任务，并在完成后主动推送消息。

## 前置条件

- 已安装 Node.js 18+。
- 已安装项目依赖，包含 @anthropic-ai/claude-agent-sdk。
- 本机 Claude Code 已完成登录或具备可用认证状态。

## 安装与构建

```bash
npm install
npm run build
```

## 存储结构

运行后会在当前目录生成 .agent-extend：

- sessions.json：本地会话与外部会话映射。
- incoming-messages.json：已接收但尚未完成意图分析的入站消息队列。
- queues/*.json：每个会话独立任务队列。
- schedules/sessions/{sessionId}/*.json：每个会话独立的定时任务文件。
- push-events.jsonl：主动推送事件日志。

Schedule 文件支持 deliveryMode 字段：默认 queue，表示到期后进入任务队列；如果设为 push，则到期后直接写入主动推送消息，不再创建队列任务。

这些 JSON 文件现在会采用主文件 + 备份文件写入策略；如果主文件缺失或损坏，运行时会优先尝试从 .bak 备份恢复，降低会话和队列状态丢失风险。

Claude Code SDK 默认仍会把可持久化会话保存在用户目录 .claude/projects 下；删除本地 session 时，本原型会同步删除对应的 Claude 会话文件，避免长期积累。对 noSessionPersistence 场景，运行时会通过 SDK 设置 persistSession: false。

## 命令

### 1. 保留原始直连模式

```bash
npm start -- --task "请用三句话总结当前目录下项目的目标"
```

这里的“直连”仍然保留原始命令入口，但底层实现已经从 shell 调 claude 改成 TypeScript SDK query 调用。

### 2. 发送用户消息

```bash
npm start -- send --message "帮我整理一个贵州茅台最新资讯收集方案"
```

返回结果是被动回复，通常会包含：

- 本地 sessionId。
- 识别出的 intent。
- 新加入队列的 taskId。

对于普通入队消息，接口现在可以不返回被动 reply，只返回 session 和 task 信息，后续结果通过主动推送下发。

HTTP 消息入口现在会先把消息持久化到 incoming-messages.json，再立即返回 202；真实意图解析和后续动作会在后台异步完成，并通过 SSE 或 push 日志回传。

### 3. 启动后台 worker

```bash
npm start -- serve
```

只处理当前积压队列并退出：

```bash
npm start -- serve --once
```

### 4. 列出会话

```bash
npm start -- sessions list
```

### 5. 清空会话

```bash
npm start -- sessions clear --session your-local-session-id
```

效果：

- 清空本地队列。
- 清理当前会话绑定的 Claude 本地会话文件。
- 保留本地会话壳，便于继续接入同一个外部会话。

### 6. 删除会话

```bash
npm start -- sessions delete --session your-local-session-id
```

默认会同步删除 Claude 本地持久化文件；如果你只想删除业务层会话映射，保留 Claude 会话文件：

```bash
npm start -- sessions delete --session your-local-session-id --keep-claude
```

### 7. 查看和移除任务

```bash
npm start -- tasks list --session your-local-session-id
npm start -- tasks remove --session your-local-session-id --taskId your-task-id
```

### 8. 查看和移除定时任务

```bash
npm start -- schedules list --session your-local-session-id
npm start -- schedules remove --session your-local-session-id --scheduleId your-schedule-id
```

### 9. 查看主动推送消息

```bash
npm start -- push --session your-local-session-id --limit 20
```

### 10. 启动 HTTP API

```bash
npm run start:http
```

指定端口并禁用内置 worker：

```bash
npm start -- http --port 3100 --no-worker
```

默认情况下，HTTP API 会同时启动内置 worker，收到消息后可以直接异步处理队列。

## 简单 IM 验证页

启动 HTTP 服务后，直接打开：

```bash
http://127.0.0.1:3000/im
```

这个页面会做三件事：

- 通过通用 IM 适配接口发送消息。
- 通过 SSE 订阅当前会话的主动推送。
- 查看当前会话任务，并触发 worker、中断或清空会话。

## 以 HTTP 方式接入 IM

这一节面向企业 IM 网关、Webhook 适配器或你自己的中间层服务。推荐把本项目作为“智能体执行后端”，由你的 IM 接入层负责签名校验、用户鉴权、消息去重和平台回包。

### 整体链路

1. IM 平台把用户消息回调到你的网关服务。
2. 网关服务调用 `POST /adapters/im/messages` 把消息转发给本运行时。
3. 运行时立即返回 `202 Accepted`，表示消息已落盘并进入异步处理流程。
4. 网关服务通过 `GET /events` 订阅主动推送，或通过 `GET /push` 拉取结果。
5. 网关服务把后续结果转发回 IM 平台。

如果你的 IM 平台要求 Webhook 在几秒内响应，这种“先接收、后异步推送结果”的方式更稳妥，因为任务执行、调度和多轮 Claude 会话复用都发生在后台。

### 先启动服务

```bash
npm run start:http
```

如需自定义端口：

```bash
npm start -- http --port 3100
```

默认会同时启动内置 worker。对于 HTTP 接入 IM，这通常就是你想要的模式，因为消息进入后会自动被后台处理。

### 核心入口：发送 IM 消息

```bash
POST /adapters/im/messages
Content-Type: application/json

{
	"source": "wecom",
	"conversationId": "group-001",
	"userId": "zhangsan",
	"message": "帮我整理今天的待办并提醒我晚上 8 点回顾",
	"sessionId": "optional-local-session-id"
}
```

字段说明：

- `source`：外部 IM 来源标识，建议固定使用平台名，如 `wecom`、`dingtalk`、`feishu`。
- `conversationId`：外部会话 ID。单聊可用用户会话 ID，群聊可用群 ID。
- `userId`：可选，用于让你的网关在回推结果时定位具体用户。
- `message`：用户原始消息。
- `sessionId`：可选。如果你已经在业务侧保存了本地 sessionId，可直接带回；否则运行时会根据 `source + conversationId` 自动解析或创建本地会话。

成功响应示例：

```json
{
	"source": "wecom",
	"conversationId": "group-001",
	"userId": "zhangsan",
	"sessionId": "0f7c1d45-4e1c-47f2-b1c7-5a2f2f9f8d2d",
	"intent": "processing",
	"status": "accepted",
	"acceptedMessageId": "a4dbd6f7-c2a8-4cda-9a28-43d6c63b6b11"
}
```

这里有几个容易误解的点：

- `202` 只表示“已接收并入站落盘”，不表示任务已经执行完成。
- `intent=processing` 表示真实意图解析和后续动作将在后台继续处理。
- `reply` 字段可能为空，这在普通入队场景是正常行为，不应视为异常。
- `sessionId` 必须在你的网关侧缓存起来，后续订阅 SSE、查任务、清空会话都要用到它。

### 会话绑定规则

运行时会把 `source + conversationId` 绑定到一个本地 `sessionId` 上，用于复用上下文和底层 Claude 会话。

推荐做法：

- 同一个 IM 群聊始终传同一个 `conversationId`。
- 单聊场景不要混用不同格式的会话 ID。
- 你的网关拿到第一次响应里的 `sessionId` 后，可以同步保存，后续优先显式传回。

当前实现会保证同一个外部会话映射只归属一个本地 session，避免主动推送漂移到旧会话。

### 接收后续结果：SSE 推送

最推荐的方式是由你的网关维持一个 SSE 长连接：

```bash
GET /events?sessionId=0f7c1d45-4e1c-47f2-b1c7-5a2f2f9f8d2d&replay=20
Accept: text/event-stream
```

说明：

- `sessionId` 可选；传入后只接收该会话的推送。
- `replay` 表示连接建立时先回放最近多少条历史 push。
- 事件名固定是 `push`。

SSE 数据示例：

```text
event: push
data: {"id":"msg-001","sessionId":"0f7c1d45-4e1c-47f2-b1c7-5a2f2f9f8d2d","taskId":"task-123","category":"task_completed","content":"调研提纲已整理完成...","createdAt":"2026-03-10T08:00:00.000Z"}
```

字段说明：

- `id`：push 事件唯一 ID，接入侧应按这个字段去重。
- `sessionId`：所属本地会话。
- `taskId`：可选，表示该推送关联的任务。
- `category`：当前可能是 `task_completed`、`task_failed`、`task_cancelled` 或 `system`。
- `content`：最终要转发给 IM 用户的文本内容。

如果你的网关会重连 SSE，建议在本地维护已处理过的 `push.id` 集合，避免重复回推 IM。

### 兜底方式：轮询 push 日志

如果你的部署环境不方便维持 SSE，也可以轮询：

```bash
GET /push?sessionId=0f7c1d45-4e1c-47f2-b1c7-5a2f2f9f8d2d&limit=20
```

这会返回最近的主动推送消息列表。相比 SSE，轮询的实时性和去重成本都更差，所以更适合作为补偿机制，而不是首选通道。

### 查看当前外部会话的任务

```bash
GET /adapters/im/tasks?source=wecom&conversationId=group-001
```

返回示例：

```json
{
	"source": "wecom",
	"conversationId": "group-001",
	"sessionId": "0f7c1d45-4e1c-47f2-b1c7-5a2f2f9f8d2d",
	"tasks": []
}
```

这个接口适合在 IM 侧实现“查看当前排队任务”“显示处理中状态”等辅助能力。

### 常见接入模式

#### 模式一：Webhook 网关 + SSE 回推

最推荐，适合企业微信、飞书、钉钉这类平台：

1. 平台回调消息到你的网关。
2. 网关调用 `POST /adapters/im/messages`。
3. 网关立即向平台返回“已收到”或空成功响应。
4. 网关通过 SSE 收到后续结果，再调用平台发消息接口回推给用户。

#### 模式二：Webhook 网关 + 定时轮询

适合不方便维持 SSE 长连接的场景：

1. 平台回调消息到你的网关。
2. 网关调用 `POST /adapters/im/messages`。
3. 网关记录 `sessionId` 和 `acceptedMessageId`。
4. 后台定时调用 `GET /push` 或 `GET /adapters/im/tasks`，拿到结果后再回推平台。

### 推荐的网关职责

本项目当前只负责“消息接收、会话管理、任务执行和主动推送”，以下能力建议放在你的 IM 网关层实现：

- 验签与来源校验。
- 平台消息 ID 去重。
- 用户、群组、租户等业务身份映射。
- 把 SSE/push 结果转换成对应 IM 平台的发送 API 调用。
- 重试、失败告警和死信处理。

### 一个最小接入流程

```bash
curl -X POST http://127.0.0.1:3000/adapters/im/messages \
	-H "Content-Type: application/json" \
	-d "{\"source\":\"wecom\",\"conversationId\":\"group-001\",\"userId\":\"zhangsan\",\"message\":\"帮我整理今天的日报\"}"
```

拿到响应中的 `sessionId` 后，再订阅：

```bash
curl -N "http://127.0.0.1:3000/events?sessionId=你的-sessionId&replay=20"
```

看到 `event: push` 后，把 `data.content` 转发回你的 IM 平台即可。

## HTTP API

### 健康检查

```bash
GET /health
```

### 发送消息

```bash
POST /messages
Content-Type: application/json

{
	"message": "帮我整理一个调研提纲",
	"sessionId": "optional-local-session-id",
	"externalSource": "wecom",
	"externalConversationId": "group-001"
}
```

### 向指定会话发消息

```bash
POST /sessions/{sessionId}/messages
```

### 通用 IM 适配入口

```bash
POST /adapters/im/messages
Content-Type: application/json

{
	"source": "browser-demo",
	"conversationId": "demo-room-001",
	"userId": "tester",
	"message": "帮我整理一个调研提纲",
	"sessionId": "optional-local-session-id"
}
```

这个接口更适合给外部 IM 网关、Webhook 适配器或浏览器 IM 验证页直接接入。

对于默认 enqueue_task 场景，reply 字段可能为空，此时应等待后续 SSE 或 push 消息，而不是把空 reply 当成错误。

现在这个接口会优先快速返回一个 accepted 响应，包含 acceptedMessageId 和 status=accepted，表示消息已经落盘，后续处理结果请通过 SSE 或 push 获取。

### 按外部对话查看任务队列

```bash
GET /adapters/im/tasks?source=browser-demo&conversationId=demo-room-001
```

这个接口会按 source + conversationId 解析所属本地 session，只返回该外部对话自己的任务队列。

### 列出会话

```bash
GET /sessions
```

### 清空会话

```bash
POST /sessions/{sessionId}/clear
```

### 中断当前任务

```bash
POST /sessions/{sessionId}/interrupt
```

### 删除会话

```bash
DELETE /sessions/{sessionId}
DELETE /sessions/{sessionId}?keepClaude=true
```

### 查看会话任务

```bash
GET /sessions/{sessionId}/tasks
DELETE /sessions/{sessionId}/tasks/{taskId}
```

### 查看和删除会话定时任务

```bash
GET /sessions/{sessionId}/schedules
DELETE /sessions/{sessionId}/schedules/{scheduleId}
```

### 查看主动推送日志

```bash
GET /push?sessionId=your-local-session-id&limit=20
```

### SSE 推送流

```bash
GET /events?sessionId=your-local-session-id&replay=20
```

说明：

- `sessionId` 可选；不传则接收所有会话的推送。
- `replay` 表示连接建立后先回放最近多少条消息。
- 返回格式是 `text/event-stream`，事件名固定为 `push`。

## 当前队列语义

- 队列文件仍按 sessionId 独立存储，外部对话映射不会再被其他 sessionId 抢占。
- 已成功执行完成的任务会立即从队列中移除，不再以 completed 状态继续留在任务列表里。

## 当前定时任务语义

- 定时任务文件位于 .agent-extend/schedules/sessions/{sessionId}/。
- 运行时会在 worker 轮询中自动扫描到期 schedule，并把 content 注入对应 session 的普通任务队列。
- one_time 和 delay 类型会在成功注入队列后保留为 dispatched 状态，等任务执行完成后再删除文件；如果任务失败或取消，则会保留文件并切换为 paused。
- cron 类型在每次触发后会更新 nextRunAt 并保留文件。
- nextRunAt 和 runAt 必须是显式带时区的 ISO 8601 时间；运行时统一转换为 UTC 后与 now.toISOString() 比较。
- cron 使用 5 段表达式，并优先按 schedule.timezone 解释；未提供 timezone 时回退到服务运行机器的时区。
- 目录监听不是唯一触发条件；即使监听缺失，定时扫描仍会生效。

### 手动触发一次 worker 排空

```bash
POST /worker/run-once?pollMs=1000
```

## 输入意图

默认普通输入会被解析成入队任务。当前原型支持这些高频控制意图：

- 查看任务：如“查看任务”“/tasks”。
- 移除任务：如“删除任务 xxx”。
- 中断当前任务：如“中断当前任务”“/interrupt”。
- 清空会话：如“/clear”“清空会话”。

意图解析优先通过无会话持久化的 Claude Code TypeScript SDK 调用完成；失败时会回退到本地规则解析。结构化输出通过 SDK 的 outputFormat json_schema 实现。

## SDK 集成说明

当前版本不再依赖通过 stdin/stdout 包装 claude 进程，而是直接使用 @anthropic-ai/claude-agent-sdk：

- 任务执行通过 query({ prompt, options }) 发起。
- resumeSessionId 会映射到 SDK 的 resume。
- noSessionPersistence 会映射到 SDK 的 persistSession: false。
- jsonSchema 会映射到 SDK 的 outputFormat.type = json_schema。
- 超时和取消通过 AbortController 与 Query.close() 处理。

由于本项目 tsconfig 仍是 CommonJS 输出，而 SDK 包是 ESM，运行时通过动态 import 加载 SDK，以保持现有构建方式不变。

## 外部 IM 会话映射

如果未来接入外部 IM，可以在发送时传入来源和外部会话 ID：

```bash
npm start -- send --message "继续处理昨天的报告" --source wecom --conversation group-001
```

运行时会自动把这个外部会话映射到本地 session。

## 会话与 Claude 会话的关系

- 本地 sessionId 是你的业务层会话标识。
- claudeSessionId 是 Claude Code SDK 返回的底层会话标识。
- worker 在执行任务时会自动复用 claudeSessionId 做多轮上下文续聊。
- 当前实现不是维护一个常驻 SDK 会话对象，而是每次任务发起一次独立 query 调用，并通过 resume 持续同一会话。

## 推荐验证流程

```bash
npm start -- send --message "帮我写一个调研提纲"
npm start -- serve --once
npm start -- push --limit 10
```

## 并发与协调

- 本地存储现在使用目录锁保护 sessions、单会话队列和 push 日志写入。
- JSON 文件改成临时文件写入后原子 rename，减少并发写入时读到半文件的风险。
- worker 领取任务改成原子 claim，避免多个本地 worker 抢到同一个 queued 任务。
- 这套锁是单机文件锁，适合同一台机器上的多进程协作，不适用于分布式多机部署。
- SSE 推送是进程内订阅模型，适合同一 HTTP 服务实例上的浏览器或网关连接。

## 当前边界

- 主动推送目前通过控制台输出和 push-events.jsonl 落盘来模拟。
- 中断能力依赖本地 worker 进程对运行中 SDK 查询的取消控制。
- HTTP API 目前是无鉴权本地接口，更适合内网或本机开发环境。
- 真实企业 IM 的签名校验、回调重试和消息去重还没有实现，当前适合验证接入形态。