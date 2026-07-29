# P10 Observability Contract

## 1. Trace

每个请求必须有：

```text
gatewayRequestId
requestRef
tenantId
deadline
selected route
artifact refs
formal handoff ref
fallback ref
formal outcome ref
```

## 2. Span

至少：

```text
gateway.precheck
gateway.retrieval
gateway.rule
gateway.template
gateway.formal_handoff
gateway.fallback
gateway.feedback
```

## 3. Metrics

- request count；
- route count；
- deny / confirm / fallback；
- stage latency；
- end-to-end latency；
- deadline exhausted；
- cancellation；
- stale；
- circuit state；
- cache hit；
- formal commit；
- outcome；
- artifact-specific correction / failure。

## 4. Logs

结构化保存：

- Reason Codes；
- Snapshot Hash；
- Adapter Version；
- Feature Flag；
- Circuit State；
- Deadline Remaining。

禁止保存：

- Credential；
- 私有思维链；
- 完整敏感 Prompt；
- 未脱敏 Tool Result。

## 5. Explainability

Console / API 可查看：

```text
why route selected
which artifact
which hard gates passed/failed
why fallback/confirm/deny
which formal authority accepted
what final outcome occurred
```

不展示私有推理链。

## 6. SLO

至少报告：

- Gateway Added Latency P50/P95/P99；
- Fast Path Commit Rate；
- Fallback Success Rate；
- Deadline Miss；
- Error Rate；
- Circuit Open Rate；
- Feedback Lag。

目标值在执行时依据现有基线冻结，不能凭任务包杜撰。
