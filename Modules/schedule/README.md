# Schedule Module

schedule 模块负责统一管理延迟任务与周期任务，并在任务到点后通过统一消息 Envelope 推送给 platform-core 处理。

## 功能

- 支持 delay 延迟任务
- 支持 cron 周期任务
- 记录上次执行时间、下次执行时间、最近错误和最近返回摘要
- 提供独立集成面板，可在随机可用端口启动并注册到 Platform Dashboard
- 提供 HTTP API 和 Message Bus 动作，支持增删改查

## 启动

```bash
cd Modules/schedule
npm install
npm run build
npm start
```

默认 API 地址为 http://127.0.0.1:3014，集成面板端口默认随机分配。

## API

- GET /health
- GET /ready
- GET /schedules
- GET /schedules/:scheduleId
- POST /schedules
- PUT /schedules/:scheduleId
- DELETE /schedules/:scheduleId
- POST /messages

## 调度规则

- delay 任务在成功执行后标记为 completed，并保留执行记录，方便面板查看和手动删除
- cron 任务在成功执行后重新计算 nextRunAt，并继续保持 active
- 执行失败时记录 lastError；cron 任务会自动暂停，等待人工修正后恢复

## 与 platform-core 协作

到点后，schedule 模块会通过 Platform 消息总线向 platform-core 发送现有 submit_user_message 动作。schedule 负责调度与状态推进，platform-core 负责实际 Claude 处理。