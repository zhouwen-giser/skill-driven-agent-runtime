# OSS Intake: GOWM shared business storage contract

- Official repository: https://github.com/zhouwen-giser/geospatial-operational-world-model
- Component: device-business-storage SQL/API contract, no new npm dependency.
- Exact commit: dca0fcdbbe35f94ddaf968b6489decdbf228755a.
- License: MIT, copyright (c) 2026 GOWM contributors. Exact LICENSE is retained beside the contract.
- Use: unmodified SQL reference, derived consumer metadata and a narrow target SQL consumer in packages/persistence-postgres/src/gowm-targets.ts and gowm-canonical-mcp-link.ts. Source paths and hashes are in `contracts/gowm-shared-storage/current/source.json`.
- Inspected APIs: createTarget, attachTargetToOwner, validateOwner, resolveRemoteTask; installer manifest and four SDAR overlays.
- Capability: consume the user-designated shared storage authority; existing SDAR migrations cannot own or repair GOWM's schema.
- Boundary: PostgreSQL adapter. No GOWM SDK or sibling source imports. Domain owns internal context and state.
- Maintenance: pin one effective contract per integration run; update only for an actual required upstream change, with contract and PostgreSQL tests.
- Quality: native SQL history uses generated schema-relocated hashes, not raw upstream hashes. Nullable canonical is intentional. DDL references are not executable runtime resources.
- Obligations: preserve original license/attribution and source SHA for referenced and derived material.
- Decision: contract reference only, ADR-153. No maintained fork, additional engine or dependency.

- 2026-10-11 re-intake: local owner forward overlay, exact LICENSE blob `3540d7f899ee424553261f70ec38f639a44cc521`; no root NOTICE. Prior native/applied hashes preserved, no new runtime dependency. ADR-162; populated predecessor upgrade and 43 owner PG scenarios verified, consumer verification pending.


Delivery source is the narrow repair cherry-picked onto remote main 9a99369. It excludes unrelated local-base history features. Every consumed source file is byte-identical to the previously tested 2e1af12 repair; new-owner gate evidence is recorded under `reports/functional-closure/owner-delivery/`.
