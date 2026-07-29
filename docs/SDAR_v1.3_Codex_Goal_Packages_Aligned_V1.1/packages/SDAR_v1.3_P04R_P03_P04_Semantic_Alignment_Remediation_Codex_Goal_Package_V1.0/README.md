# SDAR v1.3 P04R P03/P04 语义对齐修复任务包

## 定位

```text
Position: P04 → P04R → P05
Class: mandatory_remediation
Formal product package: no
Mandatory release gate: yes
New atomic Goal: no
Remediates: G05 / G06 / G07 / G08
```

P04R 不新增 G23，不改变原 P00～P13 的产品 Goal 映射，也不计入原14个正式产品包数量；但 P05 在 P04R `COMPLETED` 前不得开始。

## 修复目标

1. 将 P03 的生命周期事件与真实作业 Activity 分离；
2. 让 Process Mining 使用稳定 Activity Key；
3. 保留重复、自循环、并行、分支和 Recovery 语义；
4. 修正 Pattern Quality 指标；
5. 让 P04 使用 P03 真实输出而非人工活动 Fixture；
6. 真实执行反过拟合门禁；
7. 对齐 Capability、Fingerprint、DAG、参数、Applicability、Lineage、Recovery；
8. 打通 Candidate Worker → Application Service → P02 Repository → Outbox 产品链；
9. 重新完成 P03/P04 独立 Review 和 `COMPLETED` Handoff；
10. 更新 Shared Registry、Execution Matrix、P05 Consumer 和 P13 Audit。

## 执行模型

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Implementation Agent: 1
Read-only Reviews:
- P03 semantic/process-mining
- P04 compiler/runtime-path
- cross-package contract
```
