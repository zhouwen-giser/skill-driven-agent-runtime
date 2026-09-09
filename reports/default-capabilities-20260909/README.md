# 默认治理初始化与 sz-gowm 修复

当前现场已公开 12 个 Skills 和 12 个对应能力。`embodied.area_patrol` 的
`embodied.inspect_area` 依赖由用户确认后续 GOWM 提供，当前不发布为可用。
完整清单验收仍未完成；bootstrap 返回非零并逐项报告此阻塞。

## 已执行与证据

- 固定上游 SHA256：071abb75bf8d231b4d794e5681611ab0f00e26076a73efb3ebe82beccc3ba0d5。
  正式 PMS 镜像来自其嵌套 SMPP 源码，身份见 pms-source.json；构建日志 pms-build-*.log。
- 新增 PMS API、Worker 和独立 PostgreSQL 管理存储；GOWM 共享业务库和独立 Control 库保持原连接。
- 原 SMPP Runtime 接入原生注册客户端，保留 deployment=smpp-sz-gowm、instance=smpp-sz-gowm-runtime、
  provider=isr.vehicle.ugv.ugv、resource=vehicle:ugv。PMS worker 生成真实 Registry 投影；重复配置/注册见 pms-idempotence.log。
- 私密回退目录 `/mnt/data/sdar-site-20260909/governance-before-20260909` 保存原 SDAR 环境、SMPP Compose、镜像身份。
  每次服务更新前检查空闲；不删除数据、绑定或治理历史。GOWM 设备绑定保持既有身份。
- Source 同步、Provider materialization、Skill 发布、Capability/Implementation/Exposure 发布和 Card 激活走正式服务。
  `site-bootstrap-repeat.log` 已证明重复执行复用发布版本，唯一阻塞为巡逻依赖。
- `site-inventory.json` 记录逐项 Skills、全部历史 Capability 版本、Exposures 和激活 Card 身份；
  `audit-site.mjs.txt` 为只读验收脚本。它比较完整的 Capability/Exposure 版本与摘要，不以非空计数代替合同匹配。

## 本次发现与修复

| 问题 | 修复 |
| --- | --- |
| 治理默认关闭、失败未阻止成功报告 | 默认 YES，阶段化结果和非零失败；显式 NO 报告 disabled |
| 固定要求旧十一工具目录 | 显式 ugv-v1-10 / ugv-v1-11，精确拒绝缺项和额外项 |
| Compose 内部地址被通用驱动拒绝 | 显式部署选项，仅允许 runtime/control-api 内部服务名 |
| 旧 MCP 发现过期 | 正式 refresh 与有界版本对齐；支持已有 MCP、空治理目录 |
| Source 列表与直读之间后台续期 | 仅允许同一身份/版本的时间前进，仍拒绝身份漂移和时间回退 |
| 点导航依赖固定 vehicle:ugv1 和历史版本 | 从不可变合同读取实际资源，校验所有绑定一致；允许合法初始版本；live 不混入仿真目标约束 |
| 开放 Provider JSON 字典无法通过显式合同校验 | 等价递归 JSON 字典，不添加事实字段，不改变原 JSON 接受范围；保留原 MCP 摘要 |
| 公共校验器误读扩展 | 核对正式 capabilityExposureCatalog 的版本、Skill ID 和 exposureHash |

初次失败日志保留，不能将这些失败尝试视为通过：最初 lint/test 模板/精确 readiness 调用计数等
问题均有独立复验记录。最终校验汇总和交付身份写入 validation-summary.json、package-final.json。

## 验证边界与回退

本地完整 gate 使用独立真实 PostgreSQL/Redis 与仓库假 Provider/模型；这些是本地自动化证据。
现场仅做治理、健康和只读目录检查，设备动作调用数为零，未创建模型驱动完整业务任务。
巡逻依赖、整个项目既有共享执行验收缺口仍保持开放，不声称完整项目验收通过。

回退恢复原私密环境/Compose 和记录镜像，仅操作对应 SDAR/SMPP 服务；保留 GOWM 数据与 PMS 卷。
已发布版本通过正式版本切换回退，不删除历史、不批量启用 draft。PMS 注册令牌、数据库口令、
模型密钥、私密 Compose 和数据库备份不进入联合源码包。联合包保留原上游字节与 Authority 定义，
不附离线镜像，也不把一键打包称为一键部署。


## 最终交付结果

- 联合包：`artifacts/united/sdar-united-9c38801a0ae9cc5f9fa0/sdar-united-9c38801a0ae9cc5f9fa0.tar.gz`（29,950,234 字节）。
- SHA256：`89bc84b3c5d1a4ecb46df2576ee5504f5548c078b5d220106b6c60c97ce0c0bf`。
- SDAR sourceHash：`33dc8cf37ac20735a4d5b2e562dbac5d41c64be42f78c7ad056fcbe112a39f8c`。
- 现场镜像：`sdar-sz-gowm:governance-33dc8cf37ac2`（linux/amd64）。三个容器分别比对 2,776 个源码文件，差异为零。
- GOWM 原绑定 `0012817d-b50c-4777-a37a-f020a3343fab` 保留；SMPP tasks/executions 和 SDAR tasks 均为零。
- 激活 Card revision 2，公开 12 项；巡逻依赖仍阻塞，bootstrap exit 1 是有意保留的完整清单验收失败。
- format、lint、typecheck、unit 2550、integration 242、contract 534、E2E 75、build、smoke 均通过；干净解包构建/配置、独立嵌套校验、重复生成一致性通过。
- 递归扫描 9,021 个文件，12 个本地真实私密值匹配为零。报告中的公共测试夹具不作为真实凭据。
- `package-final.json` 的 serverChanged=false 仅表示打包入口不连接服务器；本次单独授权的现场更新记录在 final-site-rollout.log 和 site-source-identity.json。

最终证据汇总：`validation-summary.json`。本次独立测试数据库/Redis 在验证结束后清理，现场 PMS/SDAR/GOWM 数据卷保留。
