# 05. Node Events 合同

## 作用

为未来分层自治组织网络控制平面提供节点变化提示。

## 规则

- At-least-once；
- `eventId` 幂等；
- 同一 Aggregate 使用单调 `aggregateRevision`；
- 事件可以乱序和重复；
- 事件不是资源完整快照；
- 事件不包含 Secret 和内部拓扑；
- 消费者收到事件后重新 GET。

## 主要事件

- node.profile.changed
- node.health.changed
- node.configuration.revision_published/applied/rejected
- node.llm.provider_changed
- node.smpp.source_changed
- node.mcp.provider_binding_changed
- node.skill.version_changed
- node.plan_template.version_changed
- node.capability.version_published/suspended/deprecated/retired
- node.capability.readiness_changed
- node.a2a.exposure_changed
- node.agent_card.activated
- node.task.capability_bound
- node.management_operation.completed
- node.telemetry_export.status_changed
