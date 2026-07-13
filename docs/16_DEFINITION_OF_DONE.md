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
- [x] 开源依赖全部锁定；统一门禁验证 17 个来源 pin、306 个 npm 包、2 个外部服务、SBOM 和 Third-Party Notices。
- [x] 安全风险和首版限制在 README、风险文档、health、Console 与发布清单中明确展示并由测试验证。
- [x] README、架构、API、配置、运行、测试、故障排查、贡献和发布文档完整并互相链接。
- [ ] 工作树干净，生产构建可生成，Git 历史和 CHANGELOG 可审计。

## 功能项完成条件

一个需求只有同时满足以下条件才可标为完成：

1. 代码已合入；
2. 有自动化测试；
3. 测试命令可复现并通过；
4. 需求追踪记录实现文件、测试文件和证据；
5. API/配置/行为变化已文档化；
6. 没有依赖未批准的临时绕过。
