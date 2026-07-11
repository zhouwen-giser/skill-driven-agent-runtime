# EP-02 MCP 与 Skill 基础

## Purpose / Outcome

管理员可注册远程 MCP、发现/刷新 Tool、增强元数据；可创建 Skill 草案、生成 Schema、验证/发布/版本化，并动态投影到 Agent Card。

## Requirements Covered

FR-SKL-001, FR-SKL-002, FR-SKL-003, FR-SKL-004, FR-SKL-005, FR-SKL-006, FR-SKL-007, FR-SKL-008, FR-SKL-009, FR-SKL-010, FR-SKL-011, FR-SKL-012, FR-SKL-013, FR-SKL-014, FR-SKL-015, FR-MCP-001, FR-MCP-002, FR-MCP-003, FR-MCP-004, FR-MCP-005, FR-MCP-006, FR-MCP-007, FR-MCP-008, FR-MCP-009, FR-MCP-010, FR-MCP-011, FR-MCP-012, FR-MCP-013

## Context and Orientation

开始前阅读需求基线、架构基线、相关 ADR、开源复用策略和现有代码。执行者不能假设拥有之前会话记忆。

## Deliverables

- [ ] MCP registry and encrypted credentials
- [ ] Tool discovery/call envelope and mock server
- [ ] Skill model/version/relation/search
- [ ] LLM schema generation and validation
- [ ] management APIs and minimal real console pages

## Progress

- [ ] 读取材料并记录当前代码状态。
- [ ] 将具体文件、接口和步骤补充到本计划。
- [ ] 完成实现增量。
- [ ] 完成测试与验证。
- [ ] 更新 Traceability Matrix、PROJECT_STATUS、ADR 和 Outcomes。

## Discoveries and Surprises

执行期间持续追加，包含 SDK 实际行为、失败测试和与原假设不同之处。

## Decision Log

执行期间持续追加；重大决定另建 ADR。

## Implementation Steps

1. 建立或更新本阶段接口和数据设计。
2. 先实现确定性核心和测试替身。
3. 完成真实 Adapter/Repository/Runtime。
4. 打通最短端到端链路。
5. 扩展边界、失败、取消和可观测性。
6. 完成管理接口/UI（适用时）。
7. 运行完整验证并修复全部失败。

## Validation

- [ ] `MCP integration tests`
- [ ] `invalid Skill schema registration fails`
- [ ] `Skill enable/disable changes Agent Card`
- [ ] `tool schema refresh warning behavior`

## Idempotence and Recovery

- Migration、种子和脚本必须可重复运行或明确一次性约束。
- 外部 Tool 使用 Mock；不得操作生产系统。
- 阶段失败后保持可构建，记录恢复命令和未完成项。

## Artifacts and Evidence

将报告保存到 `reports/EP-02-mcp-skill-foundation/`，并在 Traceability Matrix 中引用。

## Outcomes and Retrospective

阶段完成后记录实际交付、未完成项、技术债、性能数据和对后续阶段的影响。
