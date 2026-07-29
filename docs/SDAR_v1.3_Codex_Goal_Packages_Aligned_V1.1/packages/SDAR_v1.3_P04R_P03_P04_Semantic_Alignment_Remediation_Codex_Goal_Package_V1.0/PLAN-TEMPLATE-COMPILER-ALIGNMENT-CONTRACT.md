# Plan Template Compiler Alignment V1.2

## Node/DAG

- 使用 activityKey 精确 Map；
- 找不到节点必须报错，禁止 `continue`；
- direct/precedes → required edge；
- parallel → 无顺序边 + 稳定 parallel-group constraint；
- conditional → optional edge + condition；
- 无环、无悬空、无重复边。

## Capability

- action/observation/recovery 必须校验当前 Catalog Capability；
- reasoning/verification/human_gate 按正式语义处理；
- `knownCapabilityIds` 必须真实参与；
- 禁止 exact Skill/Provider/MCP。

## Parameter

保留 JSON Schema、Range、Enum、Required、Allowed Sources、Trust Level、Default Policy。

## Applicability

只允许字段根：

```text
request goal world runtime authorization policy
capability readiness environment device
```

禁止历史 Trace ID 和历史 lifecycle event 作为运行时条件。

## Fingerprint

分别计算：

```text
generalizedDefinitionHash
applicabilityHash
requiredCapabilityShapeHash
```

## Recovery/Lineage

Recovery 必须保留 Trigger、Resume、Sequence、Capability 和 bounded patch。Lineage 需追溯 Pattern、Trace，以及可解析的 Episode/Correction。
