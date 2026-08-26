# UGV、SMPP 与 Telemetry 联调（不含 Grafana）

## 启动

在 SDAR 仓库根目录执行；同级需要 `sdar-mcp-provider-platform`、
`smpp-telemetry-platform` 源码及已安装的依赖、Docker Compose。

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

脚本顺序：基础设施/迁移 → Telemetry → PMS/Adapter → 只读等待完整 Provider 目录 →
Runtime/Worker → PMS 正式注册 → SDAR NO → 正式 API 初始化缺失 authority → Card → 请求的 YES/NO。
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
