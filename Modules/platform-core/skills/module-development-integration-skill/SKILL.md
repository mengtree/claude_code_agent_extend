# Module Development And Integration Skill

## 目的

本 skill 用于指导核心智能体或开发者在 AgentExtend 中设计、开发、接入一个新模块，或审查已有模块是否符合平台规范。

它整合以下三类约束：

- 模块化架构原则
- 模块开发最小工程骨架
- 模块接入平台时的 Skill、Manifest、消息协议、配置与运行时规则

## 何时使用

在以下场景应优先使用本 skill：

- 需要在 Modules 目录下新增一个模块
- 需要把 MVP 中的能力迁移为独立模块
- 需要为模块补齐 module.json、SKILL.md、测试和运行目录
- 需要检查模块是否符合平台接入规范
- 需要定义模块 capability、消息 Envelope 或回调链路

## 核心原则

1. 全局只有一个默认智能核心，复杂理解和跨模块编排都由 core 或 platform-core 承担。
2. 外挂模块只负责单一、确定性的职责闭环，不承担全局理解。
3. 每个模块都必须是独立应用，而不是仓库内部的普通类库片段。
4. 所有新平台代码都放在 Modules 下开发，MVP 保持冻结，不直接演进。
5. 工作区可以统一，但运行数据必须隔离，模块只能写自己的 runtime 目录。
6. 模块间协作通过统一消息协议完成，不直接互调内部实现。

## 执行流程

### 1. 先判断模块类型

根据职责将模块归入以下类别之一：

- adapter: 接入外部事件或外部系统，例如 IM、Webhook、邮件
- executor: 提供确定性执行能力，例如定时、OCR、文件转换
- manager: 提供管理能力，例如配置中心、日志中心、控制台

如果一个候选模块同时承担“理解业务”和“执行动作”，默认拆分，把理解权留给核心。

### 2. 搭建最小目录骨架

每个模块至少应具备：

```text
Modules/<moduleId>/
  module.json
  config.json
  package.json
  tsconfig.json
  src/
  tests/
  runtime/
    data/
    logs/
    tmp/
  skills/
    <moduleId>-skill/
      SKILL.md
```

如果模块包含页面或静态资源，再补 public/。

### 3. 先写 Manifest，再写 Skill

先定义 module.json，让运行时知道如何发现、启动、守护和检测模块；
再定义 SKILL.md，让核心智能体知道模块能做什么、何时调用、如何解释结果。

两者职责必须分离：

- Manifest 面向运行时治理
- Skill 面向智能体调用

### 4. 定义 capability 契约

每个模块至少暴露一个 capability。每个 capability 至少明确：

- action
- requestSchema
- responseSchema
- timeoutMs
- idempotent

命名要反映动作语义，不要使用模糊动作名。

### 5. 统一消息 Envelope

跨模块调用统一使用 Envelope。最少要包含：

- messageId
- traceId
- fromModule
- toModule
- action
- payload
- replyTo
- timeoutMs
- context
- createdAt

其中 sessionId 是业务会话 ID，claudeSessionId 是 Claude 会话 ID，两者不能混用。

### 6. 配置、权限和数据隔离

模块必须声明配置 schema、运行权限边界和数据目录策略。模块不能直接读取其他模块的配置文件，也不能写其他模块的 runtime 目录。

### 7. 补齐验证

模块完成接入前，至少验证以下内容：

- module.json 结构有效
- SKILL.md 信息完整
- 至少一个 capability 的请求和响应契约可跑通
- 模块可启动且健康检查可通过
- 核心到模块再回调核心的链路可验证

## 最小交付物

一个模块只有同时具备以下资产，才算完成规范化接入：

1. Manifest
2. Skill
3. 可启动的执行入口
4. 最小测试

缺少其中任意一项，平台都只能部分识别或部分治理该模块。

## 常见审查结论

### 可以通过

- 模块职责单一
- Manifest 与 Skill 分工清晰
- capability、消息格式、健康检查都可验证
- 运行数据落在本模块 runtime 目录

### 不能通过

- 模块直接互调其他模块内部实现
- 模块自行承担复杂理解与跨模块编排
- 新实现直接改 MVP，而不是在 Modules 中独立维护
- Skill 只有功能描述，没有参数、返回、错误和启停说明
- Manifest 只有入口，没有 capability、healthCheck、permissions 或 dataPolicy

## 使用输出模板

当你用本 skill 设计或评审模块时，建议输出按以下结构组织：

1. 模块目标与类型
2. 职责边界
3. 目录结构
4. Manifest 草案
5. Skill 草案
6. capability 契约
7. 消息 Envelope 与回调链路
8. 配置与权限声明
9. 测试与验收清单

## References

详细规范见以下参考文件：

- [references/architecture-principles.md](references/architecture-principles.md)
- [references/manifest-skill-and-capabilities.md](references/manifest-skill-and-capabilities.md)
- [references/integration-runtime-rules.md](references/integration-runtime-rules.md)