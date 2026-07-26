执行 SDAR v1.3 P01。

输入：
- P00 handoff contract
- 当前最新 origin/main
- 已冻结的 v1.3 总体设计

目标：
实现 Runtime Artifact Domain Contract。

必须先读取：
- AGENTS.md
- P00 Handoff
- 当前架构文档
- Domain 代码结构
- TypeScript 架构门禁

实现范围：
1. CompiledArtifact
2. ArtifactType
3. Lifecycle Status
4. Applicability
5. Dependency Snapshot
6. Lineage Contract
7. Validation Contract
8. Runtime Binding Contract
9. Condition Expression DSL

禁止：
- 创建数据库表
- 创建API
- 创建Runtime执行逻辑
- 直接绑定Skill/MCP
- 修改v1.2.2执行权威

完成后：
- 单元测试
- Schema测试
- 架构检查
- Commit
- 输出Handoff给P02
