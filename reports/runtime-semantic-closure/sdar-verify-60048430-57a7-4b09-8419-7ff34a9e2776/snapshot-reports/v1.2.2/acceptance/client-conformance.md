# SDAR v1.2.2 Business Events Client Conformance

Status: **passed**.

The SDAR client is locked to Provider Requirements V0.5.2/Profile 1.0 assets from exact commit
`8a81b1b02971fb124ed96372c440c449f9087c99`: 23 hashes verified, 8 valid fixtures accepted, 5 invalid
fixtures rejected and 5 strict discovery/Ack/drain/reset/relation/error contract tests passed.

Durability is separately proven by 5 runtime unit cases, 3 PostgreSQL subscription/inbox/continuity/
relation integration cases and 1 real HTTP/PostgreSQL runtime E2E. Exact-candidate real Provider
interop also passed; see `reports/v1.2.2-interop/real-provider-interop.{md,json}`.

Declaration boundary:

- Provider Requirements Contract Frozen: **yes**, for the pinned assets.
- Provider Runtime Candidate: **qualified only at `8a81b1b`**.
- SDAR Client Contract Passed: **yes**.
- Real Interop Passed: **yes**, for SDAR `325b8d0` and Provider `8a81b1b`.
- Profile 1.0 Frozen for arbitrary future Provider candidates: **no**.
