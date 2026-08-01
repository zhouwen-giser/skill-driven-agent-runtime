# ADR-123: Pin the patched fast-uri transitive release

## Status

Accepted for SDAR v1.3 P13 release hardening on 2026-07-30.

## Context

The P13 production dependency audit reported High severity advisory
`GHSA-v2hh-gcrm-f6hx` through `ajv@8.20.0 -> fast-uri@3.1.3`, including the Ajv
instance bundled by the MCP SDK. P13 cannot issue a release-candidate-ready
decision with an open High dependency finding.

Replacing Ajv or either frozen MCP SDK would expand the compatibility surface
well beyond a release-hardening repair. `fast-uri@3.1.4` is the upstream
patched release, retains the same package API and BSD-3-Clause license, and is
within Ajv's compatible dependency range.

## Decision

- Add a workspace-level pnpm override that resolves every `fast-uri` edge to
  exactly `3.1.4`.
- Preserve Ajv and the frozen MCP SDK versions and their adapter boundaries.
- Record the exact npm integrity, upstream tag/commit and LICENSE hash in the
  source lock and OSS Intake.
- Require `pnpm audit --prod --audit-level high` to report zero Critical/High
  findings before the P13 decision.
- Remove the override only after every pinned upstream dependency resolves a
  non-vulnerable version and the same release gates pass.

## Consequences

JSON Schema behavior remains behind the existing adapter and no new runtime,
network client or domain authority is introduced. The lockfile changes by one
transitive patch release. Generated SBOM and third-party notices must reflect
`fast-uri@3.1.4`.

One Moderate advisory in an MCP SDK transitive Hono static-server package
remains recorded as a known non-blocking supply-chain limitation; SDAR does not
compose that static-file server into its product path.

## Rejected alternatives

- Leave `3.1.3` and document a waiver: High security findings are not waivable
  under the P13 contract.
- Upgrade or fork the frozen MCP SDKs: unnecessary protocol risk for a
  compatible transitive patch.
- Add a second URI implementation: duplicates an existing dependency and
  creates another parser surface.
