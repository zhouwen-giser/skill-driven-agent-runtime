# OSS Intake: GOWM shared business storage contract

- Official repository: https://github.com/zhouwen-giser/geospatial-operational-world-model
- Component: device-business-storage SQL/API contract, no new npm dependency.
- Exact commit: a1a86186ea866911124de72374e17fe19897fa9e.
- License: MIT, copyright (c) 2026 GOWM contributors. Exact LICENSE is retained beside the contract.
- Use: unmodified SQL reference, derived consumer metadata and a narrow target SQL consumer in packages/persistence-postgres/src/gowm-targets.ts and gowm-canonical-mcp-link.ts. Source paths and hashes are in `contracts/gowm-shared-storage/current/source.json`.
- Inspected APIs: createTarget, attachTargetToOwner, validateOwner, resolveRemoteTask; installer manifest and four SDAR overlays.
- Capability: consume the user-designated shared storage authority; existing SDAR migrations cannot own or repair GOWM's schema.
- Boundary: PostgreSQL adapter. No GOWM SDK or sibling source imports. Domain owns internal context and state.
- Maintenance: pin one effective contract per integration run; update only for an actual required upstream change, with contract and PostgreSQL tests.
- Quality: native SQL history uses generated schema-relocated hashes, not raw upstream hashes. Nullable canonical is intentional. DDL references are not executable runtime resources.
- Obligations: preserve original license/attribution and source SHA for referenced and derived material.
- Decision: contract reference only, ADR-153. No maintained fork, additional engine or dependency.
