# Runtime semantic closure：首批实施证据

状态：M0/M1 实施中，**不是发布验收通过**。2026-09-07 用户授权“开始修复”后实施。
工作树初始 HEAD 为 `473ad7d82cb11eda530aaa46d77478850bd1e51e`，已有未提交部署改动全部保留。

## 本批实际修改

- F03：`packages/langgraph-runtime/src/workflow-compiler.ts` 在结构允许策略上再应用 Skill normative failure policy；fail_fast 不能 continue/goto，recoverable 不能 continue。
- F08：从节点、编译 gate、全执行期 loop/recovery counter 推导保守 superstep 上限，默认复杂度 ceiling=100000，可由 compiler/executor 构造配置。invoke、resume 和 continueExternal 均传递该上限；三个入口统一返回预算失败结果，恢复不清零已消费计数。
- F09 子集：新增 `packages/domain/src/workflow-control-flow.ts`，Validator 与 Compiler 共用 condition true/false、loop done/body 的路由唯一性检查。旧“合法”校验样例本身缺少 done，已补正样例，未放宽断言。
- X05/M0 子集：修复原有 lint/format 阻塞；新增 `pnpm verify:isolated`，复制非秘密源码并记录实际输入 hash，独立 Compose 项目/PG/Redis/端口、独立 TCK 工具目录。TCK/smoke 必须先从自己启动的子进程获得 ready 和本地 endpoint，不能对固定端口的其他实例做探测或写入。

未加入依赖、迁移或第二执行引擎；未部署服务或调用真实设备。

## 已完成检查

| 命令（仓库根目录） | 结果 | 原始日志 |
| --- | --- | --- |
| `node node_modules/vitest/vitest.mjs run --project unit packages/langgraph-runtime/test/workflow-compiler.unit.test.ts packages/application/test/workflow-validator.unit.test.ts`（修复前反例） | 8 failed / 53 passed | regression-red.log |
| 同上（最终核心回归） | **65 passed，2 files**；本批新增 14 项测试 | entry-bounds-green.log |
| 前批核心 + planner + deployment/recovery/environment/isolated-demo，7 个文件 | **111 passed**；在新增 4 个入口/ceiling 测试之前 | regression-green.log |
| `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | **exit 0** | typecheck-final.log |
| `node scripts/check-architecture.mjs` | **exit 0**，881 TypeScript source files | architecture.log |
| `node scripts/test-verification-isolation.mjs`（许可环境） | **4 passed**，无 skip | isolation-contract-approved.log |
| `node node_modules/vitest/vitest.mjs run --project contract packages/management-api/test/http-endpoint.contract.test.ts`（许可环境） | **81 passed** | http-contract-final.log |
| 修改的 16 个 TS/TSX 源码/测试文件 `eslint` | **exit 0** | lint-product-final.log |
| 新增及修改的隔离脚本 `eslint` | **exit 0** | lint-isolation-final.log |
| `node scripts/verify-compose.mjs` | **exit 0** | 命令输出：Compose and SDAR v1.2.2 clean baseline/reset/seed verified |

扩展入口测试的初次运行还发现了测试中的枚举拼写及 human-confirmation 样例缺 success route；这些测试数据问题已修正。
`entry-bounds-red.log` 保留全部诊断，不将这些测试数据问题冒称产品缺陷。该次真正的产品失败是 external continuation 裸抛预算耗尽；检查发现 resume 存在同样未捕获路径，均已补齐一致返回。

## 全量 gate 尝试

- 原始沙箱尝试：本机端口 `listen EPERM`；已保留 `isolated-gate-retry.log` 及 run `sdar-verify-c0ec09c7-cb3c-46ec-b99a-a3024bed8eee`。首次 runner 清理掩盖 listen 错误的问题也已修正。
- 子进程 stdout 契约在沙箱出现 ready 丢失；相同四项测试在许可环境全部通过，断言未修改。
- run `sdar-verify-f9eb868f-12ec-4d6f-b420-57042517807a`：发现旧 TCK/smoke 客户端固定端口后主动停止，仅停止核验 cwd/脚本属于该快照的进程树；外层清理 **exit 0**。此尝试不证明任何完整 gate 通过，复制的历史 reports 也不是本次执行结果。
- 修正后的 run `sdar-verify-6c45def7-7808-45b2-b82f-98ca62ae2bbe`：**failed / ETIMEDOUT**，static-unit-contract-build 阶段 601399 ms，完整运行 601424 ms；日志确认 format 和四项隔离契约通过，之后未获得后续 gate 的完成结果。`run.json` exitCode=1，cleanupExitCode=0；未遗留本轮快照进程。源码与 hash 见 `inputs.json`，正式失败结果见 `snapshot-reports/verification/summary.json`。因此未执行或证明本轮完整 unit/contract/integration/E2E/build/smoke/TCK。

重新运行：

```bash
pnpm_config_verify_deps_before_run=false pnpm verify:isolated
```

此入口复用当前锁定的已安装依赖，**不是 clean frozen install 的证明**。完整里程碑仍要求全门通过和后续组合场景。

## 仍待实现/验收

M1 的 condition×parallel 汇合、fork/iteration 身份、continuation schema 迁移、terminal obligations、嵌套循环与完整路由矩阵尚未完成。
M2 的外部等待后确认/普通子实例/取消传播，以及 M3–M7 的 Skill 选择/演化、A2A 流、在线 Task Type、通用 admission、Console 和完整验收均继续开放。
不得用本批 65 项核心回归或旧发布报告关闭这些能力。

当前限制：完整 gate 的聚合静态阶段达到 600 秒超时。独立 typecheck/核心回归/架构结果不能替代未完成的完整门禁；M0/M1 保持开放。

最终定向证据：65 核心 Workflow + 81 HTTP contract + 4 isolation contract = 150 项通过；修改的 TS/TSX 文件和隔离脚本 lint 通过。完整 gate 仍失败，不能关闭 M0/M1。源码快照后的变化仅为状态/证据文档，见 source-check.json 的 finalMismatches。
