# P14 SLO / Error Budget Contract

## SLI

至少：

- Request Availability；
- Gateway Added Latency；
- Formal Handoff Success；
- Deadline Miss；
- Cognitive Fallback Availability；
- Artifact Active Projection Lag；
- Feedback Lag；
- Queue Recovery；
- Management API；
- SSE Delivery；
- Model Route Budget Compliance。

## SLO

SLO 必须来自：

- P13 Capacity Baseline；
- 实际部署规格；
- 业务批准目标。

不得凭任务包杜撰数值。

## Error Budget

定义：

- Window；
- Allowed Failure；
- Burn Rate；
- Fast Burn；
- Slow Burn；
- Freeze Condition；
- Rollback / Disable Condition。

## Release / Change Freeze

Error Budget 过度消耗时：

- 暂停扩量；
- 暂停新 Artifact Activation；
- 暂停高风险 Model Route；
- 保留 Cognitive Fallback；
- 发起人工审查。

不自动修改生产。
