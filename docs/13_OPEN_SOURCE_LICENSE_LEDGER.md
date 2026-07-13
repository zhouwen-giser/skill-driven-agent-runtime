# 开源许可证台账基线

本文件不是法律意见。Codex 必须在引入具体版本时重新读取该 commit 的 LICENSE/NOTICE。

## 本项目许可证

Skill-Driven Agent Runtime 由 zhouwen 以 Apache License 2.0 发布，SPDX 标识为
`Apache-2.0`。标准许可证全文见 `LICENSE`，归属声明见 `NOTICE`；第三方依赖继续按
`THIRD_PARTY_NOTICES.md`、SBOM 和本台账各自的许可证处理。

| 项目                      | 基线许可证                                   | 允许用途                        | 特别注意                                             |
| ------------------------- | -------------------------------------------- | ------------------------------- | ---------------------------------------------------- |
| LangGraph.js              | MIT                                          | 直接依赖、修改、分发            | 保留许可证和版权声明                                 |
| Mastra                    | 核心 Apache-2.0；`ee/` 企业许可              | 参考；核心独立包经 ADR 后可依赖 | 禁止使用 `ee/` 代码；检查 NOTICE                     |
| VoltAgent                 | MIT                                          | 参考；独立包经 ADR 后可依赖     | 云/Console 服务条款可能与核心不同                    |
| OpenHands                 | 主开源代码 MIT                               | Skill/Plugin 设计参考           | OpenHands Cloud 等独立仓库可能非 OSS，必须逐仓库核查 |
| Dify                      | 修改版 Apache-2.0 / Dify Open Source License | 只做 UX 和信息架构参考          | 不复制代码；商用/平台条件需法务审查                  |
| Google ADK JS             | Apache-2.0                                   | 架构和测试参考                  | 保留 NOTICE/修改声明；不引入第二 Runtime             |
| BeeAI Framework           | Apache-2.0                                   | 架构参考                        | 核查 TypeScript 子包和 NOTICE                        |
| Microsoft Agent Framework | MIT                                          | 架构参考                        | .NET/Python，不跨语言嵌入                            |
| A2A JS SDK                | Apache-2.0                                   | 直接依赖                        | v1.0 beta 版本必须锁定并验证                         |
| MCP TypeScript SDK        | MIT（以锁定版本为准）                        | 直接依赖                        | 核查协议和 SDK 版本兼容性                            |

## 发布前要求

- 生成 SBOM；
- 运行许可证扫描；
- 提供 `THIRD_PARTY_NOTICES.md`；
- 所有 vendored 文件具有 source URL、commit 和 license header；
- 不存在未知许可证、未锁定 Git 引用和开发临时源码复制。
