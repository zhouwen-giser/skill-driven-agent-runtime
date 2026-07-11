# Skill-Driven Agent Runtime — Codex Goal 项目任务包

版本：V1.0  
需求基线日期：2026-07-11

本任务包用于让 Codex Goal 模式在一个空仓库或新建工作树中，自主完成 **Skill-Driven Agent Runtime** 的设计、编码、测试、文档与验收。

## 任务包内容

- `CODEX_GOAL_PROMPT.md`：可直接粘贴到 `/goal` 的总目标。
- `AGENTS.md`：Codex 每次进入仓库都会读取的长期工程约束。
- `PLANS.md`：长任务 ExecPlan 编制与维护规范。
- `execplans/`：从仓库初始化到最终验收的 8 个阶段计划。
- `docs/`：需求、架构、领域模型、协议、数据、测试、风险和开源复用材料。
- `schemas/`：Skill、Workflow DSL、运行事件、记忆和评估报告的起始 JSON Schema。
- `examples/`：Skill、Workflow、A2A 与 MCP Mock 示例。
- `.agents/skills/`：给 Codex 使用的仓库级工程技能。
- `templates/`：ADR、测试报告、开源引入和发布检查模板。
- `third_party/`：开源项目引入清单和版本锁定模板。
- `source/`：原始需求规格说明书与架构图。

## 推荐使用方式

1. 将本目录内容复制到新 Git 仓库根目录。
2. 在隔离容器、虚拟机或专用工作树中启动 Codex。
3. 先执行 `/plan`，要求 Codex阅读 `README.md`、`AGENTS.md`、`PLANS.md` 和 `execplans/EP-00-repo-bootstrap.md`。
4. 审阅计划后，将 `CODEX_GOAL_PROMPT.md` 中代码块内容粘贴给 `/goal`。
5. 通过 `PROJECT_STATUS.md` 和测试报告查看阶段进展；只有验收矩阵全部有证据时才允许完成 Goal。

详细操作见 `QUICK_START_CODEX.md`。

## 权威资料顺序

发生冲突时按以下顺序裁决：

1. `source/Agent通用模板Server需求规格说明书_V1.0.docx`
2. `docs/01_REQUIREMENTS_BASELINE.md` 与 `docs/17_TRACEABILITY_MATRIX.md`
3. 已批准 ADR
4. 当前 ExecPlan
5. 其他说明、示例和参考项目

## 重要边界

本项目不是把八个 Agent 框架拼接成一个系统。唯一工作流运行时是 LangGraph.js；A2A 与 MCP 使用官方 SDK；Goal、Skill、Workflow DSL、评估与演化是自研核心。其他开源项目以源码研究、接口借鉴和 UI 参考为主，任何源码复制都必须先完成许可证与来源登记。
