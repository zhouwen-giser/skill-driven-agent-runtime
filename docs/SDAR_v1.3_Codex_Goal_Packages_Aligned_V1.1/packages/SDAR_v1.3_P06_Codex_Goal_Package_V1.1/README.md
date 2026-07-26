# SDAR v1.3 P06 Codex Goal Package V1.1

## 定位

```text
P06：Shadow / Promotion / Revalidation
原子 Goal：G11 + G12
阶段：Validation / Governance
```

P06 接收 P05 的不可变 Replay Validation Result，在真实流量旁路运行 Candidate，并通过人工审批、CAS 激活和持续 Revalidation 完成 Artifact 生命周期闭环。

```text
Replay Validation
→ Shadow
→ Promotion Package
→ Human Approval
→ Activation
→ Runtime Monitoring
→ Revalidation / Deprecation
```

本任务包不重复携带 v1.3 总体设计材料。

## 执行基线

```text
未来 v1.2.3 完成并冻结后的最新 origin/main
+ P01～P05 已合入
+ P00 = READY_FULL
```

## 模型

```text
GPT-5.6 Sol Medium
主执行 Agent：1
独立只读 Review：必须
```

## 主要交付

- ShadowRun / ShadowResult；
- 正式路径对比；
- 零副作用隔离；
- Stale Version 丢弃；
- Shadow 容量与背压；
- PromotionPolicy / PromotionPackage；
- HumanApproval；
- Approval 与 Activation 分离；
- CAS Active Pointer；
- Activation Outbox；
- Revalidation Trigger；
- Revalidating 降级；
- Deprecation / Rollback / Kill Switch；
- P07 Handoff。

## 严格禁止

Fast Gateway、Artifact Retrieval、Applicability、Template Runtime、Rule Runtime、Case Runtime、Model Cascade，以及 Shadow 的任何真实 Skill/MCP 副作用。
