# v1.0.7 Known Issues

Date: 2026-07-16

- No known correctness issue remains after the adversarial bug-fixed audit and full version gate.
- The canonical A2A metadata key is `structured_input`; `sdar_structured_input` is a compatibility alias and loses if both keys are present.
- Long-term Memory is deliberately non-authoritative for live device state. Current state must still come from MCP execution.
- Temporary Skills retain their existing request envelope. This increment applies the formal `inputSchema` contract to registered top-level Skills and preserves independent child Skill validation.
- A Goal Patch whose patched contract cannot resolve the selected formal Skill input fails before invalidation; the caller clarifies input and retries the Patch rather than resuming a partially applied Patch.
