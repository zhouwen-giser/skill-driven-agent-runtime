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
| Fast URI                  | BSD-3-Clause                                 | Ajv 传递依赖                    | P13 安全覆盖锁定 3.1.4；保留 LICENSE，禁止回退 3.1.3 |
| Dockerfile frontend       | Apache-2.0                                   | PostgreSQL 容器构建工具         | 锁定 1.24.0 OCI digest；不进入产品依赖或运行时       |
| PostgreSQL + pgvector     | PostgreSQL License                           | 修改后的本地独立容器            | 锁定基础镜像、源码归档和本地构建证据                 |
| su-exec                   | MIT                                          | PostgreSQL 容器内权限切换工具   | 锁定 0.3-r0；保留 LICENSE；禁止恢复 gosu             |
| Redis                     | AGPL-3.0-or-later（本项目选择）              | 未修改的独立容器                | 锁定 8.8.1 Alpine digest；保留商标和对应源码义务     |
| Trivy                     | Apache-2.0                                   | P13 临时发布证据工具            | 锁定 0.70.0 资产校验和；不进入依赖或运行时           |

联调观测侧采用 OpenTelemetry Collector contrib `0.157.0`，固定 commit
`89e43555904cd97c2d36605347c5d5237b1bdc8c`，许可证 Apache-2.0。原生 ClickHouse
exporter 的表模板经占位符展开用于相邻 Telemetry 项目的 migration 008；该项目
`third_party/opentelemetry/` 保留完整 LICENSE、NOTICE、来源与修改说明。SDAR 不新增
Collector SDK/Node 运行时依赖，仅使用独立容器。版本登记见 `third_party/sources.lock.yaml`
及 ADR-142；指标支持为 alpha，升级需重新验证固定表结构与真实写入。

v1.1 MCP Tasks 冻结说明：ADR-090 锁定 `@modelcontextprotocol/client@2.0.0-beta.4`
用于 extension-era 协商与 legacy fallback；`@modelcontextprotocol/sdk@1.29.0` 在迁移期仅保留
legacy loopback Server fixture，旧实验性 Tasks API 不是 v1.1 权威。`modelcontextprotocol/ext-tasks`
作为精确锁定的官方扩展契约；Phase 1 在 Adapter 内提供带归属与修改声明的有界 Schema 适配。
精确 License hash、package integrity、schema blob 和兼容边界
见三个 MCP OSS Intake、ADR-085 与 ADR-090。

P13 发布安全审计发现 `fast-uri@3.1.3` 命中 High 严重度公告
`GHSA-v2hh-gcrm-f6hx`。工作区通过 pnpm override 精确锁定
`fast-uri@3.1.4`；该版本为 BSD-3-Clause，精确 tag/commit、package integrity
和 LICENSE hash 见 `third_party/sources.lock.yaml` 与
`reports/source-intake/p13-fast-uri-3.1.4.md`。未复制或修改其源码。

P13 容器供应链硬化将 PostgreSQL/pgvector 改为仓库内 Dockerfile 构建：
Dockerfile frontend 锁定为
`docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89`
（1.24.0，BuildKit revision
`dd2170e156c9633da1b2d1a58a6188e3f7d36fa4`），仅作为构建工具；`build-base`
精确锁定 `0.5-r3` 并在构建后删除。
基础镜像锁定
`postgres:17.10-alpine3.23@sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4`，
pgvector 锁定 `v0.8.5`、commit
`159b79aaad5983fb7459c1e3df2897fbb2d11788` 和源码归档 SHA-256
`6f88a5cbdde31666f4b6c1a6b75c51dcbeffe58f9a7d2b26e502d5a6e5e14d44`。
该容器是修改后的本地独立容器：PostgreSQL 与 pgvector 使用 PostgreSQL License，
`su-exec@0.3-r0` 使用 MIT，其 peeled commit 为
`89c016e6e08749d583efdeda04b9f73e1218e253`，精确 LICENSE 文本已保留在镜像中，
并替代已从最终镜像删除的 `gosu`。P13 本地镜像
ID `sha256:856ba6c2ed2292bba994e945ebf1bd638d2c1c78c2562bc9c8b57ea6b9138762`
只作为本地构建/扫描证据，不声明远程 registry 产物。

Redis 使用未修改的 Docker Official Image
`redis:8.8.1-alpine3.23@sha256:8096655e437712b07503796fb64d81359256cfcff0ab29d95a7da72863786efb`；
SDAR 对 Redis 8.8.1 选择 `AGPL-3.0-or-later`，精确 `LICENSE.txt` blob 为
`4657905cf699d1d5ac96a07d0969bc79e27c4eec`；Alpine/捆绑包仍保留各自许可证，
Redis 商标规则继续适用。无论镜像是否修改，再分发均须保留 AGPL 通知并提供或安排
Corresponding Source；若修改 Redis 并通过网络提供服务，还须履行 AGPL 第 13 节。

Trivy 仅用于 P13 容器发布证据，不进入 `package.json`、产品运行时或 GitHub
Actions。鉴于 `GHSA-69fq-xp46-6x23` 记录的 2026 年 3 月 Trivy
供应链事件，本次锁定后续不可变发布 `v0.70.0`、commit
`8a3177aedf7ee0864920eb1852eef031cd3742b8`，并按官方 checksum 清单核验
Windows 资产 SHA-256
`eea5442eab86f9e26cd718d7618d43899e72a83767619e8bee47911bddbfb825`。
Trivy 使用 Apache-2.0，精确 LICENSE/NOTICE blob、Intake 和使用边界见
`third_party/sources.lock.yaml`、`third_party/intake/postgres-pgvector-redis-images.md`
及 ADR-124。

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

| 来源                          | 精确 commit                                | 核验许可证                                               | G00 分类与限制                                      |
| ----------------------------- | ------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------- |
| google-gemini/gemini-cli      | `c776c665b00a39d55c470beb788a2b9a77a2feb7` | Apache-2.0；LICENSE blob `7a4a3ea...`; 无根 NOTICE       | design reference；无源码复制                        |
| ECNU-ICALK/AutoSkill          | `94c47ca488d4ba4117d20272e66d49b9877e68cf` | 未确认；只有 README MIT badge，无 LICENSE/NOTICE         | 只允许 clean-room 行为参考；禁止源码/长 Prompt 复制 |
| langchain-ai/langmem          | `a2d580946465137c89162e67dc0b18108bd4850c` | MIT；LICENSE blob `c38f6f2...`; 无根 NOTICE              | clean-room TypeScript 行为参考                      |
| agentscope-ai/ReMe            | `46adb5ae1e94715ecdffe201a46933fbd419a5e1` | Apache-2.0；LICENSE blob `65c2c5c...`; 无根 NOTICE       | RRF/关系扩展行为参考；无 Python 服务                |
| zorazrw/agent-workflow-memory | `8c0ff8cd11d648c8fceb99e4e42f37e3b75381b1` | Apache-2.0；LICENSE blob `261eeb9...`; 无根 NOTICE       | 研究/数据形状参考；无 Python 运行时                 |
| ace-agent/ace                 | `bcb7cea0504afad6f55fec4845dd4864c9f9eee7` | Apache-2.0；`LICENSE.txt` blob `261eeb9...`; 无根 NOTICE | Reflector/Curator 行为参考；不保存 reasoning trace  |

## 发布前要求

- 生成 SBOM；
- 运行许可证扫描；
- 提供 `THIRD_PARTY_NOTICES.md`；
- 所有 vendored 文件具有 source URL、commit 和 license header；
- 不存在未知许可证、未锁定 Git 引用和开发临时源码复制。
