# OSS Intake: PostgreSQL/pgvector, Redis, and P13 release scanning

## Repository-owned PostgreSQL + pgvector container

- Official repositories: `https://github.com/docker-library/postgres`,
  `https://github.com/pgvector/pgvector`, and
  `https://github.com/ncopa/su-exec`.
- Exact base image:
  `postgres:17.10-alpine3.23@sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4`.
- Exact pgvector source: tag `v0.8.5`, commit
  `159b79aaad5983fb7459c1e3df2897fbb2d11788`, release archive SHA-256
  `6f88a5cbdde31666f4b6c1a6b75c51dcbeffe58f9a7d2b26e502d5a6e5e14d44`.
- Exact build packages: Alpine `build-base@0.5-r3` is installed only in the
  disposable build-dependency group; Alpine `su-exec@0.3-r0` remains in the
  final image.
- Exact privilege helper source: upstream annotated tag `v0.3` object
  `91277f44a686618f16b6ebcb1abe701e626ccb74`, peeled commit
  `89c016e6e08749d583efdeda04b9f73e1218e253`.
- Local build: `infra/postgres/Dockerfile.pgvector-hardened`, tagged
  `sdar/postgres-pgvector:17.10-0.8.5-alpine3.23`. The P13 observed local image
  ID is
  `sha256:856ba6c2ed2292bba994e945ebf1bd638d2c1c78c2562bc9c8b57ea6b9138762`;
  this is local evidence, not a claim that a remote registry artifact exists.
- Reproducible build control: `SOURCE_DATE_EPOCH=0` plus
  `docker compose --project-name sdar build --provenance=false --sbom=false
  postgres`. Two consecutive P13 builds produced the exact image ID above and
  the creation timestamp `1970-01-01T00:00:00Z`; the fixed project identity
  prevents an operator's `COMPOSE_PROJECT_NAME` from entering image metadata.
  The infrastructure helper runs this build before Compose startup, whose
  `pull_policy: never` prevents registry substitution.
- License and NOTICE: PostgreSQL and pgvector use the PostgreSQL License.
  The pgvector `LICENSE` copied into the image has SHA-256
  `6bba9ebeb73e27477463b05e5ef1bf303bccbddb3db9bbc95905d351604d6a87`.
  `su-exec` is MIT; its exact `LICENSE` blob is
  `f623b904e42568d5d8d96c8dee6740c9d456d407`, content SHA-256
  `a0f3f75e286f08be153fd2b7a91788f0bbcd7d5155a40cdca6952742c293fb14`,
  and is retained at `/usr/share/doc/su-exec/LICENSE`; there is no root NOTICE
  at the pinned commit. Alpine packages retain their individual licenses.
- Requested use: modified local standalone container. SDAR compiles the
  checksummed pgvector source into the digest-pinned PostgreSQL base, installs
  `su-exec`, rewrites the entrypoint privilege drop, and removes `gosu`.
- Files and APIs inspected: the exact upstream tag refs, pgvector source
  archive and license, local Dockerfile, OCI metadata, installed APK inventory,
  entrypoint history, and P13 Trivy reports.
- Capability needed: PostgreSQL system of record with pgvector semantic
  storage, required by ADR-005.
- Why the prior component is insufficient: the previous external
  `pgvector/pgvector` Bookworm image retained the vulnerable `gosu` binary and
  did not provide a repository-owned build recipe for the release evidence.
- Boundary: accessed only through `persistence-postgres`; database and
  container types do not enter domain packages.
- Maintenance and upgrade plan: update every base/source/package pin,
  rebuild, record the new local image ID, rerun migration and repository tests,
  rerun the container scan, and refresh SBOM/license evidence.
- Security/quality findings: the final P13 report records Alpine `3.23.5`,
  `su-exec@0.3-r0`, no `gosu` package target, and no Critical/High
  vulnerabilities.
- License obligations: preserve the PostgreSQL and MIT license texts and the
  base-package inventory when distributing the local image.
- Decision and ADR: accepted by ADR-124; ADR-005 storage authority remains
  unchanged.

## Dockerfile frontend build tool

- Official repository/image: `https://github.com/moby/buildkit`,
  `docker/dockerfile`.
- Exact immutable input:
  `docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89`;
  the inspected OCI index reports Dockerfile frontend `1.24.0`, BuildKit
  revision `dd2170e156c9633da1b2d1a58a6188e3f7d36fa4`, and linux/amd64 manifest
  `sha256:e82bbc85c3cb06cf2a5a27b058208b43984448acbcd6a832cd1491933d4376dd`.
- License and NOTICE: Apache-2.0 according to the immutable OCI metadata; at
  embedded revision `dd2170e156c9633da1b2d1a58a6188e3f7d36fa4`, the exact
  `LICENSE` blob is `261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64` and there is no
  root NOTICE.
- Requested use and boundary: build-only parser/frontend required for
  `ADD --checksum`; it is not bundled, is not a product or development
  dependency, and does not enter any SDAR process at runtime.
- Maintenance and upgrade plan: update the parser directive only after
  recording the replacement index/platform digest, embedded version/revision,
  license, and a successful hardened-image rebuild.
- Decision and ADR: accepted by ADR-124.

## Redis

- Official repository/image: `https://github.com/redis/redis`, Docker Official
  Image `redis`.
- Exact source/image: Redis tag `8.8.1`, commit
  `77b6c308396c9700672390a210143a8496fb4b10`, image
  `redis:8.8.1-alpine3.23@sha256:8096655e437712b07503796fb64d81359256cfcff0ab29d95a7da72863786efb`.
- License and NOTICE: Redis 8 offers RSALv2/SSPLv1/AGPLv3 choice; the exact
  `LICENSE.txt` blob is `4657905cf699d1d5ac96a07d0969bc79e27c4eec`.
  SDAR selects `AGPL-3.0-or-later` for the unmodified standalone service.
  Alpine and bundled packages retain their licenses, and Redis trademark rules
  remain applicable.
- Requested use: unmodified external standalone runtime/queue/cache service,
  not linked into SDAR binaries.
- Files and APIs inspected: exact source tag ref, OCI metadata, Redis version
  output, and P13 Trivy report.
- Capability needed: ephemeral state and BullMQ queue persistence required by
  ADR-005.
- Why current authoritative components cannot provide it: PostgreSQL remains
  the system of record and is not the BullMQ queue backend.
- Boundary: accessed only through `runtime-redis`; Redis never owns durable
  candidate/run authority.
- Maintenance and upgrade plan: update the source tag and OCI digest, rerun
  BullMQ compatibility and restart/failure tests, rerun the container scan,
  and refresh SBOM/license evidence.
- Security/quality findings: the exact Alpine image report contains no
  Critical/High vulnerabilities. Ports remain loopback-only development
  defaults; production exposure is prohibited.
- License obligations: preserve the selected AGPLv3 notice and provide or
  arrange Corresponding Source whenever SDAR redistributes the Redis image,
  whether modified or unmodified. A modified Redis network service must also
  satisfy AGPL section 13.
- Decision and ADR: accepted by ADR-124; the service remains unmodified.

## Trivy v0.70.0 release evidence tool

- Official repository: `https://github.com/aquasecurity/trivy`.
- Exact tag/commit/version: `v0.70.0`,
  `8a3177aedf7ee0864920eb1852eef031cd3742b8`.
- Exact Windows release asset:
  `trivy_0.70.0_windows-64bit.zip`, SHA-256
  `eea5442eab86f9e26cd718d7618d43899e72a83767619e8bee47911bddbfb825`.
  The official `trivy_0.70.0_checksums.txt` release asset has SHA-256
  `c45281240bb9211ea9e830fc0bf5cf8acf7c0ca830feb64ac8a0aa932c5c92d9`.
- License and NOTICE: Apache-2.0, exact `LICENSE` blob
  `261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64`, exact `NOTICE` blob
  `3fe97bf7d4b08dfdc5c8f3feab223403d651fec9`.
- Requested use: temporary release evidence tool only. It is not an SDAR
  runtime or development dependency, and its executable is not committed.
- Files and APIs inspected: exact official tag ref, release/checksum metadata,
  LICENSE/NOTICE, and the generated P13 JSON reports.
- Capability needed: scan the final PostgreSQL and Redis container artifacts
  for package inventory and Critical/High vulnerabilities.
- Why current authoritative components cannot provide it: pnpm audit does not
  inspect OS packages or standalone OCI images.
- Boundary: invoked outside application composition; no Trivy API or type
  crosses into SDAR packages.
- Security/quality findings: Aqua's
  `GHSA-69fq-xp46-6x23` records compromised Trivy ecosystem releases and
  actions during March 19-23, 2026. P13 therefore did not use `latest`, a
  GitHub Action, or any affected `0.69.4`/Docker `0.69.5`/`0.69.6` artifact.
  It used the later immutable `v0.70.0` release and verified the Windows asset
  against the official checksum list.
- Maintenance and upgrade plan: each use requires a fresh exact tag/commit,
  official checksum (and signature when available), incident review, and
  source-lock update. The tool must remain outside `package.json`.
- License obligations: retain Apache-2.0 and NOTICE if the tool is ever
  redistributed; P13 does not redistribute it.
- Decision and ADR: temporary use accepted by ADR-124.
