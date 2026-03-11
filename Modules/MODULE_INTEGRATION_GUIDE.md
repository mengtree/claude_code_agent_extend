# 模块接入规范

## 1. 目的

本规范用于定义模块如何接入核心平台，并确保以下目标成立：

- 核心平台可以发现和管理模块
- 核心智能体可以通过 Skill 正确调用模块
- 模块之间通过统一协议通信
- 模块运行数据与配置隔离
- 模块崩溃不会影响核心平台继续工作

本规范还额外约束一条实现边界：模块化平台的所有新代码必须在 Modules 目录下独立开发，MVP 保持不动。

本规范默认与当前 MVP 的核心概念保持一致，优先复用以下现有模型：

- AgentSession
- SessionTask
- ScheduleTask
- IntentParseResult
- PushMessage

这里的“复用”优先指复用设计和数据模型；如果需要复用已有实现，则复制到 Modules 体系内维护，而不是直接改动 MVP。

## 1.1 MVP 冻结要求

后续模块化建设必须遵循以下约束：

1. MVP 目录不作为新平台实现目录。
2. 所有新核心能力、新模块和新共享库都放在 Modules 目录下。
3. 如果需要借用 MVP 中的代码，应复制到 Modules/core 或 Modules/shared 后再修改。
4. 不允许让 Modules 下的模块直接依赖“需要继续演进的 MVP 源文件”。

这样做的目标是保留 MVP 的原型验证价值，同时让新平台拥有清晰、可持续的代码边界。

## 2. 模块目录结构

每个模块建议采用如下目录结构：

```text
Modules/
  <moduleId>/
    module.json
    skills/
      SKILL.md
    src/
    public/
    tests/
    runtime/
      data/
      logs/
      tmp/
```

### 2.1 目录说明

module.json：模块的 Manifest，供核心运行时读取。

skills/SKILL.md：模块的 Skill，供核心智能体读取。

src：模块源码。

public：模块前端页面或静态资源。

tests：模块的单元测试、契约测试和最小集成测试。

runtime/data：模块私有数据目录。

runtime/logs：模块私有日志目录。

runtime/tmp：模块运行过程中的临时文件目录。

## 2.2 平台目录建议

如果开始正式实现模块化平台，建议在 Modules 下采用如下顶层结构：

```text
Modules/
  core/
  shared/
  im/
  schedule/
  config/
```

其中：

core：新的核心平台实现。

shared：仅供 Modules 体系内部复用的共享库。

im、schedule、config：各自独立的外挂模块实现目录。

## 3. Skill 与 Manifest

### 3.1 Skill 的职责

Skill 面向核心智能体，描述模块的业务能力与使用方式。

Skill 至少应包含：

- 模块用途
- 适用场景
- 对外动作列表
- 参数格式
- 返回结果结构
- 典型调用示例
- 常见错误与排障方式
- 模块启停方式

### 3.2 Manifest 的职责

Manifest 面向核心运行时，描述模块的生命周期和管理方式。

Manifest 至少应包含：

- moduleId
- name
- version
- kind
- entry
- startup
- healthCheck
- configSchema
- capabilities
- dataPolicy
- permissions

### 3.3 分离原则

Skill 不应承担进程管理语义。Manifest 不应承担面向智能体的业务说明。

## 4. Manifest 约定

建议的 module.json 结构如下：

```json
{
  "moduleId": "schedule",
  "name": "Schedule Module",
  "version": "0.1.0",
  "kind": "executor",
  "entry": {
    "command": "node",
    "args": ["dist/index.js"]
  },
  "startup": {
    "autoStart": true,
    "daemon": true,
    "restartPolicy": "on-failure"
  },
  "healthCheck": {
    "type": "http",
    "path": "/health",
    "intervalMs": 15000,
    "timeoutMs": 3000
  },
  "configSchema": {
    "type": "object",
    "properties": {
      "pollIntervalMs": { "type": "number" }
    }
  },
  "capabilities": [
    {
      "action": "create_schedule",
      "requestSchema": { "type": "object" },
      "responseSchema": { "type": "object" }
    }
  ],
  "dataPolicy": {
    "isolated": true,
    "dataDir": "runtime/data",
    "logDir": "runtime/logs"
  },
  "permissions": {
    "workspaceRead": true,
    "workspaceWrite": false,
    "network": false
  }
}
```

### 4.1 字段说明

moduleId：模块唯一标识，必须稳定。

name：模块展示名称。

version：模块版本号。

kind：模块类型，推荐取值为 adapter、executor、manager。

entry：模块启动命令。

startup：模块启动策略，定义是否自启、是否守护、是否自动重启。

healthCheck：模块健康检查方式。

configSchema：模块配置声明，用于统一配置注册。

capabilities：模块暴露的动作列表。

dataPolicy：模块数据隔离策略。

permissions：模块运行权限边界。

## 5. 模块分类与能力契约

模块推荐使用以下类型：

- adapter：接入型模块，例如 IM、Webhook、邮件
- executor：执行型模块，例如定时、OCR、文件转换
- manager：管理型模块，例如配置中心、日志中心、模块控制台

每个模块应至少暴露一个 capability。每个 capability 至少包括：

- action
- requestSchema
- responseSchema
- timeoutMs
- idempotent

## 6. 统一消息 Envelope

模块之间不应直接依赖彼此内部函数，而应通过统一消息 Envelope 进行调用。

建议结构如下：

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
    "conversationId": "conv-001"
  },
  "replyTo": "im",
  "callbackTopic": "module.im.reply",
  "timeoutMs": 30000,
  "context": {
    "sessionId": "session-001",
    "userId": "user-001",
    "originRequestId": "req-001"
  },
  "createdAt": "2026-03-11T12:00:00.000Z"
}
```

### 6.1 字段要求

messageId：每次调用唯一。

traceId：同一业务链路复用，便于追踪。

fromModule 和 toModule：用于明确责任边界。

action：能力动作名，必须与 capability 一致。

payload：动作输入。

replyTo：结果应回给哪个模块。

callbackTopic：异步回调主题。

context：公共上下文，建议至少支持 sessionId、conversationId、userId。

## 7. 回调约定

每个模块只需要知道“结果回给谁”，不需要知道整个业务链路。

统一回调规则：

1. 调用方必须提供 replyTo。
2. 被调用方完成处理后，只回给 replyTo 指定模块。
3. 被调用方不得假设最终用户出口是谁。
4. 跨模块链路必须保留 traceId 和核心 context。

这样可以支持如下场景：

- IM 调核心，核心回 IM
- 核心调定时，定时回核心
- 核心调配置，配置回核心

## 8. 配置注册规范

模块如果需要开放配置，必须注册统一配置声明，而不是私自定义配置文件接口。

建议配置分层如下：

- global：核心全局配置
- module：模块级配置
- secret：敏感配置

### 8.1 配置声明要求

每个模块需声明：

- 配置项名称
- 类型
- 默认值
- 是否必填
- 是否敏感
- 描述

### 8.2 配置读取原则

模块通过统一配置接口读取配置，不直接读取其他模块的配置文件。配置中心即使未来做成一个动态模块，也必须保持接口稳定。

## 9. 数据隔离规范

平台允许所有模块在同一工作区内协作开发，但运行数据必须隔离。

规则如下：

1. 模块只能写自己的 runtime/data、runtime/logs、runtime/tmp。
2. 模块不得直接写其他模块的数据目录。
3. 模块之间共享信息必须通过统一消息协议完成。
4. 核心维护统一的注册信息、观测信息与路由信息。

这条规则与 MVP 当前 Storage 的隔离思路一致，应作为后续模块化运行时的基线。

除运行数据隔离外，还应保持代码边界隔离：

1. Modules 体系中的代码修改不得回写到 MVP。
2. 从 MVP 复制出来的实现进入 Modules 后，应视为新代码独立维护。
3. Modules/shared 只存放新平台内部的公共能力，不反向抽回 MVP。

## 10. 生命周期与守护要求

模块建议支持以下状态：

- registered
- stopped
- starting
- running
- unhealthy
- restarting
- failed
- disabled

### 10.1 守护策略要求

对于 daemon 模块，Manifest 需要明确：

- 是否随核心启动
- 是否异常自动重启
- 重启退避策略
- 最大重试次数

### 10.2 健康检查要求

健康检查建议至少支持：

- http
- process
- heartbeat

核心平台应据此决定模块状态，而不是依赖人工判断。

## 11. 核心与模块的职责边界

### 11.1 核心负责

- 理解需求
- 读取 Skill
- 选择模块
- 跨模块编排
- 新模块开发与修复
- 生命周期管理
- 路由、回调、观测与权限控制

### 11.2 模块负责

- 单一职责执行
- 接收核心调用
- 向核心回调结果
- 提供自己的 Skill 和 Manifest
- 维护自身最小闭环

## 12. 与当前 MVP 类型的衔接建议

为降低未来实现成本，建议优先复用现有模型：

- AgentSession：作为跨模块上下文中的 session 主键来源
- SessionTask：作为核心执行任务的基础数据模型
- ScheduleTask：作为定时模块的首个标准执行模块样板
- IntentParseResult：作为核心智能体理解结果模型
- PushMessage：作为核心向接入型模块回推结果的基础消息模型

如果这些模型或实现需要延展，推荐做法是：

1. 在 Modules/core 或 Modules/shared 中创建对应的新版本类型定义。
2. 保持命名和字段尽量兼容，便于迁移。
3. 仅在 Modules 体系内继续迭代。
4. 不直接修改 MVP/src/types.ts 或其他 MVP 源文件。

对于第一版实现，可以采用以下映射：

- IM 模块输入映射到 IncomingMessageRequest 风格结构
- 核心编排后仍以 SessionTask 作为落队模型
- 定时模块继续复用 ScheduleTask 的 queue 和 push 语义
- 最终通知复用 PushMessage 的分类思路

## 13. 典型接入示例

### 13.1 IM 模块

职责：

- 接收外部用户消息
- 把消息交给核心理解
- 接收核心回调并推送给用户

不负责：

- 解析复杂意图
- 规划任务链路
- 直接调度其他业务模块

### 13.2 定时模块

职责：

- 保存调度信息
- 扫描到期触发器
- 按约定回调核心

不负责：

- 解释用户自然语言
- 执行复杂业务逻辑
- 决定最终向哪个外部系统回推

### 13.3 配置模块

职责：

- 提供配置读写接口
- 提供配置管理页面
- 暴露统一配置 schema

不负责：

- 自行决定其他模块行为
- 绕过核心直接修改模块运行状态

## 14. 测试与验证要求

每个模块至少需要提供以下验证：

1. Manifest 结构校验。
2. Skill 内容完整性校验。
3. 至少一个 capability 的请求与响应契约测试。
4. 模块启动与健康检查测试。
5. 核心回调链路测试。

对于首批模块，建议额外做端到端推演：

- IM 创建提醒
- 定时模块触发核心执行
- 核心回推 IM

## 15. 常见陷阱

### 15.1 让模块直接互调

问题：耦合迅速失控，后续无法替换和回滚。

建议：统一走核心编排和消息 Envelope。

### 15.2 让模块自行理解业务

问题：智能能力分散，平台很快失去统一控制。

建议：理解权留在核心，模块只保留确定性职责。

### 15.3 配置散落在各模块内部

问题：后续无法做统一管理与审计。

建议：所有模块统一注册配置 schema。

### 15.4 共享工作区等于共享数据

问题：模块互相覆盖数据，难以定位故障。

建议：共享代码上下文，但隔离运行数据。

## 16. 建议实施顺序

1. 先实现 Module Registry 与 module.json 解析。
2. 在 Modules/core 中建立新的核心骨架，并从 MVP 复制必要能力。
2. 再实现统一消息 Envelope 和回调机制。
3. 再接入 Skill Registry，让核心智能体知道如何调用模块。
4. 再实现统一配置注册表。
5. 最后补守护、观测、控制台和自我迭代链路。

为避免编号歧义，上述顺序实际应理解为：

1. 实现 Module Registry 与 module.json 解析。
2. 在 Modules/core 中建立新的核心骨架，并从 MVP 复制必要能力。
3. 实现统一消息 Envelope 和回调机制。
4. 接入 Skill Registry，让核心智能体知道如何调用模块。
5. 实现统一配置注册表。
6. 补守护、观测、控制台和自我迭代链路。

## 17. 最小落地结论

一个模块只有同时具备以下四类资产，才算真正完成接入：

- Manifest
- Skill
- 可启动的执行入口
- 最小测试

缺少其中任意一类，都会导致平台只能“看见模块”或者“调用模块”，但不能稳定管理模块。