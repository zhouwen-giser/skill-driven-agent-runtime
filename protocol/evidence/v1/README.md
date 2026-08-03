# `sdar.evidence/v1`

This directory freezes the sole formal external evidence contract for SDAR v1.4.1.

- Request header: `x-sdar-evidence-contract: sdar.evidence/v1`
- Delivery: at least once
- ACK: contiguous and monotonic; partial ACK is valid
- Record schemas: `../../../schemas/evidence/v1/records/`
- Schema registry: `../../../schemas/evidence/v1/registry.json`
- Legacy header `x-sdar-telemetry-contract` is forbidden after the Phase 4 cutover.

The external sink is a recipient only. It cannot mutate Runtime or Control business authority. The
contract does not include ClickHouse, OTel, dashboards, or a second runtime.

Generate and verify deterministically with:

```bash
pnpm generate:evidence-contract
pnpm verify:evidence-contract
```
