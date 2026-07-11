# ADR-005：PostgreSQL/pgvector + Redis/BullMQ

- 状态：接受
- 日期：2026-07-11

## 背景

项目需要在快速复用开源能力的同时，保持 Goal、Skill、Workflow 和协议边界清晰。

## 决策

PostgreSQL 为系统记录，Redis 仅运行态、队列和缓存。

## 理由

满足查询、向量检索和单机任务调度。

## 后果

- 所有实现与测试必须服从该边界。
- 如需变更，新增 superseding ADR，不直接覆盖历史。
