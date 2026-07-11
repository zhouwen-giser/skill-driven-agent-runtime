# OSS Intake: BullMQ

- Official repository: `https://github.com/taskforcesh/bullmq`
- Package/module: `bullmq@5.80.1`; transitive `ioredis@5.10.1` is exact in BullMQ dependencies.
- Exact tag/commit/version: npm `5.80.1`, commit `418de1e51db09ffc8e95bac35015a1057d8a7271`, integrity `sha512-nV8Bmr28HKqbNOU6GqPVca0vCfW/y6WB7IpnFVmRScx8s6IfXWGiqmDIVMEiNoXKKrfoBBvL/FTzR1SQet0iAg==`.
- License and NOTICE: MIT; verify packaged BullMQ/ioredis licenses through generated license report.
- Requested use: direct Redis-backed queue dependency.
- Files or APIs inspected: Queue, Worker, job options, group/concurrency limitations and connection lifecycle.
- Capability needed: persist queued tasks and dispatch them in a single process with attempts=1.
- Why current authoritative components cannot provide it: BullMQ is explicitly required by the SRS/ADR-005; SDAR still owns task lifecycle and context serialization semantics.
- Boundary/adapter: only `packages/runtime-redis` imports BullMQ/ioredis types; application sees `ContextTaskQueue` and worker callback ports.
- Maintenance and upgrade plan: exact pin and lockfile; real Redis integration tests for same-context serialization, different-context progress, attempts=1 and queued-job restart retention.
- Security/quality findings: BullMQ does not natively guarantee SDAR same-context serialization without an adapter policy; implementation must enforce it explicitly and must not use whole-task automatic retry.
- License obligations: retain MIT licenses and include the complete transitive set in SBOM/notices.
- Decision and ADR: accepted as required queue infrastructure under ADR-005; it is not a workflow runtime or source of truth.
