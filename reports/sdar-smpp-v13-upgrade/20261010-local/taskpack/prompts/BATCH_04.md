# Codex 批次 4：W4、W5

在 `zhouwen-giser/skill-driven-agent-runtime` 中执行本包 **W4、W5**，不是重写总架构。

先读仓库 AGENTS.md、PLANS.md、活跃需求/ADR，再读本包 CODEX_GOAL_PROMPT.md、总 ExecPlan、对应工作卡和 contracts。先读取批次 3 的真实交接报告；前置缺口影响当前实现时显式记录，不跳过权威或测试边界。

本批目标：完整轨迹/源时间/确认链、结果判定、恢复迁移、隔离 E2E 和分层交付；现场未授权保持 NOT_RUN。

参考固定 SDAR head `52f54a11a40380f7c73bd9da277d640e49bdfbf7` 和 SMPP `0a4a7c36865d4c9920a4e65857c0903e9ef12533`；实际分支已更新时记录差异并保留已有正确实现。不回退用户工作树，不修改上游或设备，不直连现场，不自动 push/merge/deploy。development/live 保持；发射和独立锁定不得进入允许动作。

沿用现有 Registry、RemoteTaskBinding、事件 inbox、RemoteTaskInputService、governed-control 和 GOWM 存储。每个子任务先最小测试，正式里程碑按仓库当前要求完整 gate；所有新场景要映射真实测试/证据，不靠原专项 CI 推定通过。

结束输出实际代码文件/行为变化、AC 场景状态、命令/exit code/环境/源码 SHA、失败与阻塞、阶段交接和回滚影响。复制 templates/STAGE_HANDOFF.md 填写真实信息；更新 ExecPlan、PROJECT_STATUS、CHANGELOG 和追踪矩阵。没有现场权限不反复请求确认，完成本地可做事项并把现场记 NOT_RUN。
