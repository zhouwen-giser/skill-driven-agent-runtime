# P13 Execution Policy

## 模型与复核

```text
Main: GPT-5.6 Sol Medium
Review A: Architecture / Authority, read-only
Review B: Security / Privacy, read-only
Review C: Operations / Release, read-only
```

复核不得共享主执行的未提交工作区修改。

## 先验证后修复

流程：

```text
run gate
→ preserve failure
→ identify root cause
→ minimal fix
→ focused test
→ full affected gate
→ full verify
→ review
```

禁止先猜测修改再补测试。

## 修复边界

允许修复：

- 真实 Security Blocker；
- 数据一致性；
- Migration；
- Race；
- Recovery；
- Capacity；
- Protocol；
- Evidence；
- Release Automation；
- Compatibility。

禁止借 P13：

- 新增产品 Feature；
- 改写 Artifact 类型；
- 改变 Fast Gateway 路由目标；
- 重写 Planner / Workflow；
- 引入无关框架；
- 大规模格式化仓库；
- 降低测试门禁。

## 事实优先级

```text
Runtime / Database / Test
> Code / DDL
> Commit / Evidence
> PROJECT_STATUS
> PR Description
> Release Narrative
```

## 失败诚实性

任何以下情况必须 `RELEASE_CANDIDATE_BLOCKED`：

- Full Verify 未通过；
- Migration / Upgrade 失败；
- Critical / High Security 未关闭；
- Cross-tenant / Credential 泄漏；
- 双 Authority；
- Artifact 可绕过 Formal Authority；
- Kill Switch / Rollback 不可用；
- 数据删除失败；
- A2A 正式状态被破坏；
- 未解释的 Package Drift；
- 关键测试未运行；
- 性能 / 容量无证据；
- blocking / major Review 未关闭。

## Git / 发布

P13 可以：

- 创建 Hardening 分支；
- 提交；
- Push；
- 创建 / 更新 Draft PR；
- 生成 Release Candidate Artifacts。

P13 禁止：

- Merge；
- Tag；
- GitHub Release；
- Production Deploy；
- 改保护规则；
- Force Push。

## 环境

测试基础设施必须：

- 隔离；
- 可删除；
- 不使用生产凭据；
- 不连接真实物理设备；
- 不破坏用户数据；
- 不留下临时容器 / Volume / 数据库。

## 证据

保留失败与重跑，不得只保留最终绿色日志。
