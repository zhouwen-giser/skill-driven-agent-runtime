# SDAR v1.1 MCP Tasks Provider Extension

状态：Phase 6 精确线协议与本地 Mock Provider 合约已验证；外部 Provider 互操作未验证<br>
命名空间：`io.sdar/taskExecution`<br>
依赖协议：官方 `io.modelcontextprotocol/tasks` extension commit `8966bea9c4f4e6d71060cc8284a539086e9e234f`

## 1. 兼容性与能力

Server 在 MCP capability 中声明官方 Tasks extension，并在 Tool `_meta` 中声明 SDAR 执行语义。未声明时，客户端只能按普通同步 Tool 使用；若计划要求 Task 则 fail closed。

客户端使用 ADR-090 锁定的官方 v2 beta.4 自动协商，并保存实际协商的协议修订。`2025-11-25` legacy fallback 连接不得启用 Tasks。冻结扩展草案标注 `2026-06-30`，当前 beta 客户端的 modern fixture 标注 `2026-07-28`；只对精确契约测试覆盖的组合声明兼容，不推断其他 beta/协议修订。

```json
{
  "name": "vehicle_patrol",
  "inputSchema": { "type": "object" },
  "_meta": {
    "io.sdar/taskExecution": {
      "execution": "task_required",
      "availability": "dynamic",
      "supportsScheduling": true,
      "supportsMaxElapsed": true,
      "supportsObservations": true,
      "cancellation": "task_cancel",
      "revision": "1.0"
    }
  }
}
```

字段约束：

```ts
interface McpTaskExecutionSemantics {
  execution: 'synchronous' | 'task_capable' | 'task_required' | 'unknown';
  availability: 'not_supported' | 'dynamic';
  supportsScheduling: boolean;
  supportsMaxElapsed: boolean;
  supportsObservations: boolean;
  cancellation: 'unsupported' | 'cooperative' | 'task_cancel' | 'unknown';
  revision: '1.0';
}
```

未知 revision/enum/额外可执行字段不进入领域；`task_required` 必须与官方 Tasks capability 同时存在。

`task_required` 还是运行时硬约束，不依赖模型是否在 DSL 中重复该声明。若 `mcp_tool.taskExecution` 省略，SDAR 必须从注册 Tool 语义隐式推导 `require_task + availabilityCheck=required`，在计划期检查 availability，并在 `tools/call` 前以解析后的实际参数再次检查。缺少能力、readiness composition、真实 Workflow Definition 或有效确认时不得调用 Provider。

## 2. 官方 Task operations

Adapter 只使用：

```text
tools/call
tasks/get
tasks/update
tasks/cancel
```

不得使用 `tasks/list` 或 `tasks/result`。官方扩展 Task 操作的 Streamable HTTP 请求必须设置：

```text
Mcp-Name: <remoteTaskId>
Mcp-Method: tasks/get | tasks/update | tasks/cancel
```

`tools/call` 返回：

- 普通 `CallToolResult`：同步结果；`isError=true` 是同步业务错误；
- `{ resultType: "task", ...taskHandle }`：Task 已持久创建；
- 其他 discriminator/混合结果：协议错误。

`tasks/get` 返回完整 snapshot，`resultType="complete"`；terminal completed snapshot 带最终 Tool Result。`tasks/update` 和 `tasks/cancel` 是 ack 操作，随后仍由 `tasks/get` 提供权威状态。具体 wire shape 由锁定 schema blobs 的本地校验器定义。

## 3. 调用扩展 `_meta`

Task-capable/required Tool 调用通过 namespaced `_meta` 携带受验证请求；不会把字段平铺到业务 arguments，也不允许业务参数覆盖。

```json
{
  "name": "vehicle_patrol",
  "arguments": { "route": "A" },
  "_meta": {
    "io.sdar/taskExecution": {
      "revision": "1.0",
      "mode": "require_task",
      "timing": {
        "start": {
          "mode": "scheduled",
          "scheduledAt": "2026-07-17T01:00:00.000Z",
          "startToleranceMs": 30000
        },
        "maxElapsedMs": 900000
      },
      "reservationRef": "reservation-123"
    }
  }
}
```

`mode`：`allow_task | require_task`。`require_task` 返回同步结果是 `MCP_TASK_REQUIRED_RESULT_MISMATCH`。`maxElapsedMs=null` 表示无期限；整数必须正数且有实现定义的上限。时间使用 UTC RFC 3339/ISO 8601，拒绝无时区、NaN、负容差和溢出。

## 4. Availability method

自定义方法固定为：

```text
io.sdar/tasks/checkAvailability
```

请求：

```json
{
  "revision": "1.0",
  "requests": [
    {
      "nodeId": "patrol",
      "operationName": "vehicle_patrol",
      "arguments": {
        "unresolved": false,
        "value": { "route": "A" }
      },
      "timing": {
        "start": { "mode": "immediate", "startToleranceMs": 5000 },
        "maxElapsedMs": null
      }
    }
  ]
}
```

计划期部分参数：

```json
{
  "unresolved": true,
  "knownArguments": { "route": "A" },
  "unresolvedPaths": ["$.speed"]
}
```

响应：

```json
{
  "revision": "1.0",
  "results": [
    {
      "nodeId": "patrol",
      "operationName": "vehicle_patrol",
      "availability": "restricted",
      "riskLevel": "high",
      "reasonCode": "RESOURCE_BUSY",
      "description": "vehicle is completing another operation",
      "validUntil": "2026-07-16T22:00:10.000Z",
      "earliestStartTime": "2026-07-16T22:02:00.000Z",
      "nextAvailableWindows": [
        {
          "startTime": "2026-07-16T22:02:00.000Z",
          "endTime": "2026-07-16T22:12:00.000Z"
        }
      ],
      "estimatedDelayMs": 120000,
      "reservationMode": "best_effort",
      "possibleEffects": ["task_pause", "start_rejection"]
    }
  ]
}
```

规则：

- request/results 数量有界，`nodeId + operationName` 一一对应；
- availability 仅 `available | restricted | disabled | unknown`；
- risk 仅 `low | medium | high | critical`；
- restricted 应给 `earliestStartTime` 或非空 windows，并给 `validUntil`；缺失时客户端降级为 unknown/high；
- guaranteed 必须给非空 `reservationRef`；其余模式不得显示已预约；
- windows 必须 start < end、排序、不重叠，所有时间可解析；
- possibleEffects 仅 `task_preemption | task_pause | start_rejection | start_window_missed | deadline_reached | partial_completion`；
- 执行前必须用解析后的完整 arguments 单项刷新；计划快照不是锁。

## 5. Provider observations

官方 Task status 保持 `working | input_required | completed | failed | cancelled`。Provider 内部 substate 只放在 Task `_meta`：

```json
{
  "_meta": {
    "io.sdar/taskExecution": {
      "revision": "1.0",
      "remoteRevision": "42",
      "substate": "paused",
      "eventId": "event-42",
      "observedAt": "2026-07-16T22:03:00.000Z",
      "progress": { "percent": 40 }
    }
  }
}
```

`substate` 仅 `scheduled | queued | running | paused | resuming | stopping`。paused/resuming/progress/heartbeat 不是 Task control status，不触发 Workflow continuation。所有 payload 必须通过有界 JSON Schema，未知 metadata可为审计丢弃但不得改变领域状态。

## 6. Input update

input-required snapshot 必须提供显示问题、响应 Schema/字段和稳定 `remoteRevision`。SDAR 经现有 A2A input 边界收集/验证后发送：

```json
{
  "taskId": "remote-123",
  "inputResponses": { "approval": true }
}
```

这是冻结的官方 `tasks/update` 精确 wire；不得额外发送 `responses` 或 `expectedRevision`。SDAR 在本地 PostgreSQL 中将 A2A 输入响应绑定到已观察到的稳定 `remoteRevision`，并在发出请求前用 CAS 拒绝过期、重复或不匹配的输入。Provider ack 不代表 Task 完成；客户端随后重新 `tasks/get`，不得盲重发或创建新 Task。Provider 若通过后续 snapshot 表明 revision 已变化，以新的权威 snapshot 为准。

## 7. Cancellation

`tasks/cancel` 是协作请求。ack 只能记录 cancel acknowledged，不代表远程状态已是 cancelled。客户端继续 `tasks/get` 到 Provider 返回 cancelled/completed/failed。Provider unreachable 时保留 uncertainty。

## 8. 结构化业务结果

Provider 接纳前拒绝：同步 `CallToolResult.isError=true`，无 remoteTaskId：

```json
{
  "isError": true,
  "structuredContent": {
    "outcome": "admission_rejected",
    "reasonCode": "RESOURCE_UNAVAILABLE",
    "retryable": true
  }
}
```

Task 生命周期结束但业务失败：status=`completed`，final result `isError=true`，`outcome` 仅：

```text
start_window_missed
deadline_reached
partial_completion
business_failure
```

`completed` 仅说明 Task 生命周期结束。Provider 对 `deadline_reached` 必须先停止/隔离底层执行并释放资源。`failed` 用于无法形成最终 Tool Result 的协议/执行设施失败。

## 9. Phase 6 deterministic Mock Provider

仓库内 Provider fixture 暴露 16 个有界、可枚举的验收 Tool；它们用于精确 HTTP/Schema/状态机和应用组合测试，不代表外部 Provider 认证：

| Scenario                        | Deterministic behavior                              |
| ------------------------------- | --------------------------------------------------- |
| `sync_success`                  | 普通同步成功，无 Binding                            |
| `task_success`                  | working → completed success                         |
| `task_business_failure`         | completed + `isError=true` business failure         |
| `task_protocol_failure`         | Provider failed，无法形成 Tool Result               |
| `task_cancelled`                | cancel ack 后由 `tasks/get` 观察 cancelled          |
| `task_input_required`           | 单轮 form input，经 `inputResponses` 更新           |
| `task_multi_input`              | 两个不同 revision 的连续输入轮次                    |
| `task_restricted_accept`        | restricted availability 后确认并接纳                |
| `task_restricted_reject`        | Provider admission rejection，无 remote Task        |
| `task_scheduled_success`        | scheduled/queued/working 后完成                     |
| `task_start_window_missed`      | completed business outcome `start_window_missed`    |
| `task_deadline_reached`         | completed business outcome `deadline_reached`       |
| `task_pause_resume_observation` | paused/resuming 仅观察，不产生 continuation control |
| `task_provider_unreachable`     | 有界 transport failure 后恢复观察                   |
| `task_malformed_response`       | malformed snapshot 被 adapter fail closed           |
| `task_duplicate_terminal`       | 重复 terminal revision/event 幂等去重               |

Adapter/Provider contract suites 同时断言所有 scenario 的 input Schema 有界、方法与 `Mcp-Name`/`Mcp-Method` Headers 精确、availability 一一对应、update/cancel 只 ack、malformed response 拒绝以及 terminal dedupe。完整应用/重启/并行证据由真实 PostgreSQL/Redis 与 loopback HTTP 测试提供；业务资源与时间推进仍是模拟。

## 10. 安全、大小与错误

- Headers、IDs、strings、arrays、objects、depth、payload和result size均采用仓库统一上限或更严格上限；
- 凭据 Header 与 runtime-owned execution-mode Header 的优先级继续遵守 ADR-075；
- live/simulation/historical-replay 显式传播，非 live稳定 ID不可由 Provider覆盖；
- 不落库凭据、authorization、Cookie、私有推理或未清洗 stack；
- Schema/method/capability/revision/transition错误使用稳定错误码，零 Tool 副作用或零 continuation；
- Provider 的 event/revision 只用于幂等与排序，不获得 SDAR Goal/Workflow 权威。

## 11. 变更规则

本扩展任何 wire 变更必须同时更新：本文件、JSON Schema、adapter contract、Mock Provider、OpenAPI示例、OSS/source pin或内部 revision、ADR（若语义变化）和 `docs/17_TRACEABILITY_MATRIX.md`。当前实现复用已合并 hardening lineage 的通用 Tool execution semantics；不得并存两套权威元数据。
