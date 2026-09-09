# UGV 资源身份冲突修复

状态：资源身份冲突已修复并部署到 sz-gowm，现场只读验收通过。

## 已确认根因

- GOWM 主档设备 `ugv:ugv` 的有效绑定为 `vehicle:ugv / isr.vehicle.ugv.ugv`；绑定 UUID `0012817d-b50c-4777-a37a-f020a3343fab`。
- 公开 Agent Card、SMPP 当前工具合同及 benchmark-server 默认资源均为 `vehicle:ugv`。
- 原现场镜像中 `UGV_MOVE_RESOURCE_ID=vehicle:ugv1`，纯函数适配公开输入报 `UGV_PROFILE_RESOURCE_NOT_ALLOWED`，见 `site-defect-before.json`。

## 修复范围

自然语言输入从当前 Exposure 的 requestSchema const 取身份；结构化输入从冻结 Task Capability 的 exact resource_policy 核验身份；移动候选校验当前 Provider Binding、Source lineage、Runtime Catalog 以及输入/输出 Schema。Selected operation、状态读取、Skill Usage、终态及仿真资格继承同一身份。旧 ugv1 契约仍有效，跨设备替换继续拒绝。

新增 `deploy/development/verify-resource-identity.mjs`：读取公开 Card、当前正式绑定和只读 PostgreSQL 权威，运行纯函数输入适配，不启动 Runtime、不调用 availability 或设备、不保存 Task。治理部署验收会检查该结果。

## 验证和交付证据

- `gowm-master.json`、`site-tools-current.json`、`card-before.json`、`benchmark-alignment.json`：当前身份只读证据。
- `targeted-final.log`：235 个聚焦回归通过。
- `gate/`：完整仓库 gate 原始日志；首轮 lint/两项内部适配端口断言差异均保留，最终结果以验证汇总为准。
- `site-backup.jsonl`：备份路径与更新前镜像；私密配置仅保存在 sz-gowm，未复制到本报告。
- `validation-summary.json`、`checks.json`：最终验证汇总；unit 2561 / integration 242 / contract 534 / E2E 75、format/lint/typecheck/build/smoke PASS。
- 性能前两次分别基线漂移超限、超时；独立真实 PostgreSQL（tmpfs PGDATA）与 Redis 的原测试通过，见 `performance-isolated.json`、`performance-pass.json`，未改变断言或阈值。功能 74 项与独立性能 1 项合计覆盖全部 75 E2E；显示的 skipped 仅来自两批互补过滤。
- `clean-validation.json`、`package-final.json`：干净解包构建/配置、重复生成一致、独立内外层摘要及 Authority 校验 PASS。
- `secret-scan.json`：递归 9025 文件，12 个本地真实私密值检查，0 命中；包不含服务器私密配置、模型密钥或数据库备份。
- `site-source-identity.json`：三个 SDAR 容器各 2780 文件与联合包完全一致；Runtime/Control API healthy，Control worker running（无 Docker healthcheck，正式治理操作已验证）。
- `site-resource-identity-final.json`：公开 resource、正式 Provider Binding/Catalog、Skill package 及输入适配 PASS；`vehicle:ugv / isr.vehicle.ugv.ugv`。
- `site-inventory.json`：Card revision 2，12 Skills/公开能力；版本与绑定未变。
- `site-device-counts-before.json` / `after.json`：SMPP tasks=0、executions=0，SDAR tasks=1，更新前后相同。

## 回退

备份目录 `/mnt/data/sdar-site-20260909/resource-identity-before-20260909` 保存原 `sdar.env`、`environment.json`、`compose.json` 和 `images.json`。回退前检查空闲；由运维恢复这三个私密配置到 `config/.env` 与 `config/.state/`，然后按原 Compose 使用 `up -d --no-build --no-deps runtime control-api control-worker`。原 SDAR 镜像 `sdar-sz-gowm:governance-33dc8cf37ac2` 保留。无需数据库回滚，不删除共享数据、治理历史或设备绑定。

## 验证边界

本次现场验证不派发真实移动，不声明完整 benchmark 任务已执行成功。既有 `embodied.area_patrol` 仍等待 GOWM 提供 `embodied.inspect_area`，完整治理清单仍未验收；本次身份修复不改变该依赖事实。

## 最终交付

联合包：`artifacts/united/sdar-united-070b90e6e25786a67592/sdar-united-070b90e6e25786a67592.tar.gz`（29,960,401 bytes）。

SHA256：`461bedaef951fd2d01f76bbdda056b7cd7ba0bd3774a4dee3277dae58851660b`。

现场镜像：`sdar-sz-gowm:governance-81e64ef90f96`，imageId `sha256:d66e6f5e655de100d62442b8112dbb86ce44664450d80f1124421f380a3151f3`。

现场与包内 sourceHash：`81e64ef90f96e97424c6f7ddf711dd5e9db1907fe20a16b74b00ba6b693d0446`；Git revision `a4fb05e16b1928a9f39bed2a141165ec8ab290ed`，包含构建时有效未提交源码。

归档为部署前冻结的可重现源码快照；部署后只在工作区补写 ExecPlan、状态、变更日志和追踪结论，完整执行证据作为本包外报告交付。`local-post-build-documentation.json` 列出这些文档差异，运行与部署源码未变。`package-final.json` 的 `serverChanged:false` 仅表示打包命令本身不操作服务器；本次独立部署操作见 `site-rollout.log`。
