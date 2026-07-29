# P05 Consumer Alignment

P05 必须消费：

```text
WorkflowPattern V1.2
FusedPattern V1.2
GeneralizedPattern V1.2
CandidateStaticValidationResult V1.2
CompiledArtifact V1.1
```

P05 Dataset 必须使用真实 Activity Key，不得将生命周期事件名作为 Plan Step。

所有 CandidateStaticValidationResult V1.2 新增门禁都必须为 true。禁止兼容读取 V1.1 并默认为通过。
