# P14 Scope

## 允许修改

```text
operations runbooks
monitoring dashboards as code
alert policies
SLO definitions
incident templates
recovery drill scripts
read-only diagnostic scripts
cost / capacity reports
post-release review reports
continuous improvement backlog
documentation
```

按仓库结构映射：

```text
docs/operations/**
docs/runbooks/**
infra/monitoring/**
infra/alerts/**
scripts/operations/**
tests/operations/**
reports/operations/**
```

## 条件允许修改

仅在发现生产阻断缺陷且用户明确授权时，可进行最小 Hotfix。

Hotfix 必须：

- 单独任务；
- 失败证据；
- 测试；
- 回滚；
- 安全审查；
- 独立 PR；
- 不与 P14 运维文档混成一个无边界提交。

## 禁止修改

- P00～P13 Goal / Package 定义；
- Artifact Domain / Governance 语义；
- Goal / Plan / Workflow / Outcome Authority；
- Gateway 路由顺序；
- Approval / Activation 规则；
- 未授权生产配置；
- Secret；
- 历史 Migration；
- 发布 Tag。
