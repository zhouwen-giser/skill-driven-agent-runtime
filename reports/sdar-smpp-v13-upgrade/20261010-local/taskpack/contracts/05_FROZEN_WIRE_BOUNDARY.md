# 合同 05：Frozen MCP 公共 wire 边界

以 [S09/S11](../SOURCES.md) 固定提交的实际 schema 为准。下面是字段边界清单，不是新的 API 规范；最终必须由原 adapter 和冻结 schema 测试验证。示例 fragment 不是可直接发送的完整 HTTP 请求。

## 1. 方法与用途

| 方法 | 用途/主要参数 | 约束 |
|---|---|---|
| `server/discover`、`tools/list` | 发现 profile/method/schema | 复用原 Frozen client，不混用 legacy initialize |
| `io.sdar/taskBusiness/context/get` | taskId，分页参数 | 收齐同快照全部页；原样使用 pageCursor |
| `io.sdar/taskBusiness/snapshotParts/get` | taskId、snapshotToken、可选 objectRef/offset/maxBytes | 校验完整内容；objectRef 为 kind/id/revision |
| `io.sdar/taskBusiness/artifacts/get` | taskId、artifactId、指定 revision、按需内容分页 | 本轮业务引用固定版本，不读取“最新”替代旧 ref |
| `io.sdar/businessEvents/listen` | cursor 或 startPosition | 二选一；公开游标，不是 Provider source cursor |
| `tasks/get` | taskId | 原生命周期与 inputRequests 的正式读取 |
| `tasks/update` | taskId、inputResponses | 回答原请求，不新建 Task |
| `io.sdar/taskBusiness/interventions/apply` | schemaVersion、commandId、taskId、executionId、interventionId、guard、input | 不改为私有 REST；同 commandId 不换内容 |
| `tasks/cancel` | 原 taskId | 用原取消路径；ack 不代表已停止 |

## 2. 请求上下文

保持 `Content-Type: application/json`、`Accept: application/json, text/event-stream`、Frozen `MCP-Protocol-Version` 和 method 对齐；`params._meta` 声明实际所需的 Tasks/TaskBusiness/BusinessEvents 扩展，保留已声明扩展。

`MCP-Name` 随既有方法规则生成：任务/业务查询和控制通常为 taskId；tools/call 为工具名；业务事件 listen 不带该头。snapshotParts、相关任务查询等例外必须使用原 client 的具体映射，不写一个“所有 io.sdar 都加 taskId”的笼统判断。

live 头不带 simulation-id，development 凭据按照目标 Runtime 策略省略。不要发送空 Bearer 或伪造 actor 头。凭据版本与原 binding 关联使用仓库实际表示，不硬编码一个假 revision 以满足类型。

## 3. RequiredInput fragment

```json
{
  "taskId": "fixture-task",
  "inputResponses": {
    "fixture-request-key": {"action": "cancel"}
  }
}
```

这只表示 params 的业务部分。真实 request key 来自同一 Task 当前 inputRequests。action=accept 时 content 由当前 inputSchema 决定，不把中文文本自动映射到未发布枚举。`respondedBy`、`actorId`、`expectedRequestRevision` 和本地 intentId 不属于该 fragment 的对外字段。

本地 requestRevision/subject/deadline 校验并不形成跨 HTTP 的原子 compare-and-swap；服务端仍可能因队列期间 supersede 拒绝。必须处理这一竞争，而不是因为本地刚校验过就假定永久有效。

## 4. Intervention fragment 的结构

schemaVersion 使用冻结合同中的 `sdar.runtime-intervention-command/1.0-rc2`。guard 为 semantic，并携带 expectedInterventionRevision 与 expectedEffectivePlanRevision。导航 input 当前由合法 waypoints/density 等原 schema 约束；本包不扩展道路避障算法或设备控制参数。

`receipt.commandId` 应匹配原命令；`durablyAccepted=true` 与 `businessApplied=false` 只证明 Runtime 接收。后续业务确认必须使用当前合同实际暴露的对应关系；不发明查询命令状态的额外 RPC。

## 5. 三类游标不能混用

BusinessEvents 的 streamId/afterSequence 用于公开流恢复；Provider sourceStreamId/sourceSequence 仅作来源追踪；Task observations 的分页 cursor 用于历史查询。snapshot pageCursor/snapshotToken 则仅用于那个冻结快照。任何一个都不能替代其他几类。

## 6. 验证要求

复用原 `smpp-task-business-client.contract.test.ts` 与 `frozen-v1-http.contract.test.ts`，增加 exact payload/header 正反例。新 fixture 的 request/response 必须经固定版本 schema 验证；未验证的自造 JSON 不得成为“上游实现就是这样”的依据。
