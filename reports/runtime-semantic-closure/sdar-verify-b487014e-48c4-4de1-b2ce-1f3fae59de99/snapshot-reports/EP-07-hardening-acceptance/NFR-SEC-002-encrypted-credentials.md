# NFR-SEC-002 Encrypted Credentials

Date: 2026-07-13

## Acceptance reconciliation

The authoritative SRS requires MCP and Model credentials to be encrypted at rest, the master key to remain independent from the database, and a security inspection to find no plaintext credentials. It does not require a fresh database run for every later assertion refinement.

## Delivered

- `Aes256GcmSecretCipher` requires exactly 32 decoded key bytes, uses a fresh 96-bit random IV per encryption, and authenticates ciphertext with AES-256-GCM.
- The master key comes from required `SDAR_MASTER_KEY_BASE64` environment configuration and is never persisted.
- Single-process composition creates one cipher and injects it into both Model Runtime and MCP Registry.
- The application encrypts credentials before either PostgreSQL repository receives a record; repository writes accept only the encrypted envelope.
- Model/MCP management lists, invocation audits, operation summaries, health output, errors, and Console projections omit credential values.

## Reproducible evidence

Current real local regression:

- `pnpm exec vitest run packages/crypto-adapter/test/aes-gcm-secret-cipher.unit.test.ts packages/application/test/mcp-registry.unit.test.ts packages/application/test/model-runtime.unit.test.ts packages/management-api/test/http-endpoint.contract.test.ts apps/server/test/environment.unit.test.ts`
- Result: 5 files and 50 tests passed.
- Unified `pnpm verify`: 54 files and 240 tests passed, together with architecture, contract, migration-static, license, and production-build gates.

Historical real infrastructure evidence:

- EP-02 passed real PostgreSQL, official MCP transport, and same-process E2E with production AES-256-GCM credential handling.
- EP-03 passed real PostgreSQL and same-process E2E that configured `Bearer e2e-only` through management, persisted the Provider configuration, decrypted the stored envelope, authenticated a real loopback Model request, and exposed only sanitized audit evidence. Its full gate passed 14 integration and 11 E2E tests plus smoke.
- The current service/repository composition is the same encrypt-before-persist boundary, now strengthened to one composition-owned cipher for both services.

## Classification

NFR-SEC-002 is verified against its exact acceptance criterion. The newer direct raw-row assertions that decrypt distinct Model and MCP database envelopes are implemented but have not been rerun because Docker is unavailable; that is recorded as a current regression gap, not as absence of the already reproducible requirement evidence.
