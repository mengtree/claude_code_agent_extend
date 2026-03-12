# Module Skills Discovery Skill

## 目的

本 skill 用于指导智能体在 AgentExtend 工作区中扫描 Modules 目录下各模块的 skills 文件夹，收集所有模块对外提供的 skill 文档，并形成可用 skill 清单。

## 何时使用

在以下场景应使用本 skill：

- 需要获取当前平台所有可用模块 skill
- 需要让核心智能体决定应读取哪些模块 skill
- 需要检查某个模块是否已经提供 skill 文档
- 需要汇总模块能力目录或生成 skill registry

## 扫描目标

扫描根目录固定为：

```text
Modules/
```

扫描规则固定为：

```text
Modules/<moduleId>/skills/*/SKILL.md
```

其中：

- <moduleId> 表示模块目录名
- skills 下每个子目录视为一个独立 skill 包
- 只有名为 SKILL.md 的文件视为正式 skill 文档

## 执行步骤

### 1. 先扫描所有 skill 文档

递归扫描 Modules 下所有符合以下模式的文件：

```text
Modules/**/skills/**/SKILL.md
```

如果某模块没有 skills 目录，视为该模块暂未提供 skill，不报错。

### 2. 从路径提取模块与 skill 标识

对每个命中的 SKILL.md，从路径中提取：

- moduleId: Modules 下的一级模块目录名
- skillFolder: skills 下的直接子目录名
- skillPath: SKILL.md 相对路径

例如：

```text
Modules/platform-core/skills/platform-core-skill/SKILL.md
```

应提取为：

- moduleId: platform-core
- skillFolder: platform-core-skill
- skillPath: Modules/platform-core/skills/platform-core-skill/SKILL.md

### 3. 读取 skill 主文档

对每个 SKILL.md，至少读取以下信息：

- 标题
- 目的或模块概述
- 何时使用或适用场景
- 是否引用 references 或其他补充文档

如果 SKILL.md 明确引用 references 文件夹，应继续按需读取对应参考文档。

### 4. 形成可用 skill 清单

输出时至少包含：

- moduleId
- skill 名称或标题
- skillFolder
- skillPath
- skill 的一句话用途摘要

### 5. 按用途而不是按文件名做解释

汇总结果时，不要只罗列文件路径；应说明每个 skill 解决什么问题，以及它适合在哪类任务中被调用。

## 过滤规则

- 只把 Modules 下的 skill 纳入模块 skill 清单
- 不把 README.md、CONFIG.md、架构文档当作 skill
- 不把 runtime、tests、public 下的文档当作 skill
- 不把 skills 目录中非 SKILL.md 的说明文件直接当成 skill 主入口

## 输出模板

建议输出格式如下：

1. 总计发现多少个 skill
2. 每个 skill 的来源模块
3. 每个 skill 的用途摘要
4. 哪些 skill 还带有 references，可在需要时继续展开读取

示例：

```text
发现 3 个模块 skill。

- platform-core / platform-core-skill
  用途：提供平台核心智能查询、流式响应、会话与健康检查能力说明
  路径：Modules/platform-core/skills/platform-core-skill/SKILL.md

- platform-core / module-development-integration-skill
  用途：指导如何按平台规范开发和接入新模块
  路径：Modules/platform-core/skills/module-development-integration-skill/SKILL.md

- sessions / sessions-skill
  用途：提供会话管理、消息提交和外部映射查询能力说明
  路径：Modules/sessions/skills/sessions-skill/SKILL.md
```

## 注意事项

1. 技能发现是平台入口能力，优先做全量扫描，再决定读取哪些 skill 细节。
2. 如果后续新增模块，重新扫描 Modules 即可，不要维护手写静态列表。
3. 如果同一模块下存在多个 skill，应全部保留，不要默认只取一个。
4. 如果 skill 引用了 references，主文档用于快速判断，references 用于深读细则。

## 推荐结论

当用户要求“查看有哪些模块能力”“列出当前可用 skill”“让核心知道能调用哪些模块”时，先执行本 skill，再基于发现结果选择后续要读取的具体 skill。