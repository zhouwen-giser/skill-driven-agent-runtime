# P06 Acceptance Matrix

1. P00 READY_FULL、P01～P05 Handoff 已验证。
2. ShadowRun/Result Schema 严格、不可变。
3. Shadow 异步、不阻断正式请求、不写正式状态、不调用 Skill/MCP、不发正式通知。
4. 独立 ID/Queue/Telemetry，Stale Version 全面丢弃，Side-effect Attempt 触发 critical。
5. Capacity/Backpressure/Degraded Pause 有界，未执行物理 Outcome 保持 Unknown。
6. PromotionPackage 绑定完整 Evidence Hash；Unsafe 硬拒绝；样本不足 needs_more_data；eligible 只可人工审查。
7. Approval 身份可信、有 Reason，与 Activation 分离；Hash 变化使旧 Approval 失效；Worker/LLM 无法审批。
8. Candidate 不能直接 Active；Activation 事务含校验/CAS/Audit/Outbox；同 Key 单 Active；双激活只成功一个。
9. Redis 非权威，Cache 可重建。
10. Revalidation Trigger 完整；revalidating 从在线索引排除且不能自动恢复；critical 可 Kill Switch。
11. Rollback 只使用有效批准版本；无安全版本时禁用 Compiled Path；Deprecated 不进在线索引。
12. 未实现 Fast Gateway、Retrieval、Applicability、Template/Rule Runtime。
13. Full Verify、安全、并发、Chaos 通过；G11/G12 有独立证据；只读 Review 无未关闭 blocking/major；Draft PR 未 Merge；P07 Handoff 完整。
