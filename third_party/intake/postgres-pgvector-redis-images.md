# OSS Intake: PostgreSQL/pgvector and Redis container images

## PostgreSQL + pgvector

- Official repository/image: `https://github.com/pgvector/pgvector`, `pgvector/pgvector` on Docker Hub.
- Exact image: tag `0.8.4-pg17-bookworm`, linux/amd64 manifest `sha256:da864cc9983d6a346c39c55c8c5250d752a9b573bbac06b1c3ad5d72f20f5be6`.
- License: PostgreSQL License for PostgreSQL; pgvector uses the PostgreSQL License. Base-image packages retain their licenses.
- Requested use: unchanged local infrastructure service.
- Capability: PostgreSQL system of record with pgvector semantic storage, required by ADR-005.
- Boundary: accessed only through `persistence-postgres`; database/container types do not enter domain packages.
- Upgrade plan: explicit tag/digest update, migration tests, backup/rollback notes and license/SBOM refresh.

## Redis

- Official repository/image: `https://github.com/redis/redis`, Docker Official Image `redis`.
- Exact image: tag `8.2.7-alpine3.22`, linux/amd64 manifest `sha256:e762b8716f68d0de494b9fecc5a598db03e24206d3266725dd5521ca2c8b18a3`.
- License: Redis 8 offers RSALv2/SSPLv1/AGPLv3 choice; SDAR selects AGPLv3 for the unmodified standalone service. Alpine and bundled packages retain their own licenses.
- Requested use: unchanged local runtime/queue/cache service, not linked into SDAR binaries.
- Capability: ephemeral state and BullMQ queue persistence required by ADR-005.
- Boundary: accessed only through `runtime-redis`; Redis is not a system of record.
- Security/quality: selected 8.2.7 security-maintained release instead of an older permissively licensed Redis with known security gaps. Ports are local development defaults and production exposure is prohibited.
- Upgrade plan: exact digest update, BullMQ compatibility and restart/failure tests, SBOM/license refresh.

## Decision

Accepted under ADR-005. Images remain external services; no image source is copied or modified. Distribution must include the generated image/software license inventory and AGPLv3 notice for Redis.
