# SDAR v1.1 MCP Tasks — Final Known Limitations

## Verification boundaries

1. **No external production Provider interoperability claim.** The protocol path uses official SDK transport over real local HTTP, but Provider state machines and business outcomes are deterministic simulations. Production credentials and production systems were not used.
2. **No external production Model claim.** Planning, structured risk and evaluation behavior use a deterministic local Mock Model. Schema validation and runtime boundaries are real; model quality in production is outside this evidence.
3. **DOCX visual QA is unverified.** `source/Agent通用模板Server需求规格说明书_V1.0.docx` was read through direct OOXML structure extraction and compared with the baseline/traceability identifiers. The environment has no `soffice`, so page rendering, pagination, font substitution and visual layout were not verified. The source DOCX was not modified.
4. **Current reports are dirty-worktree evidence.** `V11-ACCEPTANCE`, `V11-LOCAL-DEMO` and the latest verification summary record commit `f97637b4152ef697785167b5df5aa09f9ab7deea` with `dirty=true`. They verify the present code under test but are not clean release-tag provenance.
5. **Release publication is pending.** The final feature-to-main PR and `v1.1.0-rc.1` tag do not exist at audit time. They must not be represented as completed until the exact committed tree is reverified and published through protected branch workflow.

## Accepted product/protocol constraints

- V1.1 supports bounded form-mode `elicitation/create`; sampling, roots and URL elicitation fail closed.
- The exact extension wire is `tasks/update({taskId,inputResponses})`; SDAR validates revisions locally and does not add an unsupported `expectedRevision` field.
- `tasks/update` and `tasks/cancel` acknowledgements are not Provider terminal state. Transport-uncertain operations are recorded and not automatically retried.
- Local Task/Goal cancellation is authoritative for SDAR while the remote binding may remain `cancel_observing` until Provider evidence arrives.
- Provider availability is predictive. Only an explicit guaranteed reservation with a valid reference may be displayed as a reservation.
- Running polling/continuation/input/cancellation work has one attempt and is not recovered or automatically retried; queued PostgreSQL-authoritative work may be reconstructed into Redis.
- Same `context_id` work remains serialized.
- V1 remains a trusted-intranet, no-authentication baseline. Management/Console warnings must remain visible; no hidden multi-tenant or permission model is implied.

## Upstream compatibility boundary

The official MCP Tasks extension is pinned to the reviewed draft commit and schema blobs documented in ADR-090 and the source lock. The official JavaScript client remains an exact v2 beta pin behind the Adapter. Compatibility outside that pinned envelope requires a new intake, ADR and contract gate.
