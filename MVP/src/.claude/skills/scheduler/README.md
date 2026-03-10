# Scheduler Skill

这个 Skill 用于指导智能体在用户提出定时提醒、预约执行、周期任务时，先获取当前机器的本地时间与时区，再在当前工作区的 .agent-extend/schedules/sessions/{sessionId}/ 下创建对应的 Schedule JSON 文件。

详细字段、路径和示例请查看同目录下的 SKILL.md。