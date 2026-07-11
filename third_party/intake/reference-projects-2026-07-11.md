# OSS Intake: Reference-only agent projects

This intake records reproducible source snapshots used only for API/design research. No source was copied, vendored, compiled or introduced into the SDAR runtime.

| Project | Exact commit | License observed at commit | Classification | Prohibited boundary |
| --- | --- | --- | --- | --- |
| Mastra | `1b2f2cca30f04f2cb8e20df661733a1367d779a0` | core license requires path-level review; `ee/` is excluded | API/design reference | no `ee/`, no Runtime integration |
| VoltAgent | `0d8c7f98a1086eddd09da07d55cf0b29320ddee7` | MIT baseline; services/packages require path review | API/design reference | no second Agent Runtime |
| OpenHands | `e3185990ddece1a8ffd31fcc5ece38789436d4c6` | root license explicitly assigns `enterprise/` a separate license; remainder MIT | API/design reference | no `enterprise/` or commercial repositories |
| Dify | `6e5ba18d65e78f7ab04f46c5ba4e4b5011df07f8` | modified Apache-2.0 / Dify Open Source License | UX/information architecture observation only | no source copying, adaptation or vendoring |
| Google ADK JS | `2ff0643133455ed748f3b4085ece32cb0027c12c` | Apache-2.0 | API/design reference | no Runtime integration |
| BeeAI Framework | `0689b10f87b3bba82049e49984996646c05bdb2a` | Apache-2.0 | API/design reference | no Runtime integration |
| Microsoft Agent Framework | `68136ee081dbbee6983e6bb92a834f9ad30d20dc` | MIT | API/design reference | no .NET/Python or second Runtime integration |

## Capability and authority check

The authoritative implementation for workflow execution is LangGraph.js. A2A and MCP behavior comes from their official JavaScript/TypeScript SDKs. Goal, Skill, Workflow DSL, validation, compilation, result processing, memory, evaluation and evolution remain SDAR-owned. Therefore none of these reference projects supplies a capability that should replace an authoritative component.

## Maintenance and license obligations

- `third_party/sources.lock.yaml` records the snapshot commit used for research.
- Any future code adaptation, package dependency or maintained fork requires a new project-specific intake and ADR before work starts.
- Dify code remains prohibited. Mastra `ee/` and OpenHands `enterprise/` remain prohibited.
- Reference-only inspection creates no redistribution payload; citations and commit pins remain in project research documentation.

## Decision and ADR

ADR-006 remains accepted: reference snapshots may inform design, but cannot enter the core execution chain or become production dependencies without a new decision.
