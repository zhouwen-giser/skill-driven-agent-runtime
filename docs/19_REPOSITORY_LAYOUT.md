# 目标仓库结构

```text
apps/
  server/                 # 单进程 A2A + management API + worker bootstrap
  console/                # React 管理控制台
packages/
  domain/                 # 领域实体、状态、不变量、错误码
  application/            # use cases / orchestration
  a2a-adapter/            # official SDK isolation
  mcp-adapter/            # official SDK isolation
  model-provider/         # provider and stage binding
  goal-runtime/
  skill-runtime/
  workflow-dsl/
  langgraph-runtime/
  result-processing/
  memory/
  evaluation/
  evolution/
  persistence-postgres/
  runtime-redis/
  observability/
  testkit/
infra/
  docker/
  postgres/migrations/
  mock-mcp/
  mock-model/
docs/
adr/
reports/
third_party/
```

## 依赖方向

```text
apps → application → domain
adapters/persistence/runtime → application/domain interfaces
workflow compiler → workflow-dsl + langgraph adapter
console → management API contracts only
```

Domain 不得依赖 Express、A2A SDK、MCP SDK、LangGraph、数据库、Redis 或前端库。
