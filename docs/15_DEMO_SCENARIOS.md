# 开发与验收 Demo 场景

## Demo 1：只读分析主链路

用户请求“查询当前设备并生成状态报告”。Agent 匹配 Skill，生成计划，等待确认，调用两个 Mock MCP 查询工具，输出文本和结构化报告，Goal 达成。

## Demo 2：自动确认 Skill

Skill 设置 `auto_confirm_plan=true`，合法计划直接执行；随后用户修改 Goal，新计划仍必须人工确认。

## Demo 3：Skill 组合

主 Skill 使用 `skill_call` 调用两个子 Skill；执行时读取子 Skill 当前生效版本，分别记录评估和结果。

## Demo 4：计划修改

A2A 用户用自然语言要求修改步骤；管理台可编辑 DSL。修改后校验通过再确认执行。

## Demo 5：输入不足

Agent 先从会话和全局记忆推断；无法可靠推断时进入 input-required，补充后继续。

## Demo 6：暂停与恢复

短暂停从原位置继续；超过 Skill 阈值后重新规划并重新确认。

## Demo 7：Goal Patch

用户变更目标，旧 Workflow、已完成中间结果和确认全部作废；副作用按 Skill 补偿说明生成新的待确认计划。

## Demo 8：Tool 失败与替代 Skill

Tool 失败后异常决策器在系统允许动作内选择调整参数或终止；如选择替代 Skill，生成新计划并重新确认。

## Demo 9：记忆与评估

任务完成后产生多评估器报告，提炼 MemoryItem；后续任务在相应阶段检索命中。

## Demo 10：Skill 演化

多次相似成功 Experience 达到阈值，LLM 归纳 Skill，历史回放 + LLM 补充用例全部通过后自动发布新版本。
