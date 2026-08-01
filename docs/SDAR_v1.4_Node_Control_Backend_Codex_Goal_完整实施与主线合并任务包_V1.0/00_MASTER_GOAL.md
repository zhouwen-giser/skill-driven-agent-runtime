# 00. SDAR v1.4 Master Goal

## 产品目标

在现有 SDAR Runtime 仓库中交付 v1.4 单节点控制后台，使一个 SDAR 节点具备：

- 独立 Node Control Backend；
- 配置 Revision、Apply/Ack 和 LKG；
- LLM Provider 与 Model Route 治理；
- SMPP Registry Federation；
- MCP Provider Binding；
- Node Capability 唯一业务权威；
- Skill/Plan Template 实现绑定；
- Runtime Capability Readiness；
- Capability-based A2A Exposure；
- Immutable TaskCapabilityBinding；
- 受控 Skill/Artifact 管理适配；
- 遥测出口配置和本地发送状态；
- 未来组织控制平面可消费的 Node Profile/Event Contract；
- 安全、审计、恢复和发布门禁。

## 最终仓库状态

```text
origin/main
└── Merge Commit
    └── feature/v1.4-node-control-backend
        ├── P00 baseline
        ├── P01 foundation
        ├── ...
        └── P14 release qualification
```

## Goal 完成定义

只有同时满足以下条件才能标记 `MERGED`：

- 最新 main 是执行基线；
- P00～P14 全部完成；
- Frozen Design 和 API Contract 可追踪；
- Fresh DB/Migration 门禁通过；
- 完整 `pnpm verify` 通过；
- A2A、Runtime Control、Node Control、Events、Telemetry Export 合同通过；
- PR 指向 main；
- 所有 Required Checks 通过；
- 没有未解决 Merge Conflict；
- PR 已通过 Merge Commit 合并；
- 候选 SHA 是最新 origin/main 的祖先。

创建 PR 但受必需审批阻断时，状态是 `AWAITING_PROTECTED_REVIEW`，不是 `MERGED`。
