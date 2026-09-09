# Development 一键部署

适用 Linux x86_64、Docker Engine + Compose v2、可联网访问镜像仓库、npm 和 GitHub。
建议 4 核 / 8 GiB 内存及 15 GiB 以上可用磁盘。无需宿主机安装数据库；没有可用 Node 时，脚本构建工具容器运行 CLI。

这是可信开发网络部署：公共 A2A、Management、Console、Node Control 免 Bearer；PostgreSQL 和 Redis 也映射到宿主机，但仍强制密码。请勿暴露到公网。

## 首次部署

解压到持久目录（例如 `/opt/sdar-development`），在解压目录执行：

```bash
./deploy/development/deploy.sh init
# 编辑 deploy/development/.env，至少修改 SDAR_DEPLOY_PUBLIC_HOST
./deploy/development/deploy.sh check
./deploy/development/deploy.sh up
./deploy/development/deploy.sh status
```

`init` 生成数据库密码、internal 服务身份、AES-256-GCM 主密钥，权限为 0600；已有 `.env` 不覆盖。
完整变量说明只有根目录 `.env.example` 一份；不要把示例当成已生成私密部署配置。
相对模型密钥路径以所选 `.env` 所在目录为基准。无宿主 Node 的工具容器路径下，请把密钥文件也放在该配置目录内。

默认地址：

| 服务 | 宿主机端口 | 访问路径 |
| --- | --- | --- |
| Management / Console | 10998 | `/api/v1/health`、`/console/` |
| A2A | 10999 | `/.well-known/agent-card.json`；按 Card 声明的协议接口访问 |
| Node Control | 10091 | `/health/ready`、`/api/v1/...` |
| Runtime PostgreSQL | 55462 | 数据库/用户名默认 `sdar`，密码在私有 `.env` |
| Control PostgreSQL | 55463 | 数据库/用户名默认 `sdar_control` |
| Redis | 56391 | 密码认证，逻辑库默认 0，AOF 开启 |

所有端口可配置；`SDAR_DEPLOY_BIND_HOST` 控制宿主机监听地址。Compose 内部固定服务 DNS/端口，不应填外部 URL 来替换内部连接。Agent Card 使用 `SDAR_DEPLOY_PUBLIC_HOST` 和映射端口；反向代理场景可显式设 `SDAR_A2A_PUBLIC_BASE_URL`。

## 模型与 Provider

空库迁移初始化 Prompt。没有模型配置时不会伪造模型 Provider；依赖模型的功能会报告 `MODEL_STAGE_NOT_CONFIGURED`。
配置以下值启用初始模型及阶段路由：

```dotenv
SDAR_UGV_REAL_MODEL_ENABLED=YES
SDAR_UGV_MODEL_PROVIDER_ID=development-model
SDAR_UGV_MODEL_BASE_URL=https://model-gateway.example/v1
SDAR_UGV_MODEL_NAME=your-model-name
SDAR_UGV_MODEL_API_STYLE=openai_chat_completions
SDAR_UGV_MODEL_API_KEY_FILE=secrets/model-api-key
```

密钥文件只放实际 key，不放 JSON 或 `KEY=`。API_KEY 与 API_KEY_FILE 二选一。已有模型/路由不自动覆盖；后续变更使用正式管理 API。

启用 UGV 治理初始化须配置当前正式 Registry：

```dotenv
SDAR_UGV_BOOTSTRAP_ENABLED=YES
SDAR_UGV_REGISTRY_ENDPOINT=http://registry.example/api/v1/registry/development/consumers/sdar/v1/sources/development-ugv/latest
SDAR_UGV_REGISTRY_ENVIRONMENT=development
SDAR_UGV_SOURCE_ID=development-ugv
SDAR_UGV_EXTERNAL_PROVIDER_ID=isr.vehicle.ugv.ugv1
SDAR_UGV_EXTERNAL_SERVER_ID=your-current-server-id
SDAR_UGV_RESOURCE_ID=vehicle:ugv1
SDAR_UGV_EXECUTION_MODE=live
```

这是配置格式示例，不代表该服务存在。Registry 与实际 MCP endpoint 必须能从容器网络访问；不要使用指向容器自身的 `127.0.0.1`。当前自动 bootstrap 使用 Registry/MCP 的正式匿名访问模式；需要认证的部署请先通过治理接口配置 `secret://env/NAME`，不把真实 key 写进 URL。

脚本只调用发现、目录、availability 和治理 API，不创建 Task 或调用工具。未配置时报告 `DEVELOPMENT_PROVIDER_NOT_CONFIGURED`；上游不可用时保留精确 reason code，不冒充 available。治理结果保存在自身 `governance-packages` 卷的 `bootstrap-status.json`。空库创建点导航 v1；已有内容一致则复用，改变则新增 successor，历史版本不改写。

全部已发布/启用的非武器 Skill 可见。非武器 UGV 计划在持久化 Task/Plan 和绑定后，由同一个应用确认服务自动推进；审计身份明确为部署所有者的 `deployment_preauthorized`。需要补充业务输入时仍等待用户。未分类或嵌套的自定义计划不据名称推断非武器，保留人工确认。

```dotenv
SDAR_DEVELOPMENT_CONFIRMATION_POLICY=auto_non_weapon
ALLOW_UGV_LIVE_SIDE_EFFECTS=YES
ALLOW_UGV_SIMULATION_SIDE_EFFECTS=YES
```

改为 `manual` 恢复交互确认；副作用开关 `NO` 仍阻止对应模式的派发。一次性消费、幂等、uncertain 后 exact reconciliation 和真实终态校验仍有效，不自动重放控制调用。

## 武器/效应器边界

Device 执行保持禁用，不注册新的 Device 发射实现。Console「隔离软件演示」显示登记参考与禁用原因，并提供**仅修改 `demo:indicator` 软件标记**的人工确认演示。它没有武器目标、射击参数、网络 transport 或设备依赖，也没有 A2A/MCP 可执行 Capability。

公开演示接口（仅 Development）：

- `GET /api/v1/development/isolated-demo`：禁用信息及持久审计。
- `POST .../requests`：`{"requestId":"UUID","objectId":"demo:indicator","state":"active"}`，仅准备。
- `POST .../confirm`：`{"requestId":"同一 UUID","acknowledgement":"software-only"}`，独立人工确认。

同一 requestId/phase 一次写入，重试不追加；冲突参数拒绝。记录只表示软件状态，不产生 DeviceMission、ProviderExecution 或物理成功。确认不能使 Device Capability 可执行。

## 配置、重复启动和升级

优先级：`--set=KEY=value` → 进程环境 → 指定 `.env` → 默认值。示例：

```bash
./deploy/development/deploy.sh check --env-file /srv/sdar/.env
./deploy/development/deploy.sh up --env-file /srv/sdar/.env --set=SDAR_MANAGEMENT_PORT=11998
```

命令行覆盖不写回 `.env`；后续操作需保持同样覆盖，建议长期值写进 `.env`。文件按 dotenv 数据解析，不执行 shell、不展开 `$VAR`。`check` 仅展示非敏感部署选项，其余值标为 configured/unset。

升级前停止新请求提交并备份两个 PostgreSQL 卷与私密 `.env`/`.state`。把新代码解压/更新到同一目录，保留配置和卷，再执行：

```bash
./deploy/development/deploy.sh upgrade
```

升级检查 Agent Task、RemoteTask、pending dispatch、Control operation 和 Bull active/lease；存在活动则停止，不取消/重放/强制终结。构建后、滚动前再次检查。调用方需保持该短窗口不提交新任务；检查不是分布式 admission 锁。
配置指纹变化会重建相关服务；不会只修改挂载文件却继续运行旧进程配置。数据库身份/密码、Redis 密码及主密钥变化拒绝直接升级，须单独迁移。

```bash
./deploy/development/deploy.sh logs
./deploy/development/deploy.sh down
```

`down` 不带 `--volumes`，数据不删除。仅管理选定 Compose project；不启动、重启或修改外部 Provider、Telemetry、Simulator、Referee。

生成的 Compose 在 `.env` 旁的 `.state/compose.json`；私密参数在同目录的 `environment.json` 和只读 secret mounts，不直接出现在 Compose 变量值里。目录权限 0700；PG/Redis 的只读挂载文件在容器中须可供其非 root 用户读取。

Redis 必须保持 AOF。磁盘满/MISCONF 时恢复磁盘和 AOF 健康，不禁用持久化。启动失败可查看 `status/logs`，修复原因后原目录重试；不要清卷。
默认联网构建固定 PostgreSQL/pgvector 配方；镜像仓库暂不可用时，可用 `SDAR_DEPLOY_POSTGRES_IMAGE` 指向已有同版本可信镜像继续开发。不要把未实测的下载失败称为完整新服务器验收通过。

## 打包与身份

在源码仓库运行 `node deploy/development/package.mjs`，输出到 `artifacts/development/`：源码压缩包、SHA256 和逐文件 manifest。排除 `.env`、`.state`、密钥、日志、历史报告、node_modules；包不含真实地址/凭据配置。解压后联网构建。
`up` 输出源 revision、实际镜像 ID 和访问地址；若从带修改的工作树构建，Git revision 不是该工作树的完整身份，应同时保留包 manifest 的 sourceHash。

本轮仅开展直接相关的开发功能验证；qualification/production 完整门禁留待后续阶段。

## sz-gowm 共享业务数据库

显式配置 `SDAR_STORAGE_MODE=gowm-shared`、`GOWM_DATABASE_URL`、
`SDAR_CONTROL_DATABASE_URL`、`SDAR_DEPLOY_EXTERNAL_NETWORK`。共享模式不创建 PostgreSQL
容器或卷；Control URL 必须指向独立管理数据库。现有 GOWM 正式安装器必须先安装
`ugv_sdar`，Runtime 只读校验合同、不执行业务迁移。设置 `SDAR_SERVICE_KEY`、
`SDAR_ALLOWED_DEVICE_IDS`、`SDAR_DEVICE_ID`、`SDAR_DATA_SCOPE_KEY` 明确现场归属。
GOWM 管理的 `ugv_sdar_app` 连接仅存放于服务器私有配置，不能放入部署包。


治理初始化默认开启。`SDAR_UGV_CATALOG_PROFILE` 默认为 `ugv-v1-11`；固定 sz-gowm
上游使用 `ugv-v1-10`（不包含 laser range），两种配置均要求工具合同精确匹配。
初始化清单在 `capability-manifest.json`。Source、Provider、治理发布、内置依赖、公开 Card
任一阶段失败均返回非零，显式关闭则报告 `started_governance_disabled`。
巡逻 Skill 的 `embodied.inspect_area` 依赖由后续 GOWM 提供，目前保留阻塞；其余能力的
非空数量不能替代完整清单验收。启动检查不执行设备动作。

UGV 部署可运行只读身份自检：`docker compose exec runtime node deploy/development/verify-resource-identity.mjs`。
它比较公开 Exposure、部署资源配置、当前 Provider Binding/Catalog 和 Runtime 输入适配，不请求可用性、不派发 Device Tool、不创建任务。失败返回非零及脱敏阶段码；成功不等同真实移动任务完成。主机端口重映射不影响容器内自检。
