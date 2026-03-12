# Schedule Module Skill

## 模块概述

schedule 模块负责管理延迟任务和周期任务。它适合用于提醒、定时巡检、定时分析、周期性 Claude 调用等场景。

## 适用场景

- 需要稍后执行一次任务
- 需要按 cron 周期反复执行任务
- 需要查看任务上次执行时间和下次执行时间
- 需要手动新增、修改、暂停、恢复或删除任务

## 对外动作列表

### create_schedule
创建定时任务。

参数：
- title: 任务标题，可选
- message: 到点后发送给 platform-core 的任务内容，必填
- sourceType: delay 或 cron，必填
- delayMs: 延迟毫秒数，sourceType=delay 时必填
- cronExpression: cron 表达式，sourceType=cron 时必填
- timezone: 时区，可选，cron 推荐填写
- sessionId: 业务会话 ID，可选
- claudeSessionId: Claude 会话 ID，可选
- workingDirectory: Claude 工作目录，可选
- systemPrompt: 系统提示词，可选
- model: 模型名，可选

### list_schedules
列出定时任务，可按状态和类型过滤。

### get_schedule
获取单个定时任务详情。

参数：
- scheduleId: 任务 ID，必填

### update_schedule
更新定时任务。

参数：
- scheduleId: 任务 ID，必填
- 其他字段与 create_schedule 基本一致
- status 可更新为 active、paused、completed、failed

### delete_schedule
删除定时任务。

参数：
- scheduleId: 任务 ID，必填

## 使用建议

- 创建 delay 任务时，优先提供明确的 title，便于面板识别
- 创建 cron 任务时，建议同时传 timezone，避免部署环境时区变化影响执行时间
- 如果 cron 任务执行失败，先查看 lastError，再通过 update_schedule 修改内容并恢复 active

## 执行链路

- schedule 只负责存储、扫描与触发
- 到点后，schedule 通过 Platform 消息总线向 platform-core 发送 submit_user_message
- platform-core 按现有消息处理能力执行任务

## 消息格式

模块间调用使用统一 Message Envelope：

```json
{
  "fromModule": "platform-core",
  "toModule": "schedule",
  "action": "create_schedule",
  "payload": {
    "title": "每日巡检",
    "message": "检查今天的异常日志并输出摘要",
    "sourceType": "cron",
    "cronExpression": "0 9 * * *",
    "timezone": "Asia/Shanghai"
  },
  "replyTo": "platform-core",
  "context": {},
  "createdAt": "2026-03-12T12:00:00.000Z"
}
```