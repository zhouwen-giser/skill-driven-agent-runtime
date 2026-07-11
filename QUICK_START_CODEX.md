# Codex Goal 启动指南

## 1. 环境准备

推荐在隔离容器或专用工作树中运行。Codex Goal 适合有明确终点、测试面和约束的长任务；本仓库已经提供这些材料。

建议权限：

- 常规：`workspace-write` + `on-request`，网络只允许 npm、GitHub 和项目明确依赖域名。
- 高自主：仅在一次性容器或隔离虚拟机中使用 `workspace-write` + `never`；不要给予宿主机全盘权限。

Codex 需要安装依赖和读取开源仓库时必须有受控网络访问。

## 2. 启动

在仓库根目录启动 Codex，然后先进入规划模式：

```text
/plan 阅读 README.md、AGENTS.md、PLANS.md、docs/、execplans/EP-00-repo-bootstrap.md 和 source/需求规格说明书。形成第一个可执行计划，先做兼容性与许可证验证，不要跳过架构基线。
```

计划合理后，打开 `CODEX_GOAL_PROMPT.md`，将其中完整 Goal 粘贴到：

```text
/goal <完整目标文本>
```

## 3. 运行期间

- 查看当前目标：`/goal`
- 暂停：`/goal pause`
- 恢复：`/goal resume`
- 需要纠偏时使用 steer，而不是不断重写总目标。
- 每完成一个 EP，Codex 必须更新 `PROJECT_STATUS.md`、测试报告、需求追踪矩阵和 ADR。

## 4. 不允许 Codex 自行宣布完成的情况

以下任一项存在时，Goal 不得完成：

- 需求追踪矩阵仍有 `未实现`、`无测试` 或 `无证据` 项；
- A2A 1.0.1 契约测试未通过；
- Skill 注册、Schema 生成、Workflow DSL、LangGraph 编译、计划确认、MCP 调用和 Goal 评估主链路未通过端到端测试；
- 控制台核心页面只是静态 Mock；
- 引入源码没有许可证来源记录；
- lint、typecheck、unit、integration、e2e 或 build 有失败；
- 关键限制被规避，例如动态执行 LLM 生成的 TypeScript、引入第二套工作流运行时、业务层直接依赖 A2A SDK 类型。

## 5. 遇到阻塞

Codex只有在以下情况下停止并请求用户输入：

- 必需的模型或 MCP 凭据不存在，且无法用 Mock 完成验证；
- A2A 官方 TypeScript SDK 无法满足 1.0.1 且没有合理适配方案；
- 需求之间存在不可同时满足的矛盾；
- 需要许可证或商业授权决策；
- 环境不允许安装或启动必要基础设施。

阻塞报告必须包含：已经尝试的路径、命令与证据、失败原因、可选方案和最小解锁输入。
