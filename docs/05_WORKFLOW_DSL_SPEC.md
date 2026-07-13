# Workflow DSL 规格基线

正式机器 Schema 位于 `schemas/workflow-dsl.schema.json`。

## 设计目标

- LLM 可生成，系统可校验；
- 可序列化、版本化、确认、回放和审计；
- 可编译为 LangGraph.js；
- 不包含任意可执行代码；
- 单次实例执行期间结构不变。

## 节点白名单

- `llm`
- `mcp_tool`
- `result`
- `condition`
- `parallel`
- `loop`
- `subworkflow`
- `human_confirmation`
- `error_handler`
- `skill_call`

## 受限表达式

条件和映射使用 JSON AST，例如：

```json
{
  "op": "and",
  "args": [
    { "op": "exists", "value": { "var": "state.device" } },
    { "op": "eq", "left": { "var": "state.device.online" }, "right": { "const": true } }
  ]
}
```

禁止 JavaScript 字符串表达式、模板执行、`eval`、`Function`、动态 import 和脚本节点。

## 必须校验

1. JSON Schema；
2. workflow/node/edge ID 唯一；
3. entry 与引用存在；
4. 节点配置符合类型；
5. Tool/Skill 已注册且允许；
6. 输入输出映射类型兼容；
7. 图可达、终止路径存在；
8. 循环有 `max_iterations` 且受 Skill/System budget 限制；
9. 并行汇合策略明确；
10. 未确认时不得执行 Tool；
11. result 输出可验证；
12. 无未知字段或危险扩展。

## 自动修正

校验失败时，将结构化错误反馈给原规划模型，在配置次数内生成新修订。自动修正只处理计划生成阶段；最终通过校验的版本作为待确认/已确认计划，不重复请求确认。

## MCP 异常恢复

`error_handler.recoveryOptions` 可声明四类有界恢复：`retry`、`change_arguments`、`alternative_tool`、`invoke_skill`。每个选项必须引用已存在且已校验的节点，并声明 1 到 10 的 `maxAttempts`。改参只能引用同一 Tool 的另一组已通过 Schema 校验的参数，替代 Tool 必须引用不同的已注册 Tool，调用 Skill 必须引用已启用且输入有效的 `skill_call`。

执行异常阶段的 LLM 只能从尚未耗尽的选项和终止中选择，输出的动作与目标必须精确匹配候选。编译后的 LangGraph 只沿不可变图路由并记录恢复计数；LLM 不能即时构造参数、节点或 Tool。完整示例见 `examples/workflow-mcp-recovery.json`。
