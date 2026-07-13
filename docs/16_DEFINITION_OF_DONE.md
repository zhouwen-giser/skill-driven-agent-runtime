# Definition of Done

## 项目级完成条件

- [ ] 全部需求在 Traceability Matrix 中状态为“已验证”。
- [ ] 全部 AC 场景通过。
- [ ] `pnpm verify` 通过且生成报告。
- [x] A2A 1.0.1 契约有可复现测试证据（ADR-069、`pnpm verify:a2a-baseline`、官方 HTTP+JSON/MUST TCK 与 patch-delta 合约）。
- [ ] PostgreSQL/Redis/MCP/Server/Console 可一键本地启动。
- [ ] Agent Card 动态 Skill、计划确认、流式、Goal、Skill、Workflow、记忆、评估和演化均不是静态 Mock。
- [ ] 控制台所有 P0 页面连接真实管理 API。
- [ ] 数据迁移在空库和升级路径通过。
- [ ] 开源依赖全部锁定，SBOM 和第三方声明完整。
- [ ] 安全风险和首版限制在产品与文档中明确展示。
- [ ] README、架构、API、配置、运行、测试、故障排查、贡献和发布文档完整。
- [ ] 工作树干净，生产构建可生成，Git 历史和 CHANGELOG 可审计。

## 功能项完成条件

一个需求只有同时满足以下条件才可标为完成：

1. 代码已合入；
2. 有自动化测试；
3. 测试命令可复现并通过；
4. 需求追踪记录实现文件、测试文件和证据；
5. API/配置/行为变化已文档化；
6. 没有依赖未批准的临时绕过。
