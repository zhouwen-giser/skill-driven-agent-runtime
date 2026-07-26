# Definition of Done

## 项目级完成条件

- [x] 全部需求在 Traceability Matrix 中状态为“已验证”。
- [x] 全部 18 个 AC 场景通过，并生成 `reports/EP-07-hardening-acceptance/V1-ACCEPTANCE-AUDIT.{md,json}`。
- [x] `pnpm verify` 通过且生成 `reports/verification/summary.json` 与 Markdown 摘要。
- [x] A2A 1.0.1 契约有可复现测试证据（ADR-069、`pnpm verify:a2a-baseline`、官方 HTTP+JSON/MUST TCK 与 patch-delta 合约）。
- [x] `pnpm demo:acceptance` 一键构建并启动 PostgreSQL/Redis/Mock Model/Mock MCP/Server/Console，运行示例 A2A Client 和全部组合场景后清理。
- [x] Agent Card 动态 Skill、计划确认、流式、Goal、Skill、Workflow、记忆、评估和演化均由 41 场景 composed E2E 验证，不使用静态业务响应。
- [x] 控制台所有 P0 页面连接真实管理 API；production bundle smoke、102-operation contract 和真实浏览器关联导航通过。
- [x] `pnpm verify:migrations` 在隔离数据库中验证空库迁移和历史 0049→0053 升级路径。
- [x] 开源依赖全部锁定；统一门禁验证 17 个来源 pin、284 个跨平台当前锁文件 npm 包、2 个外部服务、SBOM 和 Third-Party Notices；主机专属可选二进制由其跨平台包装包覆盖。
- [x] 安全风险和首版限制在 README、风险文档、health、Console 与发布清单中明确展示并由测试验证。
- [x] README、架构、API、配置、运行、测试、故障排查、贡献和发布文档完整并互相链接。
- [x] 工作树干净，生产构建可生成，Git 历史和 CHANGELOG 可审计；独立 clean checkout/frozen install 门禁通过。

## 功能项完成条件

一个需求只有同时满足以下条件才可标为完成：

1. 代码已合入；
2. 有自动化测试；
3. 测试命令可复现并通过；
4. 需求追踪记录实现文件、测试文件和证据；
5. API/配置/行为变化已文档化；
6. 没有依赖未批准的临时绕过。

## v1.1 MCP Tasks 发布状态

- [x] Phase 0–6 功能增量完成，AC-MCPT-01–16 有机器可读和人工可读的真实/模拟分类证据。
- [x] `pnpm demo:acceptance` 通过 build、10 Provider contract、402 unit、80 real integration、49 real E2E 和验收报告校验。
- [x] clean self-managed Compose `pnpm verify` 在提交 `13194b8` 上以 162.0 秒通过 75 files/493 unit+contract、80 integration、49 E2E、232-source architecture、110-operation OpenAPI、68 migration pairs 和两阶段 smoke。
- [x] 迁移 0104 与 restart integration 证明 external-wait 可由 PostgreSQL 恢复，普通 running Task 仍不恢复、不自动重试。
- [x] 管理 API/Console 连接真实 remote Task lifecycle 查询与 operator action，并明确无认证、Provider 权威和操作副作用告警。
- [x] Phase 6 变更已形成干净 Conventional Commit；精确提交 `38356ea` 的隔离 frozen-install、`pnpm verify` 与 `pnpm demo:local` 已复核。
- [x] `v1.1.0-rc.1` 已在 `38356ea` 上创建并非强制推送，远程 peeled ref 与该提交一致。
- [x] 最终 ready PR #4 已按规定标题创建并指向 `main`；GitHub 报告 `MERGEABLE` 且当前无配置的 status-check runs。受保护 review/merge 与稳定 tag 仍必须在 PR 后完成。

因此 v1.1 RC 的功能、证据和发布级 Definition of Done 已完成。不得把 RC 称为稳定版本；稳定 `v1.1.0` 只能在 PR 受保护合并后的发布提交上创建。

## v1.2 Skill-driven capability usage release addendum

- [x] The existing Registry, Selection, Skill Graph, Workflow Validator/Planner and single LangGraph
      runtime are extended; there is no duplicate runtime, Provider authority or lifecycle state machine.
- [x] Native exact-version packages separate normative/adaptive/observed content, pass bounded secure
      import validation and keep PostgreSQL as runtime authority; legacy Skills remain executable.
- [x] Discovery, applicability, context evidence, three modes, fixed/dynamic composition, depth 3/hard
      5, four failure policies, Task/Provider policy, no-Skill fallback and plan compliance are verified.
- [x] Move-to and recursive area-patrol verticals cover available/restricted/disabled/unknown,
      windows, required/preferred Provider, input, cancel, restart, parent/child wait and no replay.
- [x] Append-only Skill execution trees expose exact plan/task/provider/resource/evidence, hard-gate,
      intervention and degraded-outcome references without replacing authoritative records.
- [x] Phase 14 closes every required adversarial finding with a regression test; no required finding is
      deferred.
- [x] Phase 15 explicit command matrix and clean full `pnpm verify` pass on `b3b6e67`.
- [x] Final human/JSON acceptance evidence is published, the branch is pushed and PR #5 is Ready for
      Review without automatic merge.

## v1.2.1 Frozen MCP Tasks addendum

- [x] Frozen source/schema/lock, explicit dual Handler, stateless HTTP, Task lifecycle, Availability,
      Notification, Evidence A, Management operations and local component conformance are implemented.
- [x] `embodied.move_to`, `embodied.area_patrol` and all 16 Legacy MCP Tasks scenarios are locally
      requalified with real PostgreSQL/Redis and explicitly simulated Providers.
- [x] All 26 required Frozen adversarial classes have reproducible owning-layer evidence.
- [x] The restored dependency tree passes the refreshed complete self-managed local command matrix with 650/650
      unit+contract, 84/84 integration, 60/60 E2E, migrations, build and both smoke stages.
- [x] The external Provider Runtime passes strict real interop for Availability, MRTR/terminal Task
      creation and byte-equivalent Poll/Notification projections.
- [x] The refreshed complete final command matrix passes on restored dependencies at clean exact commit
      `61142f9` with `dirty=false`.
- [x] G4 Interop Certified passes against Provider implementation commit `b30d839`; Provider PR #16 final
      evidence head `4d90b199` passes `runtime-ci` and `runtime-compose` in Actions run `29882714727`.
- [ ] G5 Release Ready passes with no required deferred items; protected Provider PR #16 review/merge remains.

Therefore v1.2.1 remains unreleased and PR #6 remains Draft until Provider PR #16 is merged. Component
Conformant does not imply Interop Certified; see the Phase 11 and Phase 12 reports.

## v1.2.2 User Goal Planning and Business Events addendum

- [x] G00–G10 and AC-001–AC-078 have implementation, automated/repeatable tests, documentation,
      evidence and independent commits.
- [x] The clean-slate baseline removes Legacy MCP/Skill projection and competing terminal authority;
      `UserGoalPlanController` is the sole User Goal/A2A terminal authority.
- [x] User Goal contract/planning, Skill Goal DAG/scheduler/attempts, layered judgment and bounded
      progress/recovery/no-replay are composed through the sole LangGraph Workflow runtime.
- [x] The strict Business Events client, durable dual cursors, generation/continuity/relation handling,
      impact assessment, Incident/handling Goal and plan revision are verified.
- [x] Exact Provider assets are locked to `8a81b1b`; real Streamable HTTP Provider interop passes Task,
      Event, Drain, Reset, Relation, unavailability, restart and reconnect without modifying Provider.
- [x] Clean unified verification passes 629 unit/contract, 68 real integration, 59 E2E, migrations,
      production build, A2A MUST, infrastructure and Server/Console smoke, including the Console
      v1.2.2 DAG/Judgment/Event view regression.
- [x] Security/capacity/SBOM/Compose and an isolated real PostgreSQL restart audit pass; trusted-intranet
      and claim boundaries remain explicit.
- [x] Failed gate/interop attempts are retained. The release action is a Draft PR only; no merge or tag
      is authorized.
- [x] Evidence commit `3ba0d59` is pushed and Draft PR #7 is open, Draft and `MERGEABLE/CLEAN`; no
      configured checks, merge or tag exist.

## v1.2.3 Cognitive Planning Runtime addendum

- [x] G00–G17 and AC-G00-01 through AC-G17-09 have implementation, tests, traceability and reports.
- [x] The online Understand→Clarify→Goal/Plan confirm→v1.2.2 loop and offline
      Fact→Episode→Observation→Candidate→Replay/Promotion→Reuse loop are composed without a second
      runtime or authority.
- [x] Clean `pnpm verify` on `7e50541` passes 765 Unit+Contract, 84 real Integration, 62 real E2E,
      Replay, 17 migrations, production builds and both smoke stages with `dirty=false`.
- [x] Recovery, scope/deletion, prompt/Card privacy, capacity/backpressure, retention and the frozen
      rollout policy have classified evidence.
- [x] A2A MUST 74/74, OpenAPI 152/152, 425-source architecture, 27 source pins, license/NOTICE and SBOM
      gates pass.
- [x] The release report explicitly states Experience is advisory, no Python sidecar exists and the
      cognitive runtime never automatically publishes a Skill.
- [ ] PR #9 was externally merged under the repository-owner identity after the authorized Ready
      transition. No Codex Merge call or tag occurred. The timeline does not prove native auto-merge,
      and the required unmerged protected-review state cannot be claimed.
