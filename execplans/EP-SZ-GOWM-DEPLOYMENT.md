# SDAR on sz-gowm (2026-09-09)

## Purpose / Outcome
Package and deploy current SDAR on user-designated sz-gowm, consuming existing SMPP and GOWM.

## Requirements Covered
ADR-153 shared business persistence, development deployment, real console and MCP discovery. This is a site deployment, not full product acceptance.

## Context and Orientation
GOWM PostgreSQL 18 is running; ugv_sdar is empty and vector unavailable. GOWM manages ugv_sdar_app credentials. Existing SMPP exposes port 19100. No SDAR exists at preflight.

## Architecture and Interfaces
Runtime uses GOWM_DATABASE_URL and fixed ugv_sdar search_path. Control uses separate sdar_control database in the same existing PostgreSQL container. Dedicated Redis plus three SDAR processes join existing GOWM network. Official GOWM installer owns business DDL.

## Progress
- [x] 2026-09-09 Read referenced task and inspect live services, schema and extension prerequisites.
- [x] 2026-09-09 Add and verify external database deployment mode; final 5 deployment regressions pass.
- [x] 2026-09-09 Package, checksum, transfer, prepare storage and deploy final image 9e515734315c.
- [x] 2026-09-09 Verify external readiness, contract, device binding, 10 MCP tools and minimal model connectivity; report limitations.

## Discoveries and Surprises
GOWM initializes an empty SDAR schema/account but SMPP deployment does not install SDAR or pgvector. Current generic deploy script unconditionally creates two PostgreSQL containers.

## Decision Log
Reuse managed business password without rotation. Keep separate control database per ADR-153. Build existing pinned pgvector 0.8.5 against exact site image. Back up before installer. No device control or model task is needed for deployment verification.

## Implementation Steps
Add explicit shared deployment branch and regression coverage; build package; preserve existing services/configuration; prepare prerequisites; deploy and connect MCP via management API.

## Validation
Focused deployment/GOWM tests; full repository milestone gate commands with precise outcomes; source archive hash; remote contract validation; HTTP readiness, Agent Card and real MCP tools/list.

## Idempotence and Recovery
Preserve secret files and volumes. Official installer uses checksummed history. Keep database backup and original image identity. Stop only SDAR project to roll back application; do not delete shared schema or existing application data.

## Artifacts and Evidence
reports/sz-gowm-deployment-20260909 and artifacts/development.

## Outcomes and Retrospective
Site deployment complete. Evidence: reports/sz-gowm-deployment-20260909/README.md. All milestone gate categories passed; final deployment scripts additionally pass targeted lint and 5 regressions. Existing GOWM/SMPP preserved with official successor binding and pgvector image addition. Full model/A2A business execution and device controls are outside deployment smoke.

2026-09-09 discoveries: package report enumeration overflow, dotenv JSON quoting, rendered Compose double escaping and omitted configuration seeds were corrected with regression or real deployment evidence. Original PostgreSQL volume/password and GOWM/SMPP identities retained. User explicitly authorized model-key migration and brief database recreation after automatic review requested that scope.
