# Project Status

更新时间：2026-07-11 18:44 +08:00

| 阶段                           | 状态   | 完成度 | 最近证据                                                                             | 阻塞                                                     |
| ------------------------------ | ------ | -----: | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| EP-00 仓库与兼容性基线         | 已完成 |   100% | `pnpm verify:bootstrap` 16/16；`pnpm smoke:infra`：pgvector 0.8.4、migration、Redis PONG/写读通过 | 当前目录缺少 Git 元数据，无法提供 Conventional Commit 证据 |
| EP-01 协议与领域骨架           | 未开始 |     0% | -                                                                                    | -                                                        |
| EP-02 MCP 与 Skill 基础        | 未开始 |     0% | -                                                                                    | -                                                        |
| EP-03 Workflow 规划与运行时    | 未开始 |     0% | -                                                                                    | -                                                        |
| EP-04 任务生命周期与 Goal 闭环 | 未开始 |     0% | -                                                                                    | -                                                        |
| EP-05 记忆、评估与演化         | 未开始 |     0% | -                                                                                    | -                                                        |
| EP-06 控制台与可观测性         | 未开始 |     0% | -                                                                                    | -                                                        |
| EP-07 加固与完整验收           | 未开始 |     0% | -                                                                                    | -                                                        |

## 当前目标

启动 EP-01 协议与领域骨架：完整 Task/Context/Goal 内部模型、A2A Adapter 和 PostgreSQL/Redis Repository 边界。

## 最近完成

- 已建立需求基线和 Codex 项目任务包。
- 已启动 Codex Goal，完整核对原始 SRS（226 个段落、38 张表）、DoD、追踪矩阵与 EP-00 前置材料。
- 已确认 A2A SDK 稳定通道仍为协议 v0.3，v1.0 支持需使用 beta 并进行 1.0.1 契约验证。
- 已建立 strict TypeScript pnpm workspace；`pnpm verify:bootstrap` 的 format、lint、typecheck、10 tests 和 build 全部通过。
- 已完成直接依赖与八个参考项目的 intake/pin；MCP 真实 loopback 和 LangGraph 真实执行 Spike 通过，A2A wire fixture 模拟验证通过。
- 已完成 A2A 官方 REST/streaming loopback endpoint、协议版本拒绝和 MCP 远端取消传播契约。
- 已完成 digest-pinned Compose、pgvector migration/rollback、CycloneDX SBOM、266 个 npm 包许可证清单和第三方通知；统一门禁为 16/16 tests。
- 已验证 A2A 客户端断流不终止任务且可轮询完成，以及 LangGraph 并行汇聚与 compiled subgraph。

## 当前风险

- A2A JavaScript SDK 对 1.0 的支持可能使用 beta 渠道，必须先做兼容性 Spike。
- 首版范围很大，必须坚持垂直增量和证据门禁，避免先搭空平台。
- 当前目录不是 Git 工作树，暂时无法提供 Conventional Commit 证据。
- Docker 阻塞已在恢复环境中解除，真实基础设施 smoke 通过；外部 A2A TCK 移交 EP-01。
