# ADR-001：LangGraph.js 作为唯一 Workflow Runtime

- 状态：接受
- 日期：2026-07-11

## 背景

项目需要在快速复用开源能力的同时，保持 Goal、Skill、Workflow 和协议边界清晰。

## 决策

动态 DSL 经自研编译器生成 StateGraph；其他框架只作参考。

## 理由

避免多套状态机、事件和恢复模型冲突。

## 后果

- 所有实现与测试必须服从该边界。
- 如需变更，新增 superseding ADR，不直接覆盖历史。
