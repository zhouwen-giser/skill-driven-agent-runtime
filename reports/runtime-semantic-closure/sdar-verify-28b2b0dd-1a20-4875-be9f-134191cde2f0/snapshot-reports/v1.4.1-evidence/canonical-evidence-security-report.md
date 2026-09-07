# Phase 2 Canonical Evidence Security Report

## Fail-closed controls

- JSON depth: maximum 32.
- Canonical payload bytes: maximum 262,144 globally and 65,536 per normal record (131,072 only for
  declared Replay/Artifact records).
- Arrays: maximum 4,096 at canonicalization; formal schema nested arrays are bounded to 256.
- Objects: maximum 1,024 at canonicalization; formal schema nested objects are bounded to 128.
- Evidence and artifact references: maximum 256 and unique.
- Cyclic objects, non-plain objects, undefined, bigint/function/symbol, and non-finite numbers fail.
- Inline credential/password/token/secret/authorization/API/private-key fields fail.
- `chainOfThought`, private/hidden reasoning, and reasoning-content variants fail.
- Opaque `credentialRef`/`secretRef` values remain allowed because configuration is ref-only.
- Unknown record type, family, source-system, delivery guarantee, or evaluation role fails.
- Same Record ID plus different Payload Hash raises `EVIDENCE_PAYLOAD_CONFLICT`.

## Hash boundary

Record ID includes only source and schema identity. Payload hash includes only canonical payload.
Sequence, capture timestamp, delivery attempts, retry scheduling, and sink ACK are excluded. This
prevents transport behavior from altering evidence identity.

## Evidence

Focused Unit tests cover deterministic IDs/hashes, conflict, redaction adversarial keys, cycles,
depth, size, non-finite numbers, duplicate references, revision requirements, and UTC timestamps.
Contract tests compile all 100 record schemas plus seven protocol schemas with Ajv 2020 and validate
real envelopes rather than placeholder objects.
