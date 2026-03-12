# Manifest Skill And Capabilities Reference

## 1. 推荐目录结构

```text
Modules/
  <moduleId>/
    module.json
    config.json
    package.json
    tsconfig.json
    src/
    public/
    tests/
    runtime/
      data/
      logs/
      tmp/
    skills/
      <moduleId>-skill/
        SKILL.md
```

public/ 不是强制项；只有页面或静态资源模块才需要。

## 2. Manifest 的职责

Manifest 面向核心运行时，描述模块的治理信息，至少应包含：

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

## 3. 推荐 Manifest 结构

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
      "responseSchema": { "type": "object" },
      "timeoutMs": 30000,
      "idempotent": false
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

## 4. Skill 的职责

Skill 面向核心智能体，至少应说明：

- 模块用途
- 适用场景
- 对外动作列表
- 参数格式
- 返回结果结构
- 典型调用示例
- 常见错误与排障方式
- 模块启停方式

Skill 不应承担进程管理细节；这部分属于 Manifest。

## 5. capability 约定

每个 capability 至少包含：

- action
- requestSchema
- responseSchema
- timeoutMs
- idempotent

能力动作命名应直接表达结果，例如：

- create_schedule
- submit_user_message
- query_session
- render_report

避免使用 doTask、handleRequest、processData 这类模糊名称。

## 6. 配置声明要求

模块需要开放配置时，必须声明统一配置 schema，而不是随意扩展私有接口。每个配置项至少应包含：

- 名称
- 类型
- 默认值
- 是否必填
- 是否敏感
- 描述

## 7. 最小接入交付物

一个模块完成接入时，至少应具备：

1. module.json
2. skills/<moduleId>-skill/SKILL.md
3. 可运行入口
4. tests 中的最小验证