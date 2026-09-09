# sz-gowm 部署执行事项整理

依据：当前项目 `reports/sz-gowm-deployment-20260909/README.md` 及其验证文件；上游 Telemetry 的 `reports/united-telemetry-20260908/SDAR-AUTHORITY.md`。以下是历史执行记录，不代表新联合包已再次部署。

| 已执行事项 | 结果与证据 |
| --- | --- |
| 原 GOWM PostgreSQL 备份 | 约 484 MiB custom-format dump；原镜像、环境、Compose 与卷身份留在现场私密目录 |
| 加入 pgvector | 基于原 PG18 镜像加入锁定 pgvector 0.8.5；保留原密码、数据卷和原有扩展；重建后健康检查通过 |
| 共享业务存储 | 使用 GOWM 官方安装器，81 个 SDAR 合同条目匹配；Runtime 使用 gowm/ugv_sdar；Control 使用同一 PG 中独立管理库 |
| SDAR 服务 | Runtime、Control API、Control Worker、Redis 四个容器运行；两个 API 健康、Redis AOF 正常 |
| 默认策略 | 仅补充三项 singleton 初始数据，冲突时保留现有值，经正式 API 读取验证 |
| 设备上下文 | GOWM 官方接口创建带 SDAR 信息的继任绑定；旧绑定保留；无在途任务时重载原 SMPP 镜像 |
| SMPP 接入 | 注册 smpp-sz-gowm，实际设备上下文读取成功，发现 10 个 MCP 工具；未调用设备控制工具 |
| 模型配置 | 经授权写入现场私密配置，建立 Provider 与 21 条初始路由；无业务数据的最小模型请求 HTTP 200 |
| 外部入口 | Console、Runtime health、A2A Agent Card、Control ready 均 HTTP 200 |
| 上游 Authority | 原定义恢复为 6 库、334 表、151 视图；8 组查询验证通过，70 条事实补投哈希一致；重复部署通过 |

源码部署身份：`sdar-development-a4fb05e16b19-9e515734315c.tar.gz`。本次重新生成的 SDAR 源码身份以新交付清单为准。

## 已修复的问题

- 历史报告文件枚举引发 ENOBUFS：在 Git 枚举阶段排除 reports/artifacts，并增加回归。
- dotenv 双引号破坏 JSON 配置：受控单引号序列化，验证数组和美元字符往返。
- 对已渲染 Compose 二次美元转义破坏 PG 探针：保留原渲染结果，核对实际健康检查、环境与卷。
- GOWM 结构安装未包含 SDAR 默认策略数据：幂等补充基线数据，不由 SDAR 重跑业务结构迁移。

## 恢复与验证边界

现场状态位于 `/mnt/data/sdar-site-20260909`。数据库、配置、绑定备份在现场保留，交付包不携带这些文件。停止 SDAR 仅操作其自身 Compose，保留卷与共享 schema；已有 vector 类型的库不能回退到缺少 vector 文件的数据库镜像。

历史执行中没有创建现场业务 Task，也没有验证模型驱动的完整设备任务；GOWM World MCP 仅做健康检查，没有声明注册为 SDAR Provider。本次打包不改变上述状态。


## 2026-09-09 治理目录修复增量

- 经用户授权，从固定上游嵌套 SMPP 源码构建正式 PMS API/Worker，并新增独立 PMS PostgreSQL 管理存储。
- 原生注册沿用 smpp-sz-gowm / smpp-sz-gowm-runtime、isr.vehicle.ugv.ugv 和 vehicle:ugv；正式 Registry 投影已生成。未改动原 GOWM 设备绑定与共享存储。
- 备份私密配置与镜像身份，空闲预检通过后重载原 SMPP Runtime、更新 SDAR。默认非武器开发策略按用户授权迁移一次，重复部署保留显式设置。
- 正式生命周期已发布 12 个 Skills、对应 Capabilities/Exposures，并激活非空 Agent Card。公开目录逐项核对包含点导航、读状态/能力/载荷/目标、路线/距离/返航、侦察、跟踪、云台和急停。
- 用户确认 embodied.inspect_area 当前不存在，将由后续 GOWM 提供。embodied.area_patrol 保留依赖阻塞，不能声明全清单验收通过。
- 修复十/十一工具合同配置、Compose 内部地址检查、过期发现刷新、Source 续期竞争、点导航资源/初始版本和 live 约束、Provider JSON 字典显式表示；保持原始 MCP 合同摘要。
- 治理和现场自检设备调用数为零。未执行模型驱动完整业务 Task。最终源码与镜像身份见本次交付清单及 reports/default-capabilities-20260909。

私密回退目录 `/mnt/data/sdar-site-20260909/governance-before-20260909` 保留原环境、SMPP Compose 和镜像身份；PMS 私密文件与独立卷留在现场。恢复配置和镜像、使用正式版本切换，不能删除共享数据或治理历史。
