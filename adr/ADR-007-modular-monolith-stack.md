# ADR-007：单进程模块化单体技术栈基线

- 状态：提议，EP-00确认
- 日期：2026-07-11

## 背景

项目需要在快速复用开源能力的同时，保持 Goal、Skill、Workflow 和协议边界清晰。

## 决策

Express + TypeScript 后端，React/Vite/React Flow 控制台，Drizzle 候选 ORM。

## 理由

最大化 A2A SDK 兼容和首版交付速度。

## 后果

- 所有实现与测试必须服从该边界。
- 如需变更，新增 superseding ADR，不直接覆盖历史。
