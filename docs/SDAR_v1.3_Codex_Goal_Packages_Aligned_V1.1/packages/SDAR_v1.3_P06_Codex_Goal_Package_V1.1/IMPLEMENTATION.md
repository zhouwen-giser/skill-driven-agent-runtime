# P06 Implementation Plan

## G11 Shadow Engine

1. 在正式请求路径旁路投递 Shadow Job，不阻断正式请求，不共享正式事务。
2. 保存 ShadowRun：Artifact/Hash、Formal Refs/Versions、Mode、Status、Timing。
3. 复用 Candidate Compiler 生成 Shadow Decision/Plan，但不提交 Plan、Goal、Attempt、Skill/MCP。
4. 在关键节点执行 Stale Guard。
5. 对比 Criterion、Evidence、Artifact、Risk、Plan Nodes、Model Calls、Cost、Latency、User Patch、Formal Outcome 后验。
6. 建立独立 Queue、Sampling、Backpressure、Degraded Pause、TTL、Dead Letter、Telemetry。
7. 保存不可变 ShadowResult 与 Result Hash。

## G12 Promotion / Revalidation

8. 实现版本化 Promotion Policy，包含最低 Replay/Holdout/Shadow、覆盖率、Unsafe、Counterexample、Risk、Approver Role。
9. 构建 PromotionPackage，聚合 Candidate、P05 Validation、P06 Shadow、Risk、Dependency、Rollback，并保存 Hash。
10. Eligibility 仅输出 eligible_for_review / needs_more_data / ineligible / unsafe。
11. Approval 复用 P02 Auth，要求可信 Operator、Role、Reason、Idempotency、ExpectedVersion、Audit。
12. Activation 单事务：校验 Approval/Hash/Dependency/Status，锁 Artifact Key，CAS Active Pointer，切换旧/新状态，写 Activation/Audit/Outbox。
13. Outbox Consumer 失效并重建 Active Projection；Redis 可丢失且非权威。
14. 监听 Dependency / Drift / Counterexample / Safety / Operator 触发 Revalidation。
15. revalidating 立即从未来 Fast Index 排除，但不干预既有正式 Runtime。
16. 实现 Rollback/Kill Switch 治理结果，不实现 Fast Gateway/Cognitive Fallback Runtime。
17. 完成 Unit/Contract/Integration/E2E/Chaos/Security/Migration/Performance/Review。
