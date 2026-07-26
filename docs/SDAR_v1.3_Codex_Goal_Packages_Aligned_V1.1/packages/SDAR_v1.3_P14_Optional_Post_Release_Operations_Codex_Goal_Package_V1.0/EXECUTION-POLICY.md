# P14 Execution Policy

## 模型

```text
GPT-5.6 Sol Medium
```

## 非正式扩展原则

P14 不是发布门禁，不得：

- 回写 P13 READY；
- 关闭 P13 Blocker；
- 变更正式包计数；
- 创建 G23；
- 把运维脚本当产品能力。

## 生产动作

任何以下动作必须获得明确人工授权：

- 修改 Feature Flag；
- Kill Switch；
- Rollback；
- Restart；
- Scale；
- Database Operation；
- Queue Purge；
- Credential Rotation；
- Provider Disable；
- Model Route Disable。

没有授权时只生成命令、Runbook 和演练计划，不执行。

## 事实优先级

```text
Production Runtime / Database / Formal Outcome
> Monitoring / Log / Trace
> Incident Record
> Dashboard
> Narrative
```

## 告警

告警必须：

- 有 Owner；
- 有 Severity；
- 有触发阈值；
- 有抑制 / 去重；
- 有 Runbook；
- 有恢复条件；
- 不直接改变业务状态。

## 改进

生产观察形成：

```text
evidence
→ issue / backlog
→ next-version goal package
```

禁止直接在生产分支静默重构。

## Git

可创建 Operations / Runbook 分支和 Draft PR。

禁止自动 Merge / Tag / Release / Deploy。
