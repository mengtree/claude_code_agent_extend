# Integration Runtime Rules Reference

## 1. 统一消息 Envelope

模块之间统一通过消息 Envelope 通信，不直接依赖其他模块的内部函数。

推荐结构：

```json
{
  "messageId": "b7a8c7c8-4f7d-4e53-9643-902ef0cdb1d0",
  "traceId": "trace-20260311-0001",
  "fromModule": "im",
  "toModule": "core",
  "action": "submit_user_message",
  "payload": {
    "message": "明天下午三点提醒我交周报",
    "source": "browser-im",
    "conversationId": "conv-001",
    "claudeSessionId": "claude-session-001",
    "workingDirectory": "D:/VSProject/AgentExtend"
  },
  "replyTo": "im",
  "callbackTopic": "module.im.reply",
  "timeoutMs": 30000,
  "context": {
    "sessionId": "session-001",
    "claudeSessionId": "claude-session-001",
    "userId": "user-001",
    "originRequestId": "req-001"
  },
  "createdAt": "2026-03-11T12:00:00.000Z"
}
```

## 2. 字段要求

- messageId: 每次调用唯一
- traceId: 同一业务链路复用，便于追踪
- fromModule 和 toModule: 明确责任边界
- action: 必须与 capability 一致
- payload: 动作输入
- replyTo: 指定结果回给谁
- context: 建议至少包含 sessionId、claudeSessionId、conversationId、userId

sessionId 是业务会话 ID，不等于 claudeSessionId。恢复 Claude 多轮对话时，应显式传递 claudeSessionId。

## 3. 回调约定

统一回调规则：

1. 调用方必须提供 replyTo。
2. 被调用方处理完成后，只回给 replyTo 指定模块。
3. 被调用方不得假设最终用户出口是谁。
4. 跨模块链路必须保留 traceId 和核心 context。

## 4. 数据隔离规范

规则如下：

1. 模块只能写自己的 runtime/data、runtime/logs、runtime/tmp。
2. 模块不得直接写其他模块的数据目录。
3. 模块之间共享信息必须通过统一消息协议完成。
4. 核心维护统一的注册、观测和路由信息。

## 5. 生命周期与守护

模块建议支持以下状态：

- registered
- stopped
- starting
- running
- unhealthy
- restarting
- failed
- disabled

对于 daemon 模块，Manifest 需要明确：

- 是否随核心启动
- 是否异常自动重启
- 重启退避策略
- 最大重试次数

健康检查建议至少支持：

- http
- process
- heartbeat

## 6. 测试与验收

每个模块至少需要验证：

1. Manifest 结构校验
2. Skill 完整性校验
3. 至少一个 capability 的请求与响应契约测试
4. 模块启动与健康检查测试
5. 核心回调链路测试

首批模块建议额外执行端到端推演，例如：

1. 接入模块收到请求
2. 核心编排调用执行模块
3. 执行模块回调核心
4. 核心再回推接入模块

## 7. 常见陷阱

- 让模块直接互调，导致耦合失控
- 让模块自行理解业务，导致智能能力分散
- 配置散落在模块内部，导致无法统一治理
- 共享工作区却共享运行数据，导致相互污染