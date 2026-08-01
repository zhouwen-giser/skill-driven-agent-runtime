# ADR-124: Harden and pin the P13 container supply chain

## Status

Accepted for SDAR v1.3 P13 release hardening on 2026-07-30.

## Context

SDAR requires PostgreSQL/pgvector as its durable system of record and Redis as
ephemeral BullMQ/cache infrastructure. The prior compose file pinned image
digests but delegated PostgreSQL/pgvector assembly to an external Bookworm
image. P13 container scans found that candidate image paths retained the
standalone `gosu` executable with actionable vulnerabilities.

The release audit also needs an OCI-aware scanner. Aqua's March 2026 advisory
`GHSA-69fq-xp46-6x23` documents compromised Trivy `v0.69.4`,
`trivy-action`, `setup-trivy`, and later Docker Hub `v0.69.5`/`v0.69.6`
artifacts. A mutable `latest` download or GitHub Action reference is therefore
not acceptable evidence.

## Decision

- Build PostgreSQL locally from
  `infra/postgres/Dockerfile.pgvector-hardened` and tag the result
  `sdar/postgres-pgvector:17.10-0.8.5-alpine3.23`.
- Pin the base by digest to
  `postgres:17.10-alpine3.23@sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4`.
- Pin the Dockerfile frontend to immutable index digest
  `docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89`
  (frontend `1.24.0`, embedded BuildKit revision
  `dd2170e156c9633da1b2d1a58a6188e3f7d36fa4`) and use exact Alpine
  `build-base@0.5-r3` only as a disposable build dependency.
- Fetch pgvector only from tag `v0.8.5` (commit
  `159b79aaad5983fb7459c1e3df2897fbb2d11788`) with archive SHA-256
  `6f88a5cbdde31666f4b6c1a6b75c51dcbeffe58f9a7d2b26e502d5a6e5e14d44`.
- Replace `gosu` in the final entrypoint with Alpine `su-exec@0.3-r0` from
  peeled upstream commit `89c016e6e08749d583efdeda04b9f73e1218e253`, remove the
  `gosu` binary, and retain the checksummed MIT text in the final image.
  PostgreSQL and pgvector remain under the PostgreSQL License; su-exec is MIT.
- Attribute the modified image to the SDAR repository with
  `org.opencontainers.image.source`; record pgvector and su-exec upstreams in
  separate provenance labels.
- Set `SOURCE_DATE_EPOCH=0` and invoke the Compose build with
  fixed project identity `--project-name sdar` and
  `--provenance=false --sbom=false`. The infrastructure helper owns that exact
  invocation before `compose up`; it does not inherit an operator's
  `COMPOSE_PROJECT_NAME` for image construction. Compose uses
  `pull_policy: never` for the resulting repository-owned image so startup
  cannot replace it with an unrelated registry artifact.
- Pin Redis to the unmodified Docker Official Image
  `redis:8.8.1-alpine3.23@sha256:8096655e437712b07503796fb64d81359256cfcff0ab29d95a7da72863786efb`
  and select the Redis `AGPL-3.0-or-later` licensing option.
- Use Trivy only as a temporary release evidence tool. Pin `v0.70.0` to commit
  `8a3177aedf7ee0864920eb1852eef031cd3742b8` and accept the Windows archive
  only when its SHA-256 is
  `eea5442eab86f9e26cd718d7618d43899e72a83767619e8bee47911bddbfb825`,
  matching the official checksum list. Do not add Trivy to `package.json`, the
  runtime, or GitHub Actions.
- Make the static compose verifier reject any drift in the local Dockerfile
  path, base/source checksums, final image names, Redis digest, loopback ports,
  mutable image tags, parser directive, ADD destinations, exact build packages,
  deterministic build controls, or the single `pull_policy: never` declaration.
- Treat Compose health as an internal signal, not host-readiness proof. The
  test infrastructure waits past the PostgreSQL initialization server, probes
  PostgreSQL and Redis through the actual loopback endpoints, and
  force-recreates disposable service containers so a failed Docker port
  allocation cannot leave a healthy but unreachable container. Named volumes
  remain preserved.

The observed local PostgreSQL image ID for P13 is
`sha256:856ba6c2ed2292bba994e945ebf1bd638d2c1c78c2562bc9c8b57ea6b9138762`.
It is evidence for the local build and scan, not a claim that a remote
registry artifact exists.

## Consequences

The PostgreSQL container is now an explicitly modified SDAR build and must be
documented as such in the SBOM, license report, third-party notices, source
lock, and intake. A rebuild or dependency update must refresh the observed
image ID and scan evidence; tags alone are not sufficient.

Two consecutive P13 builds with the exact helper flags produced the same image
ID and the epoch creation timestamp `1970-01-01T00:00:00Z`. BuildKit
attestation manifests are intentionally disabled here because their generated
metadata made the locally loaded manifest identity change despite identical
runtime layers. Release SBOM and vulnerability evidence remain explicit
separate artifacts.

Redis remains an unmodified standalone service and PostgreSQL remains the
system of record. This ADR does not change ADR-005's persistence/queue
authority boundary and introduces no second runtime.

Trivy remains excluded from product and development dependency graphs. Every
future release-tool update requires exact tag/commit and official artifact
verification plus a review of any new supply-chain advisory.

## Rejected alternatives

- Continue using the external pgvector Bookworm image: it leaves the
  PostgreSQL assembly and vulnerable privilege helper outside repository
  control.
- Remove privilege dropping: this weakens the container boundary.
- Replace Redis with PostgreSQL polling: this violates the accepted BullMQ
  runtime architecture.
- Use Trivy `latest` or a mutable action tag: this cannot provide trustworthy
  post-incident release evidence.
- Trust only container-internal health in Docker Desktop tests: the Windows
  host port proxy can still be absent or not ready.
