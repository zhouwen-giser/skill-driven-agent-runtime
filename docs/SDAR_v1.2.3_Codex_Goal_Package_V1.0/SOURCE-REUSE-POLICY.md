# Open-source Source Reuse Policy

## Final strategy

```text
Gemini CLI  → selective TypeScript source port
AutoSkill   → clean-room algorithm rewrite until license clarified
LangMem     → clean-room TypeScript typed extraction
ReMe        → clean-room TypeScript RRF/relation/staging
AWM         → prompt/algorithm/test-shape reference
ACE         → clean-room TypeScript Reflector/Curator/Delta
```

## Required intake workflow

Before copying or translating substantive code:

1. verify repository and locked commit;
2. verify exact source path and license;
3. classify reuse as copied, translated, algorithm reference, prompt reference or test reference;
4. create `reports/source-intake/<source>-<component>.md`;
5. define SDAR-owned input/output contract first;
6. add source behavior fixtures;
7. implement behind SDAR Ports;
8. update `third_party/sources.lock.yaml`, `THIRD_PARTY_NOTICES.md`, license ledger and SBOM;
9. record modifications and tests.

## Direct port restrictions

A direct port must not import source project configuration, global runtime, storage authority, model client or UI. Prefer isolated algorithms under 50–200 lines with focused tests.

## Prompt restrictions

Do not copy long prompts wholesale unless the source license is confirmed and a prompt is genuinely necessary. Prefer deriving short SDAR-specific policy clauses from documented behavior and recording the source as a behavior reference.

## AutoSkill restriction

The audited commit lacks a root license file despite an MIT README badge. Do not copy source code or long prompts from AutoSkill until licensing is confirmed. Its identity, lineage and promotion behavior may be independently reimplemented from public descriptions and tests.

## No Python product dependency

Python repositories may be used for offline comparison experiments only. Product Release Gate forbids a Python Sidecar, FastAPI/FastMCP memory service, LangChain Python runtime, file authority or external knowledge service.
