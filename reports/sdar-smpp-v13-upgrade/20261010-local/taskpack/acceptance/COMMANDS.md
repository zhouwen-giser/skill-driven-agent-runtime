# 验证命令与执行条件

## 1. 工具链

[固定 package.json（S05）](../SOURCES.md) 声明 `pnpm@11.7.0`，Node engines 为 `>=20.19.0`。W0 核对当前仓库和 CI 的实际 Node 版本，沿用它，不照搬 SMPP 仓库的工具版本，也不自动升级依赖。

```bash
node --version
pnpm --version
pnpm install --frozen-lockfile
```

安装依赖可访问包源，属于明确启动 Codex 后的本地开发行为；本任务包生成阶段没有执行这些命令。

## 2. 最小适配回归（已存在文件）

在 SDAR 仓库根目录执行；先确认不会引用现场环境。

```bash
pnpm exec vitest run   packages/mcp-adapter/test/smpp-task-business-client.contract.test.ts   packages/mcp-adapter/test/frozen-v1-http.contract.test.ts   packages/application/test/mcp-registry.unit.test.ts
```

Input、事件、投影、迁移与恢复的新增测试须按实际项目分类加入，并写出真实路径/测试名。不能把原三份测试全部通过等同于新增 AC-001–050 已通过。

## 3. 静态与领域合同

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm verify:architecture
pnpm verify:protocol
```

触及 evidence 时增加已有 `pnpm verify:evidence-contract` 和 `pnpm verify:evidence-coverage`；触及迁移时增加 `pnpm verify:migrations`。本轮新文档/报告若不在 root format:check glob 中，使用仓库 Prettier 对实际新增文件进行定向检查，不能以命令未覆盖就称全部格式通过。

## 4. 正式里程碑门禁

仓库已有 `pnpm verify`、`pnpm verify:isolated`、`pnpm verify:bootstrap`。先读当前 script、active ExecPlan 和 accepted ADR，选择已有隔离 runner，避免指向现场 PG/Redis。`--frozen` 等额外参数只有在当前脚本明确支持时才使用。

```bash
pnpm verify:isolated
```

若当前规则要求用另一个原 runner，就记录原因与实际命令。完整 gate 至少覆盖 root AGENTS 要求的 format、lint、typecheck、unit、integration、contract、E2E、production build、local smoke；不要为每个小修复重跑全套，也不能在正式里程碑跳过全套。原脚本已聚合测试时不重复执行同一全套，仅保留聚合各子阶段证据。

真实 PG/GOWM 相关命令在 package.json 中有 `test:gowm-storage:unit`、`test:gowm-storage:postgres`、`test:gowm-storage:runtime`，执行前审阅其连接与写范围；只使用隔离资源。selected GOWM 资格验证不能用普通本地 PG 单测冒充。

## 5. 禁止自动执行的命令类别

不自动运行 `ugv:debug start/restart`、控制资格验证、现场 bootstrap/govern/successor、DB reset、真实车辆 tool、部署切换或任何发射/独立锁定。即便名称带 verify，也必须先核对脚本是否产生副作用。

`deploy/development/verify-resource-identity.mjs` 仅在用户另行授权确定目标后，按其当前明确参数执行。这里不猜 CLI 参数，不提供可误触现场的自动 curl 脚本。

## 6. 报告

每条命令记录 cwd、源码 HEAD/runtime hash、工具版本、环境类别、开始结束时间、exit code、测试计数、日志路径和清理结果。状态枚举 PASS/FAIL/BLOCKED/NOT_RUN/NOT_APPLICABLE；未授权现场为 NOT_RUN，不是 PASS，也不必伪装成产品失败。
