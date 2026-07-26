# P05 Replay Safety Contract

## 1. No-Physical Provider

Replay Provider 必须：

- 默认拒绝所有副作用；
- 只返回冻结 Fixture / Historical Snapshot；
- 不能访问生产 Credential；
- 不能访问真实设备；
- 不能访问生产 MCP Endpoint；
- 不能创建 Remote Task；
- 不能发送控制事件；
- 不能改变正式 Provider Readiness；
- 不能写正式 Evidence。

## 2. 独立命名空间

Replay 使用独立：

```text
task id namespace
goal id namespace
attempt id namespace
workflow id namespace
idempotency namespace
queue name
database correlation
telemetry dimension
```

不得与正式 Runtime 共享可触发副作用的 ID。

## 3. Side-effect Attempt

任何 Artifact Candidate 在 Replay 中尝试：

- MCP Tool；
- Provider Create Task；
- 设备控制；
- 外部写 API；
- 正式通知；
- 正式 Outcome 写入；

必须立即：

```text
abort case
record critical failure
set unsafe=true
```

不能由 Mock 成功响应后继续。

## 4. Snapshot-only

Replay 所有输入必须来自：

- Historical Snapshot；
- Frozen Fixture；
- Explicit Synthetic Scenario。

不能在 Replay 中读取当前在线 World State 后替换历史事实。

## 5. Header / Context

所有内部调用必须携带：

```text
executionMode=replay
simulationId / replayRunId
tenantId
datasetId
candidateId
```

下游缺少 Replay Awareness 时，默认拒绝。

## 6. Formal State Isolation

Replay 不得创建或修改：

- Formal Goal；
- Interactive Session；
- UserGoalPlan；
- SkillAttempt；
- Workflow Runtime；
- RemoteTaskBinding；
- Outcome；
- Recovery；
- A2A Task State；
- Artifact Active Pointer。
