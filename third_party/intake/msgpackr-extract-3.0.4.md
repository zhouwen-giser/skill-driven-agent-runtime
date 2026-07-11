# OSS Intake: msgpackr-extract

- Official repository: `https://github.com/kriszyp/msgpackr-extract`
- Package/module: `msgpackr-extract@3.0.4` (transitive optional native acceleration for BullMQ's msgpackr dependency)
- Exact tag/commit/version: npm `3.0.4`, commit `71def7bd969e5c88d2c918e0d81ee2ba3155d19c`, integrity `sha512-4kmO/MdyUIkLIvTPr8VHLil4AtoKIoniWPIEk5+CDy0xnWC84azhSFmuJ7PxZdsYtiP5kEeQsORAVIeMgxT+Hw==`.
- License and NOTICE: MIT; packaged license included in generated license inventory.
- Requested use: transitive runtime optimization; install script selects an optional platform package or builds via node-gyp.
- Files or APIs inspected: npm metadata and install/recompile scripts. SDAR imports no APIs from this package.
- Capability needed: selected by BullMQ's exact dependency graph; not an SDAR domain capability.
- Why current authoritative components cannot provide it: independently replacing a transitive native helper would fork BullMQ's tested dependency graph.
- Boundary/adapter: transitive under `packages/runtime-redis`; no direct imports.
- Maintenance and upgrade plan: permit only this named build script in pnpm allowBuilds; re-review on version/script changes.
- Security/quality findings: install step is the only newly allowed native build action and is recorded by the lockfile/SBOM.
- License obligations: retain MIT license and include platform package in SBOM/notices.
- Decision and ADR: narrowly accepted under the BullMQ intake and ADR-005; not a direct production API.
