# SDAR-V1.3-P01

## Goal

建立经验编译运行时的核心领域合同。

## 输入

P00输出：

- 最新main SHA
- v1.2.x Authority Map
- v1.3 Artifact Contract边界

## 输出

包括：

- Artifact Domain Model
- Type Definitions
- Validation Schema
- State Machine
- Architecture Guard

## 核心模型

Artifact类型：

- intent_route
- plan_template
- decision_rule
- case_template
- model_route

生命周期：

discovered
candidate
validating
awaiting_approval
active
revalidating
deprecated
archived
rejected

## 完成标准

后续P02-P10可以引用该Domain。

禁止产生第二套Authority。
