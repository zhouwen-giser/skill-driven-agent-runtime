# P13 Capacity / SLO Contract

## 工作负载

至少覆盖：

- Request Entry / Fast Gateway；
- Exact / Semantic Retrieval；
- Rule；
- Template；
- Formal Handoff；
- Cognitive Fallback；
- Case；
- Model Route / Cascade；
- Feedback；
- Management API；
- Console；
- SSE；
- Shadow；
- Replay；
- Compiler Workers。

## 数据规模

根据目标场景建立至少三级：

```text
baseline
expected
stress
```

并报告：

- Active Artifact；
- Candidate；
- Experience Trace；
- Replay Case；
- Concurrent Request；
- Concurrent Operator；
- SSE Client；
- Queue Lag；
- Model Invocation；
- Tenant 数量。

## SLO

冻结：

- Availability；
- Error Rate；
- P50/P95/P99；
- Deadline Miss；
- Fast Path Added Latency；
- Formal Handoff；
- Fallback；
- Feedback Lag；
- Revalidation Lag；
- Console Load；
- Management Query；
- SSE Delivery；
- Queue Recovery。

## 资源

报告：

- CPU；
- Memory；
- Database Connection；
- Lock；
- Query；
- Index；
- Redis；
- Queue；
- Network；
- Token / Cost；
- Storage Growth。

## 背压

验证：

- Gateway Load Shedding；
- Shadow Pause；
- Replay / Compiler Low Priority；
- Model Rate Limit；
- SSE Slow Consumer；
- Feedback Queue；
- Management Rate Limit。

## 失败标准

- 正式 Runtime 被后台任务饿死；
- 无界队列；
- 无界内存；
- DB 锁阻塞；
- Deadline 后提交；
- 无 Cognitive Fallback 余量；
- 无容量证据。

任何一项未解决：

```text
RELEASE_CANDIDATE_BLOCKED
```
