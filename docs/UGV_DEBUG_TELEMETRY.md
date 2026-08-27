# UGV、SMPP 与两套 Telemetry 联调（不含 Grafana）

## 启动

在 SDAR 仓库根目录执行；同级需要 `sdar-mcp-provider-platform`、
`smpp-telemetry-platform`、`sdar-telemetry-platform` 源码及已安装的依赖、Docker Compose。

```bash
pnpm ugv:debug start       # 完整栈，最终 YES
pnpm ugv:debug start NO    # 完整栈，物理副作用门关闭
pnpm ugv:debug restart    # 重载应用，最终 YES；保留数据库、Redis 和卷
pnpm ugv:debug restart NO
pnpm ugv:debug status
pnpm ugv:debug stop        # 停止本联调栈；不删卷、配置、历史报告
```

**仅限可信局域网：免登录的管理接口和 YES 会允许后续请求执行物理工具。禁止暴露公网。**
启动过程不提交 A2A Task、不确认计划、不调用导航或任何 Device 工具；只做注册、
目录发现和健康观察。既有任务确认、数据校验、执行语义、内部机器凭据不取消。
生产默认鉴权配置、验收脚本及生产 Grafana 配置均不改变。

脚本顺序：基础设施/迁移 → 两套 Telemetry → 真实来源注册及领域投影激活 → PMS/Adapter →
只读等待完整 Provider 目录 → Runtime/Worker → PMS 正式注册 → SDAR NO → 正式 API 初始化
缺失 authority → Card → 增量 Evidence 接入 → 请求的 YES/NO。
已有 Binding、Capability、Exposure 不重复创建。重复 `start` 保留已运行的同模式 SDAR；
修改源码或配置后使用 `restart`。失败打印 `stage`、退出码和私有日志路径，保留数据；
本次新启动的 SDAR 不进入 YES，若最终切换失败则恢复 NO。

## 地址和状态

公告地址默认选物理网卡 IPv4（当前 `192.168.6.7`），可用
`UGV_DEBUG_PUBLIC_HOST=192.168.6.7 pnpm ugv:debug restart` 覆盖。
公告地址与监听地址分离；以下入口均绑定 `0.0.0.0`。

| 服务                                            | 端口 / 路径                            |
| ----------------------------------------------- | -------------------------------------- |
| SDAR A2A / Agent Card                           | 10999 / `/.well-known/agent-card.json` |
| SDAR Management / Artifact                      | 10998 / `/api/v1`                      |
| Node Control                                    | 10091 / `/api/v1`                      |
| MCP Runtime                                     | 19131 / `/mcp`                         |
| PMS                                             | 18092                                  |
| Adapter gRPC 调试                               | 17031                                  |
| OTLP gRPC / HTTP                                | 4317 / 4318                            |
| Telemetry Query API                             | 8088                                   |
| Processor 调试 / 健康                           | 8443 / `/health/ready`                 |
| Collector 健康 / 自身指标 / Prometheus exporter | 13133 / 8888 / 9464                    |
| SDAR Telemetry Evidence / Domain Source Gateway | 8080                                   |
| SDAR Telemetry 统一 Query                       | 8081                                   |
| SDAR Telemetry Admin                            | 8082                                   |
| Domain Projection Worker                        | 8083 / `/status`、`/ready`、`/metrics` |
| Benchmark API                                   | 18090 / `/health`、`/ready`            |

数据库、ClickHouse 和 Redis 只允许内部或回环访问。没有 Grafana、3000 端口或替代 UI。
Runtime 与 Collector 使用专用 `sdar-ugv-debug-observability` 网络及容器 DNS，不使用旧 19100。
`status` 汇总实际 `/proc` 校验后的副作用模式、容器、地址、落库信号及 Processor WAL；
某类无数据会显示 `waiting_for_source`，不可用显示降级，不用样例数据填充。

## 遥测查询

```bash
curl 'http://192.168.6.7:8088/api/v1/events?limit=10'
curl 'http://192.168.6.7:8088/api/v1/metrics?type=gauge&limit=10&collectionProtocol=prometheus'
curl 'http://192.168.6.7:8088/api/v1/metrics?type=sum&runtimeInstanceId=uap-p3-b01-runtime-1&limit=10'
curl 'http://192.168.6.7:8088/api/v1/traces?limit=10'
# 将下列占位符替换为查询返回的真实 32 位小写十六进制 TraceId
curl 'http://192.168.6.7:8088/api/v1/traces/<traceId>?limit=100'
```

指标类型：`gauge`（默认）、`sum`、`histogram`、`exponential_histogram`、`summary`。
指标和 Span 支持 `from`/`to` 时间、`serviceName`、`runtimeInstanceId`、`providerId`、
`deploymentId`、`collectionProtocol`；另有 `metricName` 或 `spanName`/`traceId`。
默认最近 7 天、`limit=100`，最大 1000；`offset` 最大 100000；`nextOffset` 为下一页或 null。
返回原始 ResourceAttributes/Attributes 来源信息；OTLP 和 Prometheus 标记分开，不能混合累加。
不接收 SQL，不猜测事件与 Trace 的关联。

ProviderOps 事件保持哈希校验、去重、Processor WAL 持久 ACK 和原有保留策略。
指标/Trace 使用固定 Collector 0.157.0 的 ClickHouse exporter，独立
`telemetry_observability` 数据库、持久队列和重试；迁移 008 管理表结构并关闭自动建表。
7 天 TTL 是 ClickHouse 异步合并过期策略，不保证恰在第七天瞬间物理删除。
指标 exporter 为 alpha，升级必须同时检查原生表结构与真实写入兼容。
遥测错误只形成积压/降级，不触发业务重试或变更 Task 状态。

## SDAR Telemetry、外部数仓与领域来源

联调配置默认 `DOMAIN_PROJECTION_ENABLED=true`、`DOMAIN_PROJECTION_MAX_MODE=active`。
启动器通过正式 Admin API 幂等执行 approve → shadow → dry-run → ACTIVE；重复启动复用
Control PostgreSQL 中的 lifecycle/revision、租约和检查点，不通过改数据库状态伪造激活。
已激活并不证明业务成功，也不意味着已有来源数据。

| 状态                             | 启动/状态含义                                         |
| -------------------------------- | ----------------------------------------------------- |
| 真实来源已注册、合同正确、零记录 | ACTIVE + `waiting_source`，可以启动                   |
| 来源未注册                       | `DOMAIN_SOURCE_PRODUCER_NOT_REGISTERED`，停在激活阶段 |
| Schema/定义漂移                  | 明确阻断，不自动批准新合同                            |
| 目标写入失败                     | 保留检查点，报告错误/积压；不重试业务 Task            |

SDAR Evidence 写入 `192.168.1.7:8123` 的 `sdar_core.sdar_evidence_v1_record`；
SMPP ProviderOps 同时保留本机目标并新增独立外部目标。十项既有领域映射读取真实
Commander/NPC `sdar.domain-source/v1`，写入 `sdar_embodied` 并附 lineage。
**SDAR → Commander/NPC 这一层按用户要求暂留空；不把 Evidence 或 ProviderOps 改名为应用来源。**

外部连接读取相邻 SDAR Telemetry 的私有 `.env`，只接受上述外部地址；生成配置/凭据位于
联调状态目录 `debug/sdar-telemetry`，不覆盖原 `.env`。域来源配置可通过
`UGV_DEBUG_DOMAIN_PRODUCERS_FILE=/absolute/private/producers.json` 提供：顶层为
`tenantId`、`projectId`、`producers`；每个 producer 使用真实 `producerId`、`application`
（commander 或 npc）、同一 tenant/project、`contractVersion: sdar.domain-source/v1`、
`credentialRef` 和 `metadata`。没有文件时仅生成空列表，或复用专用 Control PG 里的真实注册。
不得填测试 fixture 身份来解锁 ACTIVE。内部 Gateway Bearer token 仍保留。

专用项目 `sdar-ugv-debug-sdar-telemetry` 的 Control PostgreSQL 不发布宿主端口。
启动仅应用增量 Control 迁移及固定 SHA-256、已审查的外部迁移 014；后者只执行
`CREATE ... IF NOT EXISTS`，不改删旧对象。随后只读核对 Evidence 58 列和十项领域合同。

首次 Evidence 激活使用正式 `deliveryStart: from_activation` 配置；Runtime PostgreSQL
迁移 0174 持久记录首次投递起点。默认省略此字段仍为旧 `retained` 行为。旧记录不发送、
不伪造 ACK；重启、配置 revision 不重设起点，同 export ID 不允许静默换策略。
领域 Control PG 的首次接入时间持久保留，限定 producer/tenant/project 与后续入库记录。
SMPP 的新路由只进入新接受的 WAL 快照，既有 WAL 不补外部路由。缺历史引用仍显示不完整。

新增统一诊断查询（只读转发本机 SMPP Query；不重复存储指标/Trace）：

```bash
curl 'http://192.168.6.7:8081/v1/metrics?type=gauge&limit=10'
curl 'http://192.168.6.7:8081/v1/traces?limit=10'
curl 'http://192.168.6.7:8081/v1/traces/<actualTraceId>?limit=100'
curl 'http://192.168.6.7:8083/status'
```

过滤和分页上限与 8088 相同；返回 `federation.source/storage/readOnly`，不开放任意 SQL/URL。
既有 Evidence 与 ProviderOps 查询合同不变（ProviderOps 原接口不接受 `limit` 参数）。
`status` 分别显示实际副作用门、Gateway、Evidence 投递、领域 lifecycle、数据状态、检查点和积压；
未知值为 null，不用 0 冒充观测。Query/Admin 仅联调免登录，Admin 固定审计主体
`ugv-debug-development`，生产默认鉴权不变。

回滚：停止服务保留 WAL/PG/数据卷和配置。0174 down 在已有增量起点时明确拒绝，避免回补历史；
Control 004 没有自动删除式回滚，停用 worker 后保留其表和检查点。外部 014 不自动 DROP。
本次实际验证与尚未完成的真实来源激活见 `reports/sdar-telemetry-debug/verification.md`。

## Benchmark 被动评价

`pnpm ugv:debug` 同时启动独立项目 `sdar-ugv-debug-benchmark`：持久 PostgreSQL、
Bundle volume、API、Reconciler、Evaluation Worker、passive Benchmark Worker 和
Projector。Benchmark API 绑定 `0.0.0.0:18090`；数据库不发布宿主端口。passive
模式拒绝主动 Run/dispatch，不创建 A2A Task，也不调用设备工具。

外部 ClickHouse 使用 `ugv_debug_benchmark_reader` 与
`ugv_debug_benchmark_projector` 两个专用身份。两者只读取冻结合同清单及普通
View 的精确依赖闭包；只有 Projector 能向
`WRITABLE_PROJECTION_TABLES` 的 40 张表 INSERT。没有通配、库级、DDL、UPDATE、
DELETE、角色或转授权限。配置与凭据仅在私有 `debug/benchmark` 状态目录。

启动会幂等导入冻结 Release/Review Profile/输入需求并保存首次增量边界；同身份
漂移会失败，restart 不重设边界。查询直接使用 Canonical Evidence、Domain v1、
ProviderOps v2；不复制 Gateway/WAL/ACK。当前 Commander/NPC 留空不会阻止通用
服务，但不宣称领域投影数据可用于评分。

`/health` 表示服务进程可用；`/ready` 检查 PG、ClickHouse、冻结合同与两个
Telemetry handoff；debug `status` 另行显示 `waiting_source`、checkpoint/backlog 和
正式评分资格。没有可执行规则时固定为
`EXECUTABLE_RULESET_NOT_CONFIGURED`，不得生成零分或虚假分数。

Projector 的 debug 恢复只处理一个已知全局 meta scope 错误指纹：全量校验
Dead Letter/Outbox 身份和生产 mapper 后事务性重排，并保留 resolved audit。
任意其他 DLQ 都会阻断。Telemetry producer handoff 的 source-lock 必须指向已发布
commit/blob/hash；工作树内容匹配不能替代该发布门。

## 状态、恢复及验证

SDAR/SMPP 复用原 task-owned 项目和卷；Telemetry 使用独立项目
`sdar-ugv-debug-telemetry`。生成配置在 `/tmp/sdar-uap-p3-b01-<uid>/debug`，
目录 0700、凭据/配置 0600；不覆盖 Telemetry 其他部署文件。保留此目录及数据卷一起恢复。
本机私有 `.env` 只由已有配置读取器加载，不应提交或打印。

默认 YES 使用既有私有 `simulation-run-id`，开发模式独立验证该本机身份，不依赖旧验收
报告是否符合最新 schema；不修改旧报告、不发行新验收 attempt。若显式指定 successor ID，
仍验证完整发行链；未知 ID 拒绝。普通验收 supervisor 的授权逻辑不变。

如果 Provider 目录尚未完整，启动停在 `provider-catalog`；恢复设备连接后重新启动。
PMS 历史 A→B→A 目录通过正式仓储重新激活原不可变快照，并记录审计，不删历史。
所有权记录与实际 PID 不匹配时，先诊断残留；不要直接删除记录或清库。

在 Telemetry 项目可显式运行恢复验证（会短暂停止 **Telemetry 的** ClickHouse/Collector）：

```bash
node tools/verify-ugv-debug.mjs --allow-telemetry-restart
```

该命令仅观察真实 SMPP 数据，不生成测试业务信号；验证三类落库、卷保留、持久队列重启恢复
及 7 个真实表的 7 天 TTL DDL，结束时恢复服务。TTL 验证不声称已等待 7 天或插入回填数据。
证据见 `execplans/EP-UGV-DEBUG-TELEMETRY.md` 和两仓库的 `reports/ugv-debug/`。

Runtime 保持既有 frozen MCP `2026-07-28` 合同，目录协商使用 `server/discover` 与
`tools/list` 及该合同的 `_meta`，不是旧版有状态 `initialize`。本次未更改线协议。
