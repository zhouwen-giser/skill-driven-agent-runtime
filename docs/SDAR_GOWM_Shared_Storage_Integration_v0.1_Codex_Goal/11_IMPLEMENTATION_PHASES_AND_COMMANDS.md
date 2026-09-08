# D11 — 实施阶段与验证命令

|阶段|内容|主要交付|
|P0|当前基线、上游合同和全路径SQL盘点|schema-consumption-matrix、来源与差异|
|P1|共享模式、连接/启动验证、设备上下文|正常server配置与Pool装配|
|P2|Task、初始Admission、Plan/Workflow/Node|设备归属、partial index、原生authority回归|
|P3|结构化输入与目标图形|Task/Plan/Run目标事务绑定|
|P4|MCP Invocation、Remote Binding及canonical补齐|完整上下文、延迟关联、协议边界|
|P5|Worker/Continuation/事件/证据/清理|双设备领取、恢复和历史保留|
|P6|正常应用装配和独立测试|真实PostgreSQL+SDAR路径+MCP桩|
|P7|回归、交接、报告与Draft PR|最终状态和可选互操作入口|

P0完成后尽快实现一个最小正常请求贯穿数据库，再扩展其余路径；不要先堆大量治理框架。各阶段可小步提交，无须为每个阶段新增人工审批或等SMPP合并。

## 当前仓库工具链

本次观察 `packageManager=pnpm@11.7.0`、`engines.node>=20.19.0`、根版本1.4.1；执行时遵循实际package.json/lockfile。不要照搬GOWM的npm run check，也不要默认升级依赖。

基本回归：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm verify:architecture
pnpm verify:protocol
pnpm verify:migrations
```

`pnpm test`当前是unit+contract项目。上述脚本缺失/改名时选实际等价命令并记录，不伪造执行结果。format:check至少对修改文件按项目现有格式要求通过；全仓历史格式差异单列，不借机重排无关文件。

本任务新增建议脚本（命名可按项目规范一致调整）：

```text
gowm-storage:check                 离线合同/Schema消费清单检查
gowm-storage:verify                显式连接数据库，只读验证SDAR子集
test:gowm-storage:unit             新增单元和合同回归
test:gowm-storage:postgres         真PostgreSQL、设备键、事务及查询
test:gowm-storage:runtime          正常SDAR路径+真DB+MCP桩
gowm-storage:smoke --help          无连接、无Docker的用法说明
gowm-storage:interop               可选已适配SMPP真实互操作
```

help/check不自动连接线上环境。需要数据库的测试缺环境显式NOT_RUN，不计入已执行PASS。保留原有integration/e2e测试中与本改造有关的场景；不默认启动有Docker/实车前置的全量release/HA资格流程。

## 建议提交

```text
feat(storage): add GOWM shared schema configuration and verification
feat(storage): propagate device context through task and workflow persistence
feat(storage): persist target geometry lineage
feat(storage): scope remote task bindings and resolve canonical MCP identity
fix(storage): scope recovery events and retention by device
 test(storage): verify dual-device shared PostgreSQL runtime flow
 docs(storage): document parallel SDAR shared storage integration
```

实际提交可合并，不要求凑数量。不得强推、合并、Tag、Release、部署或切换用户实例。
