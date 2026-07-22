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
| MCP v2 Client Beta        | MIT package；仓库为过渡期混合许可证          | 精确 beta 直接依赖              | 仅 Adapter；每次 beta 升级做源码/协议/许可复核       |
| MCP Tasks Extension       | Apache-2.0                                   | 官方协议扩展参考                | 锁定 commit/schema blob；复制 Schema 时保留归属      |

v1.1 MCP Tasks 冻结说明：ADR-090 锁定 `@modelcontextprotocol/client@2.0.0-beta.4`
用于 extension-era 协商与 legacy fallback；`@modelcontextprotocol/sdk@1.29.0` 在迁移期仅保留
legacy loopback Server fixture，旧实验性 Tasks API 不是 v1.1 权威。`modelcontextprotocol/ext-tasks`
作为精确锁定的官方扩展契约；Phase 1 在 Adapter 内提供带归属与修改声明的有界 Schema 适配。
精确 License hash、package integrity、schema blob 和兼容边界
见三个 MCP OSS Intake、ADR-085 与 ADR-090。

v1.2.1 Frozen MCP Tasks 追加锁定 `modelcontextprotocol/modelcontextprotocol` commit
`26897cc322f356487da89113451bd16b520b9288` 和 `schema/draft/schema.json` blob
`cc44564e33305dbc07e820cdd0a97648f3852019`。源 Schema 未修改地保存在 `protocol/source`，
SDAR 派生 Schema 单独标识为修改产物。精确 commit LICENSE 是 Apache-2.0 迁移文本并保留未
重授权贡献的 MIT 权利，非规范文档为 CC-BY-4.0；该 commit 没有根 NOTICE。Frozen Handler
不新增 SDK 依赖且不得使用 Legacy Bridge。详见 ADR-108 和 Phase 0 OSS Intake。

## v1.2.3 Cognitive Planning 设计来源

以下来源仅以精确 commit 作为设计/算法行为参考；G00 未复制、翻译或引入其运行时代码。
LICENSE/NOTICE 通过 GitHub Contents API 在锁定 commit 上逐项核验。若后续直接移植 Gemini
TypeScript 小模块，必须另建 Source Intake、保留 Apache-2.0 归属并更新本台账、NOTICE 和 SBOM。

| 来源 | 精确 commit | 核验许可证 | G00 分类与限制 |
| --- | --- | --- | --- |
| google-gemini/gemini-cli | `c776c665b00a39d55c470beb788a2b9a77a2feb7` | Apache-2.0；LICENSE blob `7a4a3ea...`; 无根 NOTICE | design reference；无源码复制 |
| ECNU-ICALK/AutoSkill | `94c47ca488d4ba4117d20272e66d49b9877e68cf` | 未确认；只有 README MIT badge，无 LICENSE/NOTICE | 只允许 clean-room 行为参考；禁止源码/长 Prompt 复制 |
| langchain-ai/langmem | `a2d580946465137c89162e67dc0b18108bd4850c` | MIT；LICENSE blob `c38f6f2...`; 无根 NOTICE | clean-room TypeScript 行为参考 |
| agentscope-ai/ReMe | `46adb5ae1e94715ecdffe201a46933fbd419a5e1` | Apache-2.0；LICENSE blob `65c2c5c...`; 无根 NOTICE | RRF/关系扩展行为参考；无 Python 服务 |
| zorazrw/agent-workflow-memory | `8c0ff8cd11d648c8fceb99e4e42f37e3b75381b1` | Apache-2.0；LICENSE blob `261eeb9...`; 无根 NOTICE | 研究/数据形状参考；无 Python 运行时 |
| ace-agent/ace | `bcb7cea0504afad6f55fec4845dd4864c9f9eee7` | Apache-2.0；`LICENSE.txt` blob `261eeb9...`; 无根 NOTICE | Reflector/Curator 行为参考；不保存 reasoning trace |

## 发布前要求

- 生成 SBOM；
- 运行许可证扫描；
- 提供 `THIRD_PARTY_NOTICES.md`；
- 所有 vendored 文件具有 source URL、commit 和 license header；
- 不存在未知许可证、未锁定 Git 引用和开发临时源码复制。
