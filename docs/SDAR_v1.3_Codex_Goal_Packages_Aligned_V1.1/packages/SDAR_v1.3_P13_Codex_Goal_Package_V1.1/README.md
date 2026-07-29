# SDAR v1.3 P13 Codex Goal Package V1.1

## 任务定位

```text
P13：Hardening、Release 与最终一致性审计
原子 Goal：G22
阶段：Hardening / Release
```

P13 是 SDAR v1.3 十四个正式任务包中的最后一个。它不再引入新的产品能力，而是对 P00～P12 的完整实现进行：

```text
Architecture Freeze
Authority Audit
Security Hardening
Capacity / Performance
Recovery / Chaos
Migration / Upgrade
Protocol / API / Console Verification
Rollout / Rollback
Release Evidence
14 包最终偏移检查
```

本任务包不重复携带此前已经打包的 v1.3 总体设计材料。

## 执行基线

真实执行基线必须满足：

```text
未来 v1.2.3 完成并冻结后的最新 origin/main
+
P01～P12 全部已合入
+
P00 = READY_FULL
```

P13 不得基于尚未合并的零散功能分支签发发布结论。

## 执行模型

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Implementation Agent: 1
Independent Review Agents:
- Architecture / Authority Review
- Security / Privacy Review
- Operations / Release Review
```

复核 Agent 只读，不得并行修改仓库。

## P13 主要交付

- v1.3 Final Architecture Map；
- Authority Inventory；
- Duplicate Authority Scan；
- Full Verification；
- Full Migration / Upgrade / Rollback；
- Security / Privacy / Tenant Audit；
- Capacity / Performance / SLO；
- Chaos / Recovery / Redis Rebuild / PostgreSQL Restart；
- Artifact Kill Switch / Rollback Drill；
- A2A TCK / OpenAPI / Console / SSE；
- Feature Flag / Canary / Rollout Plan；
- Rollback Plan；
- Release Candidate Report；
- SBOM / License / Source / Reproducibility；
- Final Known Limitations；
- P00～P13 Cross-package Drift Audit；
- Release Handoff。

## 不属于 P13

```text
新增 Artifact Type
新增 Runtime 路径
修改产品目标
大规模重构
自动 Merge
自动 Tag
自动发布生产
绕过未通过门禁
用文档掩盖失败测试
```

P13 可以修复 Hardening 阻断问题，但每项修复必须最小、可测试、可回滚，并重新运行受影响的全量门禁。
