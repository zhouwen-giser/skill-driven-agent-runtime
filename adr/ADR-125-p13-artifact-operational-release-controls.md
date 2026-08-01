# ADR-125: P13 Artifact operational release controls

## Status

Accepted for SDAR v1.3 P13.

## Context

P02/P07 froze seven Artifact mode, type, gateway and tenant flags. They did not
independently stop compiler, registry, shadow, promotion, retrieval or Model
Route composition, and they did not provide an exact-version Artifact canary
allowlist. P13 requires each release layer to be independently disabled without
moving Artifact, Goal, Plan or execution authority.

## Decision

- Preserve the seven frozen flag names and add:
  `SDAR_V13_COMPILER_ENABLED`, `SDAR_V13_REGISTRY_ENABLED`,
  `SDAR_V13_SHADOW_ENABLED`, `SDAR_V13_PROMOTION_ENABLED`,
  `SDAR_V13_RETRIEVAL_ENABLED`, `SDAR_V13_MODEL_ROUTE_ENABLED` and
  `SDAR_V13_ARTIFACT_ALLOWLIST`.
- Every additive boolean defaults to `false`; only the lowercase literals
  `true` and `false` are valid.
- The Artifact allowlist contains exact `artifactId:version` references.
  Empty means deny all; malformed or duplicate references fail startup.
- Parse the complete flag set before opening runtime infrastructure. Compose
  compiler, registry, shadow, promotion, retrieval, template, gateway and Model
  paths only when every required layer is enabled.
- Apply the same controls to the authenticated P12 management command path
  before it reaches Artifact governance. Promotion-package creation, approval,
  rejection and activation require the promotion flag; shadow and revalidation
  requests require the shadow flag. Deprecation, rollback and kill-switch
  commands remain available as emergency safety controls while those paths are
  stopped.
- Evaluate the effective validation semantic before the command policy.
  `validate` carrying `validationType=shadow` is governed as `shadow`, and
  `validate` carrying `validationType=revalidation` is governed as
  `revalidate`. A route-name alias cannot bypass a disabled shadow path.
- Enforce retrieval and the exact Artifact allowlist before both index and
  definition use. A projection or cache cannot bypass the controls.
- Keep these controls outside domain authority. They can prevent a path from
  being composed or selected; they cannot approve, activate or rewrite an
  Artifact and cannot create a formal Goal, Plan, Attempt or Outcome.

## Consequences

The v1.3 compiled path is intentionally unavailable until an operator enables
the required layers and allowlists an approved exact Artifact version. Compiler
and shadow evidence can be enabled without active retrieval. Model Route can be
stopped independently from Case and the base cognitive planner remains the
fallback.

Configuration changes require a controlled process restart in this V1
single-process runtime. Dynamic production rollout orchestration is not added.

## Rejected alternatives

- One global flag: cannot isolate compiler, promotion and runtime failures.
- Empty allowlist means allow all: unsafe for initial rollout.
- Artifact ID without version: permits an unreviewed version to enter a canary.
- Silent ignore of malformed values: makes rollback state ambiguous.
- Route-name-only management policy: permits validation-type aliases to bypass
  the intended release stop control.
- Redis-owned kill switch: violates PostgreSQL authority and restart safety.
