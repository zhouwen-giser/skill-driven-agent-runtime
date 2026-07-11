# ADR-007：单进程模块化单体技术栈基线

- 状态：接受
- 日期：2026-07-11

## 背景

项目需要在快速复用开源能力的同时，保持 Goal、Skill、Workflow 和协议边界清晰。

## 决策

Node.js 20+、pnpm workspace 和 strict TypeScript 作为统一基线；后端保持单进程模块化单体。Express、React/Vite/React Flow 与 Drizzle 仍须在各自首次引入前完成精确版本 OSS Intake 和兼容性验证。

## 理由

最大化 A2A SDK 兼容和首版交付速度。

## 后果

- 所有实现与测试必须服从该边界。
- 如需变更，新增 superseding ADR，不直接覆盖历史。
- 根门禁通过 `pnpm verify` 聚合格式、lint、typecheck、分层测试和 build；每个后续 EP 在同一入口增加对应 integration/contract/e2e/smoke gate。
