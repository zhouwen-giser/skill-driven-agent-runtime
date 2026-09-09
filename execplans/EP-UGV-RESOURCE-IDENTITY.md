# UGV 治理资源身份贯通修复

## Purpose / Outcome

修复 sz-gowm 公开契约 vehicle:ugv 与执行适配器 vehicle:ugv1 冲突，使 benchmark-server 使用公开契约即可进入同一治理执行链。

## Requirements Covered

沿用 EP-DEFAULT-CAPABILITIES 的 A2A Capability、MCP Provider Binding、不可变 Task 绑定与执行证据要求；不改变业务协议、共享存储或人工确认边界。

## Context and Orientation

Agent Card 与 Registry 已使用 vehicle:ugv / isr.vehicle.ugv.ugv；旧 UGV profile 的输入、Provider 选择、Skill Usage、结果和仿真资格路径硬编码了 ugv1。

## Architecture and Interfaces

Resource 身份由已发布 Exposure 和冻结 Task Capability resource_policy 提供，Provider 身份由正式 Binding / Runtime Catalog 提供。适配器接收显式预期身份并严格比较，执行前仍校验 Provider 输入/输出 schema，不新增独立设备目录。

## Progress

- [x] 2026-09-09 定位源码硬编码并只读确认现场配置使用 vehicle:ugv。
- [x] 2026-09-09 完成执行链修复、现场合同回归及跨设备拒绝；新增只读 verify-resource-identity.mjs。
- [x] 2026-09-09 完成全仓 gate（unit 2561 / integration 242 / contract 534 / E2E 75）、重复联合打包、干净解包构建与配置验证。
- [x] 2026-09-09 已备份并更新现场三个 SDAR 服务；正式 Runtime 身份自检 PASS，2780 个源码文件逐容器核对无差异，Card revision 2 / 12 Skills / 12 能力保持。

## Discoveries and Surprises

UGV_MOVE_RESOURCE_ID 为编译期常量，不是可被现场 .env 覆盖的配置；只改 .env 无法解决。现场纯函数复现返回 UGV_PROFILE_RESOURCE_NOT_ALLOWED。GOWM 主档与当前 SMPP/公开 Card 一致，无需改动设备绑定。旧 /tmp 工具快照的 default_unknown 语义属于治理前状态，回归采用本次重新读取的 admin_override 正式语义。

## Decision Log

保持 vehicle:ugv1 历史仿真数据有效；消除运行时固定设备假设，以治理权威逐阶段校验，不将 vehicle:ugv1 批量替换为另一硬编码。

## Implementation Steps

1. 输入适配显式注入身份；冻结绑定和当前 Exposure 分别作为结构化、自然语言入口的权威。
2. Provider 选择和最终状态 schema 严格匹配该身份；Skill 上下文、结果与仿真资格沿用同一身份。
3. 参数化回归覆盖现场身份、旧仿真身份和跨设备漂移；运行门禁并生成源码包。
4. 空闲检查、私密配置备份、更新 SDAR 服务；保留 GOWM/SMPP 绑定及全部历史。

## Validation

记录 format、lint、typecheck、unit、integration、contract、e2e、build、smoke 日志；现场核对设备主档、SMPP、Agent Card 与镜像内适配结果。现场自检不派发设备动作，实际移动 benchmark 业务结果不据此声明已验证。

## Idempotence and Recovery

无数据库迁移。记录更新前镜像与配置并保留；失败恢复旧镜像与原配置，不删除共享数据。

## Artifacts and Evidence

reports/resource-identity-20260909；固定上游联合源码包。

## Outcomes and Retrospective

本次身份冲突修复完成，联合包与现场源码快照均为 81e64ef90f96e97424c6f7ddf711dd5e9db1907fe20a16b74b00ba6b693d0446。公开输入 vehicle:ugv 已在正式 Runtime 纯函数与正式 Provider/PG 权威核验通过；没有派发真实移动，SMPP 任务/执行计数仍为 0，SDAR 原有任务数 1 保留。既有 embodied.area_patrol 缺失 GOWM inspect_area Provider 的阻塞保留，不声明完整治理清单或整个项目完成。

性能首轮基线漂移 67.265% 超过 15%，第二次单跑超时；原始失败日志保留。独立真实 PostgreSQL（tmpfs PGDATA）和 Redis 下原测试通过：基线漂移 7.159%、Runtime P95 增量 -5.813%、append P95 8.486 ms，测试逻辑/阈值未变。构建后只补写本计划、状态和追踪记录；可部署源码快照固定，最终执行证据作为包外交付报告提供，避免为文档变更再次重启服务。
