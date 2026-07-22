# Codex Goal 启动提示词

你正在执行一个长期 Codex Goal：完成 `zhouwen-giser/skill-driven-agent-runtime` 的 SDAR v1.2.3 升级。

## 开始动作

1. 拉取最新 `origin/main`，验证历史包含 `35cb9277396e0316b1c6b8aac57e6fa69a8a29df`。
2. 读取仓库 `AGENTS.md`、README、package.json、pnpm workspace、现有 ExecPlan、架构检查、Migration、OpenAPI、A2A TCK、Sources Lock、SBOM 和 v1.2.2 报告。
3. 读取本任务包全部根文件、冻结决策、验收矩阵及 `goals/G00.md`～`G17.md`。
4. 执行 `/plan`，创建 `execplans/EP-SDAR-V1.2.3.md` 和 `reports/goal/sync-state.json`。
5. 创建分支 `feature/v1.2.3-cognitive-planning-runtime`；如仓库规范要求不同命名，记录映射。
6. 先完成 G00，提交、推送并创建 Draft PR；之后按依赖持续完成全部 Goals。

## 执行模式

- 自主完成实现、测试、文档、证据、提交、推送和 Draft PR 更新。
- 每个 Goal 至少一个有意义提交；适合时先增加失败测试再实现。
- 不要反复询问已经冻结的架构决策。
- 遇到局部阻断时记录 Blocker，继续所有不受影响 Goal。
- 网络搜索和读取外部 GitHub 源码只允许用于官方文档、已锁定开源 commit 和依赖验证。
- 可安装完成任务所必需的 Codex Skill，但不得因此新增未经批准的产品运行依赖。

## 不可违反

- 不直接修改 main，不强推，不在已推送提交上 amend，不自动 Merge/Tag。
- 不引入第二套 Agent、Workflow、Memory 或 Python Runtime。
- 不改变 v1.2.2 Goal/Skill/Outcome/Recovery 权威。
- 不保存私有思维链，不让 LLM 直接提交权威状态。
- 不让 Candidate 直接进入正式 Planner。
- 不用 Mock 或 Shadow 结果冒充最终产品证据。
- 不删除失败测试或隐藏失败尝试。

最终只在 G17 所有发布门禁通过后，将 Draft PR 标记为 Ready for Review；仍不 Merge、不创建 Tag。
