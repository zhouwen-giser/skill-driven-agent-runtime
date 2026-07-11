# 需求追踪矩阵

Codex 必须持续更新本表。状态只允许：未实现 / 开发中 / 已实现待验证 / 已验证 / 阻塞。

| 需求编号     | 阶段  | 最低测试层级         | 状态   | 实现文件 | 测试文件 | 验证证据 |
| ------------ | ----- | -------------------- | ------ | -------- | -------- | -------- |
| FR-A2A-001   | EP-01 | contract+e2e         | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-A2A-002   | EP-01 | contract+e2e         | 开发中 | `packages/a2a-adapter/src/compatibility.ts`; `packages/a2a-adapter/src/http-endpoint-spike.ts` | `packages/a2a-adapter/test/a2a-compatibility.contract.test.ts`; `packages/a2a-adapter/test/http-endpoint.contract.test.ts` | `pnpm test:contract`：A2A 1.0 Agent Card、REST submit/get、协议版本边界与标准流式事件通过；完整 1.0.1 TCK 待 EP-01 |
| FR-A2A-003   | EP-01 | contract+e2e         | 开发中 | `packages/a2a-adapter/src/compatibility.ts`; `packages/a2a-adapter/src/http-endpoint-spike.ts` | `packages/a2a-adapter/test/a2a-compatibility.contract.test.ts`; `packages/a2a-adapter/test/http-endpoint.contract.test.ts` | `pnpm test:contract`：仅观察官方 submitted/working/completed 状态；完整内部阶段映射待 EP-01 |
| FR-A2A-004   | EP-01 | contract+e2e         | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-A2A-005   | EP-01 | contract+e2e         | 开发中 | `packages/a2a-adapter/src/http-endpoint-spike.ts` | `packages/a2a-adapter/test/http-endpoint.contract.test.ts` | `pnpm test:contract`：官方 REST 非流式、标准流式与客户端断流后任务继续并可轮询完成通过；生产 Task service 集成待 EP-01 |
| FR-A2A-006   | EP-01 | contract+e2e         | 开发中 | `packages/a2a-adapter/src/compatibility.ts` | `packages/a2a-adapter/test/a2a-compatibility.contract.test.ts`; `packages/a2a-adapter/test/http-endpoint.contract.test.ts` | `pnpm test:contract`：Agent Card 从启用 Skill 输入动态构造；持久化 Skill 变更刷新待 EP-02 |
| FR-A2A-007   | EP-01 | contract+e2e         | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-A2A-008   | EP-01 | contract+e2e         | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-A2A-009   | EP-01 | contract+e2e         | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-A2A-010   | EP-01 | contract+e2e         | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-A2A-011   | EP-01 | contract+e2e         | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-A2A-012   | EP-01 | contract+e2e         | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-GOAL-001  | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-GOAL-002  | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-GOAL-003  | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-GOAL-004  | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-GOAL-005  | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-GOAL-006  | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-GOAL-007  | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-GOAL-008  | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-001   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-002   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-003   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-004   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-005   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-006   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-007   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-008   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-009   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-010   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-011   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-012   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-013   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-014   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-015   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-001   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-002   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-003   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-004   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-005   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-006   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-007   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-008   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-009   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-010   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MCP-001   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MCP-002   | EP-02 | unit+integration     | 开发中 | `packages/mcp-adapter/src/streamable-http-spike.ts` | `packages/mcp-adapter/test/streamable-http.contract.test.ts` | `pnpm test:contract`：官方 SDK Streamable HTTP 真实 loopback 发现、调用、Schema 拒绝与 AbortSignal 取消通过；正式 Registry Adapter 待 EP-02 |
| FR-MCP-003   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MCP-004   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MCP-005   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MCP-006   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MCP-007   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MCP-008   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MCP-009   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MCP-010   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MCP-011   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MCP-012   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MCP-013   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-LLM-001   | EP-03 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-LLM-002   | EP-03 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-LLM-003   | EP-03 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-LLM-004   | EP-03 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-LLM-005   | EP-03 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-LLM-006   | EP-03 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-LLM-007   | EP-03 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-LLM-008   | EP-03 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-001    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-002    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-003    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-004    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-005    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-006    | EP-03 | unit+integration+e2e | 开发中 | `packages/langgraph-runtime/src/dynamic-graph-spike.ts` | `packages/langgraph-runtime/test/dynamic-graph.unit.test.ts` | `pnpm test:unit`：LangGraph StateGraph 条件路由和有界循环真实执行通过；完整 DSL compiler 待 EP-03 |
| FR-WF-007    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-008    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-009    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-010    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-001   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-002   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-003   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-004   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-005   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-006   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-007   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-008   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-009   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-010   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-RST-001   | EP-04 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-RST-002   | EP-04 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-RST-003   | EP-04 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-RST-004   | EP-04 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-RST-005   | EP-04 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-RST-006   | EP-04 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MEM-001   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MEM-002   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MEM-003   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MEM-004   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MEM-005   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MEM-006   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVAL-001  | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVAL-002  | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVAL-003  | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVAL-004  | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVAL-005  | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-ADM-001   | EP-06 | api contract+e2e     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-ADM-002   | EP-06 | api contract+e2e     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-ADM-003   | EP-06 | api contract+e2e     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-ADM-004   | EP-06 | api contract+e2e     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-ADM-005   | EP-06 | api contract+e2e     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-ADM-006   | EP-06 | api contract+e2e     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-ADM-007   | EP-06 | api contract+e2e     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-ADM-008   | EP-06 | api contract+e2e     | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-PERF-001 | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-PERF-002 | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-REL-001  | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-REL-002  | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-SEC-001  | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-SEC-002  | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-OBS-001  | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-OBS-002  | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-MNT-001  | EP-07 | non-functional+e2e   | 开发中 | `packages/a2a-adapter/`; `packages/mcp-adapter/`; `packages/langgraph-runtime/`; `compose.yaml` | 各 adapter/runtime contract/unit tests | `pnpm verify:bootstrap`：strict module boundaries 初始门禁通过；全模块依赖守卫待 EP-07 |
| NFR-COMP-001 | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-DATA-001 | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-UX-001   | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
