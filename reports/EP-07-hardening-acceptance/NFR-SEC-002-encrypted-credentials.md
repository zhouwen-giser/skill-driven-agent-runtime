# NFR-SEC-002 Encrypted Credentials

Date: 2026-07-13

## Delivered

- `Aes256GcmSecretCipher` requires exactly 32 decoded key bytes, uses a fresh 96-bit random IV per encryption, and authenticates ciphertext with AES-256-GCM.
- The master key comes only from required `SDAR_MASTER_KEY_BASE64` environment configuration and is never persisted.
- Single-process composition creates one cipher and injects it into both Model Runtime and MCP Registry.
- PostgreSQL provider/server records receive only versioned IV/tag/ciphertext envelopes.
- Model/MCP management lists, invocation audits, operation summaries, health output, errors, and Console projections omit credential values.
- MCP credential rotation validates new headers remotely before replacing encrypted state.

## Verification

Real local unit/contract verification:

- AES tests prove round-trip, randomized ciphertext for identical plaintext, rejection of 31-byte keys, and tamper authentication failure.
- Model and MCP service tests prove encryption-port use, no fallback/leak into audits, remote-before-persist rotation, and header-name-only management summaries.
- Management contracts prove Model/MCP list responses contain no credential field or value.
- 43 targeted tests, strict typecheck, and lint pass.
- Unified `pnpm verify` passes with 54 unit/contract files and 224 tests plus every architecture, OpenAPI, source-pin, Compose-static, SBOM/license, and production-build gate.

Implemented but unverified:

- PostgreSQL integration now encrypts real distinct Model and MCP bearer secrets with the production cipher, asserts raw database text excludes plaintext, and decrypts the stored envelope back to the exact secret.
- Docker-backed PostgreSQL integration and same-process E2E cannot be rerun in the current environment.

NFR-SEC-002 remains `开发中` until the real database and same-process E2E assertions pass reproducibly.
