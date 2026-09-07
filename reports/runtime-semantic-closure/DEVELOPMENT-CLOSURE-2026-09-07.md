# Runtime 开发修复交付记录（2026-09-07）

结论：用户批准的 A/B/C 开发范围完成。同一冻结源码的 `pnpm verify:isolated`（reuse）完整 **30 阶段通过**，三项 smoke 和五项外层清理全部成功。未部署共享服务、未调用真实设备；不代表发布验收完成。

## 本次完整证据

- 运行：`sdar-verify-b487014e-48c4-4de1-b2ce-1f3fae59de99`，2026-09-07 19:44:09–20:04:22（Asia/Shanghai），聚合耗时 20.20 分钟。
- [完整阶段结果](sdar-verify-b487014e-48c4-4de1-b2ce-1f3fae59de99/snapshot-reports/verification/summary.md)、[机器结果及清理](sdar-verify-b487014e-48c4-4de1-b2ce-1f3fae59de99/run.json)、[源码清单](sdar-verify-b487014e-48c4-4de1-b2ce-1f3fae59de99/inputs.json)。所有命令、耗时、退出码和原始日志均在该运行目录。
- Runtime 输入 SHA-256：`ce4bb0fb23c1d6761ce5eaa4e1d4f8b0fb60c90789f407bbf04c6ba517f02d10`。
- 需求基线 SHA-256：`e7e6af23e608bee330070aeefadb5aa017dc95497f11da437ef9ca39df7dc6b5`。快照运行前后两类哈希均未变化；结束后逐文件核对当前工作树，运行输入无变更、无缺失。后续仅更新交付状态文档和追踪矩阵，不改业务源码或需求条文。

| 验证                                               | 本次结果                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 格式、lint、TypeScript、架构/协议/许可证、生产构建 | 全部通过                                                                                |
| 验证器/隔离契约                                    | 19 通过                                                                                 |
| unit                                               | 281 文件，2477 通过（含独立性能用例）                                                   |
| contract                                           | 61 文件，534 通过                                                                       |
| PostgreSQL/Redis integration                       | 42 文件，242 通过                                                                       |
| 本地 Model/MCP E2E                                 | 74 功能 + 1 独立性能，75 通过                                                           |
| 官方 A2A TCK                                       | 既有 HTTP/JSON must 配置：74 passed、161 skipped、30 deselected；不宣称全部官方可选能力 |
| 迁移                                               | 76 项 Runtime 增量至 0183，12 项独立 Control 迁移；账本、幂等、回滚/重放和数据保留通过  |
| canonical evidence 演示                            | 44/44 场景，25 个共享套件中的 42 个直接测试                                             |
| smoke                                              | infrastructure、Server/Console、Node Control API/Worker 全部通过                        |
| 资源清理                                           | 三个所属 Compose 项目及迁移容器/卷清单检查均退出 0，无清理错误                          |

性能仅属本地模拟：Runtime P95 基线 392.73ms、启用后 372.40ms，变化 -5.18%；基线窗口漂移 14.19%（限15%）；Evidence append P95 3.85ms（限20ms）。原阈值未改。

## 已实现且本轮验证

- A：共享控制流区域分析；新版 DSL 2.0；fork/branch 身份汇合与 reject_conflicts；调用级循环 3×2=6、30/100 次及递归步数界；合法终止；同 checkpoint 恢复、paused continuation；node-run 幂等持久子调用、取消和预算传播。旧快照不改 hash、不从 START 重放。
- B：Cognitive off 仍使用正式语义检索/选择/Usage/记录，两个兼容 Skill 选择第二个并执行；统一明确 Schema；临时 Skill 全终态事务失效、幂等经验；演化两入口稳定 409 且零候选工具/版本写入，完成 Task 不因延期变失败。
- C：纯读当前投影、列表、GET/订阅/重连；统一 observer，Artifact 先于终态；configured Task Type 经原治理激活、在线召回/撤销；同 Task 持久补参及正式 authority 绑定，精确版本/输入冻结，显式权限错误不回退。
- 三类模拟业务：文档纯文本→同 Task 补参→绑定/确认→标准流结果；数据聚合产生真实输入对应的 sum/count；既有设备只读链保持兼容。模型和 MCP transport 使用本地模拟，PostgreSQL/Redis 使用真实隔离实例。

## 延期与执行复盘

F06/F07 完整候选行为验证、策略保持和原子发布；X04 完整 Console 编辑器；X05 发布部分、全部 18 AC、独立 frozen install、真实模型泛化及物理设备验证仍开放。当前仅维护 Console 兼容并以 API 交付；历史 passed 只参与结构检查。

本轮收口保留 6 次失败全门禁记录：format、lint、UGV 新版本遗漏、DSL/迁移/Skill 契约、治理注册夹具、Server smoke 夹具。每次失败后先定向修复；其中静态遗漏及未覆盖直接 Schema 消费者造成可避免的重复前缀耗时。后续变更应先定位注册/编译/分发/启动消费者，运行其直接行为契约，再冻结源码；不加新验证平台、不按批次重复全门、不降低断言。失败运行与定向复验详见 [现有 ExecPlan](../../execplans/EP-RUNTIME-SEMANTIC-CLOSURE.md)，不得拼接为本次通过证据。
