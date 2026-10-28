# ZMQ 现场接入与原生单区域巡逻

本目录提供服务身份网络修复和原生目录治理入口。网络修复、软件验证、现场动作及报告完整性分别记录。

## 网络

使用私有 JSON 配置声明服务名、网络、目的端口和回环映射，然后执行：

```sh
node deploy/zmq-site/network-reconcile.mjs plan /private/network.json /private/network-state full
node deploy/zmq-site/network-reconcile.mjs apply /private/network.json /private/network-state full
node deploy/zmq-site/network-reconcile.mjs verify /private/network.json /private/network-state full
```

脚本按当前 Docker 容器身份解析地址，只管理 `sdar-zmq-site-network-v1` 标记的精确规则。
容器重建后重新执行 apply/verify。保留前后快照以便撤回本工具自己的规则；不要恢复整个防火墙快照覆盖其他服务。

## 目录和治理

编译后使用权限 0600 的私有配置，字段由 `ZmqSiteConfiguration` 校验。必须明确配置
`nodeControlBaseUrl`、服务端管理凭据、`runtimeManagementBaseUrl`、`runId`、目录 Profile、
`providerId`、`resourceId`、新 `localServerId`/`bindingId`、`packageWorkspaceRoot` 及允许的 URL origins。
候选 source 为 `{ "originType": "direct", "endpoint": "http://127.0.0.1:19110/mcp" }`；
正式 source 为 `{ "originType": "smpp_registry", "smppSourceId": "真实来源 ID", "externalServerId": "真实注册 ID" }`。
Binding 始终使用 `unauthenticated://none`。配置不要放进 Git 或部署包。

```sh
node deploy/zmq-site/govern.mjs govern /private/site.json /private/publication.json
node deploy/zmq-site/govern.mjs renew /private/site.json /private/publication.json
node deploy/zmq-site/govern.mjs renew-loop /private/site.json /private/publication.json
```

renew-loop 每 60 秒续查一次，串行执行。失败保留最后成功回执并输出阻塞原因，目录变化需重新治理。
只读 Profile 发布 7 项可执行能力；控制 Profile 发布 13 项原生能力和独立单区域巡逻。
旧版本、绑定和报告不删除。旧控制 Exposure 应保持停止新任务准入。

开发部署使用这两个 Profile 时，配置 `SDAR_UGV_EXECUTION_MODE=live`，并通过
`SDAR_UGV_SITE_ENDPOINT_ALLOWLIST` 的 JSON origins 数组明确允许实际 MCP 地址。
独立 CLI 的配置也要求精确允许列表。人工更改上游地址不会绕过该检查。

## 巡逻输入和确认

使用 Exposure `a2a.vehicle.ugv.zmq.area_patrol` 的实际发布版本，经正式 A2A Data Part 提交。
输入含 `resourceId`、`area`、`entryPoint`、`speedLimitMps`、`obstacleAvoidance`、`timeWindow`。
area 使用 `crs=OGC:CRS84`、4 个凸多边形顶点和 `searchStrategy=recognize|track`；
每点必须提供 `longitude`、`latitude`、`ellipsoidHeightM`，高度不可自动补零。
入区点使用 longitude/latitude 且必须位于区域内。

操作员确认父计划后，只有该计划冻结的两个子任务可继承确认。导航失败、未知或未停稳时禁止启动检查。
原始期限始终有效；确认授予仍受现有 15 分钟上限约束。等待过久或撤销确认后，后续子任务停止准入。
重启和回执丢失仅查询、恢复订阅及对账，禁止重复发送不确定动作。

父报告给出执行、发现、覆盖声明、实际轨迹、子 Task 和缺失证据。现有协议不能证明完整目标流或覆盖足迹，
因此扫描完成仍可能是 `degraded`。请求路线、单个位置和 HTTP/MCP completed 都不构成完整巡逻成功。

## 部署和回退

候选 SMPP 19110/19111，候选 SDAR 使用宿主网络和回环 11098/11099/10191，端口被占用必须失败。
隔离软件测试使用独立数据库与队列。使用生产存储前先核实空闲并暂停原 SDAR 消费者，避免双消费者。
正式 19100/19101、10998/10999/10091 的切换需现场 A2A 确认和结果证据。
面板沿用 HTTP，保留数据库卷、账号、GOWM 绑定、PMS 配置和轨迹签名密钥。

回退到已验证的匿名只读镜像与 Profile，撤回本轮控制 Exposure，保留任务、观测和审计；旧 MQTT 写端保持退役。

### 独立存储候选启动

`compose.candidate.yaml` 使用固定镜像 ID 和宿主网络。先准备权限 0600 的环境 JSON；
配置回环 11098/11099/10191、独立 `sdar_zmq_candidate_*` 数据库和独立 Redis DB，
`SDAR_STORAGE_MODE=standalone`、`SDAR_DEVELOPMENT_CONFIRMATION_POLICY=manual`、
`SDAR_UGV_BOOTSTRAP_ENABLED=NO`。包目录使用独立路径。真实目录由本目录治理 CLI 装配。

```sh
node deploy/zmq-site/candidate-preflight.mjs /private/candidate-environment.json
# 上一步端口冲突必须停止；不要自动改端口。
SDAR_ZMQ_SITE_IMAGE=sha256:<固定镜像ID> \
SDAR_ZMQ_SITE_CONFIG=/private/candidate-environment.json \
SDAR_ZMQ_SITE_PACKAGES=/private/candidate-packages \
docker compose --project-name sdar-zmq-anonymous-candidate -f deploy/zmq-site/compose.candidate.yaml up -d
```

此候选配置不接管生产存储。进入正式现场验证窗口时，先保存任务/队列空闲证据、暂停原消费者，
再采用专门审核的生产存储配置；保持同一队列的唯一消费者。镜像替换不会自动执行 bootstrap 或设备动作。
