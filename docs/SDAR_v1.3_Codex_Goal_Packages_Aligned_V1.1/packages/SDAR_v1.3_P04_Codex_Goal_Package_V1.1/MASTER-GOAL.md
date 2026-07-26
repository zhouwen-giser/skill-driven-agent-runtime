# MASTER GOAL：SDAR v1.3 P04

## Goal ID

```text
SDAR-V1.3-P04
```

## 原子 Goal

```text
G07：Pattern Generalization 与 CompiledArtifact Candidate Generator
G08：Plan Template Compiler
```

## 目标

建立：

```text
P03 Workflow Pattern
        |
        v
Pattern Fusion
        |
        v
Generalized Pattern
        |
        v
Artifact Candidate
        |
        v
Plan Template Candidate
```

## 输入权威

P04 只读取：

- P03 ExperienceTrace；
- P03 DiscoveredProcessPattern；
- P03 WorkflowPattern；
- P03 PatternQuality；
- v1.2.3 Task Type；
- v1.2.3 Capability Pattern；
- Capability Summary；
- Goal Contract；
- Accepted Plan；
- Skill Outcome Specification；
- Counterexample；
- P01 Artifact Domain；
- P02 Candidate Repository。

## 输出权威

P04 输出：

```text
Artifact Candidate Fact
Plan Template Candidate Fact
Static Validation Fact
Candidate Lineage
```

这些对象：

- 不可在线执行；
- 不可自动批准；
- 不可激活；
- 不可直接调用 Skill/MCP；
- 只能进入 P05 Replay Validation。

## 完成合同

P04 完成必须同时满足：

- 实例标识被正确抽象；
- Invariant 与 Variable 分离；
- Required / Forbidden Condition 明确；
- Candidate 有完整 Source Lineage；
- Plan Template 节点绑定 Capability，而非 Skill；
- Goal Criterion 被模板节点覆盖；
- Parameter Source 和 Trust Level 明确；
- Recovery 不重放已完成副作用；
- Static Validator 可拒绝非法 Candidate；
- Candidate 默认为不可运行；
- 不修改 P03 Trace / Pattern；
- 不进入 Replay / Shadow / Promotion；
- P05 Handoff 完整。
