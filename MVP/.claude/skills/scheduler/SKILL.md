---
name: scheduler
description: 当用户需要定时提醒、预约执行或周期性任务时使用；负责按本地 Schedule 模型和路径约定创建或更新调度文件。
---

# Scheduler Skill

## 适用场景

当用户表达以下需求时使用本 Skill：
- 在某个时间点执行任务
- 若干分钟或若干小时后提醒/执行
- 每天、每周、每月重复执行
- 查询当前会话的所有定时任务
- 取消已创建的定时任务

## 核心职责

你的职责不是立即执行任务，而是为当前会话创建或更新一个 Schedule 文件。

在解析任何定时语义之前，必须先获取当前机器的本地时间和本地时区，并以该本地时间作为“现在”的基准；不要直接依赖模型记忆里的当前日期，也不要自行假设时区。

创建完成后，Agent 运行时会自动扫描这些文件：
- 到期后根据 deliveryMode 决定是向关联 session 的任务队列注入待办，还是直接推送提醒消息
- 一次性任务和延迟任务在成功注入后会保留到任务真正执行完成，再删除对应文件
- 直接推送型的一次性任务和延迟任务在成功推送后立即完成；周期任务在每次触发后更新 nextRunAt 并保留文件

## 存储路径

所有 schedule 文件必须写入当前工作区下的以下目录：

.agent-extend/schedules/sessions/{sessionId}/{scheduleId}.json

要求：
- 每个 session 独立一个子目录
- 每个 schedule 独立一个 JSON 文件
- scheduleId 必须全局唯一，推荐使用 UUID
- 文件名只使用 scheduleId，不包含其他信息

## Schedule JSON 模型

```json
{
  "id": "0d2f3b2f-6577-4cda-9d2f-4f5c1b2148f9",
  "sessionId": "{sessionId}",
  "content": "提醒我检查今天的日报和未回复消息",
  "summary": "检查日报提醒",
  "sourceType": "one_time",
  "deliveryMode": "push",
  "status": "active",
  "createdAt": "2026-03-10T09:30:00.000Z",
  "updatedAt": "2026-03-10T09:30:00.000Z",
  "nextRunAt": "2026-03-10T10:00:00.000Z",
  "runAt": "2026-03-10T10:00:00.000Z"
}
```

字段说明：
- id: schedule 唯一 ID
- sessionId: 关联的本地会话 ID
- content: 到期后真正写入任务队列的原始待办内容
- deliveryMode: queue | push；queue 表示触发后进入任务队列执行，push 表示直接推送消息后完成
- summary: 简短摘要
- sourceType: one_time | delay | cron
- status: active | paused
- createdAt: 创建时间，ISO 8601
- updatedAt: 更新时间，ISO 8601
- nextRunAt: 下一次触发时间，必须是带时区的 ISO 8601 时间，例如 2026-03-10T10:00:00.000Z
- runAt: 一次性/延迟任务的目标执行时间，可与 nextRunAt 相同；同样必须显式带时区
- cronExpression: 周期任务使用的 5 段 cron 表达式，例如 0 9 * * 1-5
- timezone: cron 的解释时区；如果省略，则回退到服务进程所在机器的时区

## 构造规则

1. 在处理“10 分钟后”“明天上午 9 点”“下周一”这类时间表达前，必须先获取本地当前时间；所有相对时间、自然语言日期和“今天/明天/今晚”等表达都以这个本地时间为基准解释。
2. 如果用户是“10 分钟后提醒我”，先换算出绝对时间，再写入：
   - sourceType 使用 delay
  - 纯提醒且不需要后续执行时，deliveryMode 使用 push
   - runAt 和 nextRunAt 都写为换算后的 ISO 时间
3. 如果用户是“明天上午 9 点提醒我”，写入：
   - sourceType 使用 one_time
  - 纯提醒且不需要后续执行时，deliveryMode 使用 push
  - runAt 和 nextRunAt 写为显式带时区的目标时间
4. 如果用户是“每天早上 9 点提醒我”，写入：
   - sourceType 使用 cron
  - 纯提醒且不需要后续执行时，deliveryMode 使用 push
   - cronExpression 写成 0 9 * * *
  - timezone 写成明确时区，例如 Asia/Shanghai
  - nextRunAt 写成下一次即将触发的 UTC 时间
5. createdAt 和 updatedAt 也应基于刚获取到的本地当前时间生成对应的带时区时间，再统一写成 ISO 8601；不要留空，也不要使用与当前本地时间明显不符的固定值。
6. content 必须是未来要执行的真实任务内容，不要写成“创建一个提醒”这类元描述，如果是任务类需求，content 应该包含足够信息让后续执行的 Worker 能直接理解要做什么；如果是纯提醒类需求，content 也应该写成用户最终会看到的提醒消息，而不是模糊的“这是一个提醒”。
7. summary 保持简短，适合队列列表展示

## 执行步骤

### 创建定时任务

1. 确认当前 local sessionId
2. 先获取当前机器的本地时间和本地时区
3. 根据用户意图判断是 one_time、delay 还是 cron
4. 基于本地当前时间计算 nextRunAt
5. 构造完整 JSON
6. 写入 .agent-extend/schedules/sessions/{sessionId}/{scheduleId}.json
7. 只需要简单的告诉用户已经设置好了提醒，不要重复输出 schedule 的全部细节，也不要输出文件路径等实现细节，用户不关心这些。

### 查询定时任务

1. 使用 `.claude/skills/scheduler/scripts/main.py list` 命令列出当前会话的所有定时任务
2. 返回任务列表，包含任务ID、摘要、状态、下次执行时间等关键信息
3. 如果用户想查看某个任务的详细信息，使用 `get --id {scheduleId}` 命令

### 取消定时任务

1. 使用 `.claude/skills/scheduler/scripts/main.py list` 列出当前会话的所有定时任务
2. 根据任务摘要或任务ID识别要取消的任务
3. 如果不确定，可以先读取任务详情确认
4. 使用 `.claude/skills/scheduler/scripts/main.py cancel --id {scheduleId}` 命令删除任务文件
5. 确认任务已被取消

## 安全与边界

- 不要修改其他 session 的 schedule 目录
- 不要把 schedule 写入 skills、src 或其他业务目录
- 不要在未获取本地当前时间的情况下直接解释“现在、稍后、今晚、明天、下周”等时间表达
- 不要省略 sessionId、content、summary、sourceType、nextRunAt
- 不要在需要直接提醒的场景漏写 deliveryMode: push；未填写时系统会按 queue 处理
- 不要写不带时区的 nextRunAt 或 runAt，例如 2026-03-10T10:00:00
- 不要为一次性任务重复创建多个含义相同的文件，除非用户明确要求
- 周期任务必须提供 cronExpression
- 取消任务时，先列出任务让用户确认，再执行删除操作

## 示例

### 一次性任务

```json
{
  "id": "1aa8d509-e0fa-4fd2-89b2-83ba4b72db5b",
  "sessionId": "demo-session",
  "content": "提醒我给客户发送本周进度总结",
  "summary": "发送进度总结",
  "sourceType": "one_time",
  "deliveryMode": "push",
  "status": "active",
  "createdAt": "2026-03-10T01:00:00.000Z",
  "updatedAt": "2026-03-10T01:00:00.000Z",
  "nextRunAt": "2026-03-10T02:00:00.000Z",
  "runAt": "2026-03-10T02:00:00.000Z"
}
```

### 周期任务

```json
{
  "id": "3ba33a73-ead0-4dc5-b6b8-1f1884e77a39",
  "sessionId": "demo-session",
  "content": "整理昨天未关闭的问题并输出跟进清单",
  "summary": "问题跟进清单",
  "sourceType": "cron",
  "deliveryMode": "queue",
  "status": "active",
  "createdAt": "2026-03-10T01:00:00.000Z",
  "updatedAt": "2026-03-10T01:00:00.000Z",
  "nextRunAt": "2026-03-11T01:00:00.000Z",
  "cronExpression": "0 9 * * *",
  "timezone": "Asia/Shanghai"
}
```