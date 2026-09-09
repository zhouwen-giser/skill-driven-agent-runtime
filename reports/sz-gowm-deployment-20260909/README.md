# sz-gowm SDAR 部署完成（2026-09-09）

## 访问地址

- Console：http://17.26.1.20:10998/console/
- Runtime 健康：http://17.26.1.20:10998/api/v1/health
- A2A Agent Card：http://17.26.1.20:10999/.well-known/agent-card.json
- Control API：http://17.26.1.20:10091/health/ready

这些地址已从部署机外实际请求并返回 HTTP 200。服务沿用可信内网、无外部认证的 Development 基线，勿暴露到公网。

## 部署身份

- 服务器目录：`/mnt/data/sdar-site-20260909`。
- 源码包：`sdar-development-a4fb05e16b19-9e515734315c.tar.gz`；同目录有 `.sha256` 和逐文件 `.manifest.json`。
- 包 SHA256：`d349c7173ecb10dc34b3f1a08041552ee9b44cad325845e9e99a4a415286f341`。
- 源码 revision：`a4fb05e16b1928a9f39bed2a141165ec8ab290ed`；包含本次部署增量，完整身份以 sourceHash 为准。
- sourceHash：`9e515734315c82d0d966fe8ad80bb685efa71a4fec337d7ffba104664b13775e`；已与实际镜像中的元数据核对一致。
- SDAR 镜像：`sdar-sz-gowm:9e515734315c`，实际 ID 见 `deployment-final.json`。
- 配置：服务器 `config/.env`（0600）；实际模型密钥按用户明确授权迁移。最终归档扫描未发现真实密钥、密码或令牌。

## 实际接入

Runtime、Control API、Control Worker、Redis 共 4 个 SDAR 容器运行。Runtime 与 Control API 的 Docker 健康检查通过；Worker 进程运行，Redis AOF enabled/writable、无 active queue/lease。没有新增业务 PostgreSQL 容器。

业务连接使用原 GOWM PostgreSQL 的 `gowm` 数据库、`ugv_sdar_app` 账号和固定 `ugv_sdar,public,pg_catalog` search_path。GOWM 原账号密码保持不变；Node Control 使用同一 PostgreSQL 容器中的独立 `sdar_control` 管理库。正式 GOWM 安装器的 81 个 SDAR 条目全部与消费合同匹配，实际运行合同检查 PASS。

SMPP 沿用原两个应用镜像。GOWM 官方 `resolveBusinessDeviceContext` 将已有绑定补充为 SDAR 继任绑定，旧记录保留。新 binding：`0012817d-b50c-4777-a37a-f020a3343fab`；device `ugv:ugv`、scope `default`、SDAR `sdar-sz-gowm`、SMPP `smpp.sz-gowm.ugv`、Provider `isr.vehicle.ugv.ugv`、resource `vehicle:ugv`、Runtime MCP server `smpp-sz-gowm`。切换前 SMPP active task 和 UGV execution 均为 0。重载后实际设备上下文读取通过、MCP 刷新返回 200、发现 10 个工具。

GOWM 在本次接入中提供共享业务存储及设备绑定。GOWM World MCP 健康检查通过，但未将其声明为已注册的 SDAR MCP Provider。

沿用本地 `qwen3.8-max-0902` 模型配置，Provider 和 21 个初始模型路由已持久化。一次不含业务数据的最小模型请求 HTTP 200。本次没有创建现场业务 Task，也没有执行设备控制；模型驱动的完整业务任务仍不属于这些部署烟测证据。确认策略为 manual，设备副作用开关保持关闭。

## 已完成验证

格式、完整 lint、TypeScript、单元/性能（2531 项）、集成、协议、端到端、production build、本地 server smoke 均已通过。后续配置脚本修正通过最终相关 lint 与 5 个部署回归测试；另有 38 个 GOWM 单元检查通过。完整命令及重试结果保存在本目录日志和 `gate-*.json`。隔离 runner 的按名称过滤用例会显示 skipped，完整对应组已分别运行；没有修改测试断言或删除需求。测试临时 PostgreSQL/Redis 容器已清理，原本地开发环境保留。

现场证据：`verification-final.log`、`deployment-final.json`、`external-access.json`、`device-context.log`、`bootstrap-final.log`、`package-secret-scan.json`。最终部署后再次验证系统策略、真实 MCP 工具目录、无在途 Task/RemoteTask/dispatch、Redis AOF 正常。

## 处理的问题与授权

- 打包枚举历史报告触发 ENOBUFS：在 Git 列表阶段排除 reports/artifacts，并增加超大报告目录回归。
- dotenv 的 JSON 双引号转义破坏设备数组：使用受控单引号序列化，增加数组与美元字符往返测试。
- 已渲染 Compose 再次转义美元字符破坏数据库探针：恢复原健康检查命令，核对原数据库环境和数据卷一致。
- GOWM 安装结构不包含 SDAR 默认策略数据：只补入基线的三项 singleton 数据，ON CONFLICT 保留已有配置，正式 API 验证通过。
- 自动审批最初拒绝模型密钥迁移和数据库容器重建；用户分别明确授权后完成，当前无待处理审批。

## 运维与恢复

应用 Compose：`/mnt/data/sdar-site-20260909/config/.state/compose.json`。查看状态：

```sh
docker compose -f /mnt/data/sdar-site-20260909/config/.state/compose.json ps
docker exec sdar-sz-gowm-runtime-1 node deploy/development/upgrade-preflight.mjs
```

停止/回滚 SDAR 仅操作它自己的 Compose，保留卷和私密配置，不删除 GOWM schema。数据库已备份为服务器本地 `gowm-before-sdar.dump`（约 484 MiB，0600）；原容器配置、原 GOWM env 和 SMPP binding/Compose 备份均留在该目录。

数据库使用 `gowm-plus-db:sdar-pgvector-runtime-0.8.5`。它保留原 PostgreSQL/操作系统，仅加入仓库锁定 pgvector 0.8.5 的扩展与许可证。数据库 Compose 为服务器本地 `gowm-pgvector.compose.json`；原 GOWM `.env` 的 `WORLD_PLATFORM_POSTGRES_IMAGE` 也已更新。未来重建/升级 GOWM 时必须保留 pgvector 能力；数据库中已有 vector 类型后，不应直接退回缺少扩展文件的镜像。原镜像作为构建恢复来源保留。

本记录证明此次现场部署与连接，不宣称整个项目的全部需求已经验收。
