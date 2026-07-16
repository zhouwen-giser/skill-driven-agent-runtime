# v1.0.7 Known Issues

Date: 2026-07-16

- No known feature-scope correctness issue is accepted for publication; the adversarial bug-fixed audit remains mandatory after the feature tag.
- The canonical A2A metadata key is `structured_input`; `sdar_structured_input` is a compatibility alias and loses if both keys are present.
- Long-term Memory is deliberately non-authoritative for live device state. Current state must still come from MCP execution.
- Temporary Skills retain their existing request envelope. This increment applies the formal `inputSchema` contract to registered top-level Skills and preserves independent child Skill validation.
