# SDAR v1.2.3 Codex Goal 任务包 V1.0

## 唯一可写仓库

```text
zhouwen-giser/skill-driven-agent-runtime
```

执行时必须从最新 `origin/main` 开始，并验证其历史包含最低祖先：

```text
35cb9277396e0316b1c6b8aac57e6fa69a8a29df
```

该祖先是 2026-07-22 合入 v1.2.2 的主干基线。任务包不允许直接修改 `main`、强推、自动 Merge 或创建 Tag。

## 目标

完成 SDAR v1.2.3：

```text
Capability Cognition
+ Generic Task Understanding
+ Human-in-the-loop Goal/Plan
+ Experience Observation
+ Governed Knowledge Promotion
+ Experience-enriched Planning
```

同时保持：

```text
LangGraph.js                = 唯一 Workflow Runtime
PostgreSQL                  = 唯一持久化权威
Redis/BullMQ                = 可重建异步执行层
SDAR Model Runtime          = 唯一模型调用入口
UserGoalPlanController      = User Goal / A2A Terminal Authority
Experience                  = Advisory Input
```

## Codex 执行入口

1. 将本目录放到 Codex 可读取位置。
2. 先读取仓库自己的 `AGENTS.md`、README、package scripts 和当前架构文档。
3. 再读取：
   - `CODEX-GOAL-PROMPT.md`
   - `MASTER-GOAL.md`
   - `EXECUTION-POLICY.md`
   - `decisions/FROZEN-DECISIONS.md`
   - `SOURCE-REUSE-POLICY.md`
4. 执行 `/plan`，创建并持续维护 `execplans/EP-SDAR-V1.2.3.md`。
5. 按依赖连续完成 G00～G17，不因一个 Goal 完成而结束 Master Goal。
6. 创建并持续更新 Draft PR；不自动 Merge/Tag。

## Goal 依赖

```text
G00
├── G01 → G02
│   └── G03 → G04 → G05 → G06
└── G07 → G08 → G09
                 ├── G10
                 └── G11

G09 + G10 + G11 → G12 → G13 → G14
G02 + G04 + G05 + G06 + G07 + G12 + G14 → G15
G03 + G05 + G08 + G12 + G14 → G16
G00～G16 → G17
```

G01、G03、G07 在 G00 后可以并行；实现顺序由 ExecPlan 根据代码冲突和团队容量细化。

## 包含内容

- 18 个 Goal 文件；
- Master Goal 和执行策略；
- v1.2.2 基线与外部源码复用门禁；
- 冻结决策和验收矩阵；
- ExecPlan、同步状态、阶段报告、阻断和来源接收模板；
- 自检脚本；
- v1.2.3 上位需求、设计、详细方案和复用评估副本。

## 自检

```bash
node scripts/self-check.mjs
```

## 总体完成标准

- G00～G17 全部满足 Goal Completion Contract；
- `pnpm verify` 和新增 v1.2.3 验证全部通过；
- A2A TCK、OpenAPI、Architecture、Migration、Sources、License、SBOM 全绿；
- Experience 失败不阻断 v1.2.2；
- Candidate 默认不影响正式 Planner；
- 只有 Active Knowledge 可注入；
- 高风险知识必须人工批准；
- 不存在 Python Sidecar、文件型知识权威或自动 Skill 发布；
- Draft PR 具备完整证据，工作树干净，不自动 Merge/Tag。
