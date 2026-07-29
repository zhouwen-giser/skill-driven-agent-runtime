# P13 冻结接口合同 V1.1

共享注册表：`../../shared/SDAR_v1.3_Frozen_Interface_Registry_V1.1.json`
注册表 SHA-256：`d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`

## 消费接口

### ManagementApiContract
- Version: `1.1`
- Schema hash: `842c040064b7171337082d865d4b46cbc27c8063ab3b0a3f881f4458247e8cbe`
- Fields: `queryOperations`, `commandOperations`, `pagination`, `filters`, `expectedVersion`, `idempotency`, `rbac`, `tenant`, `redaction`, `openapiVersion`

### A2AArtifactProjection
- Version: `1.1`
- Schema hash: `bdf152659c84b4fbbcb7d1d9dd47b97aedf73f5e82c55265a796ec4fd406d0ff`
- Fields: `publicCapabilitySummary`, `inputRequired`, `confirmation`, `formalTaskState`, `safeEvidence`, `redactionPolicyVersion`

### SseArtifactEventProjection
- Version: `1.1`
- Schema hash: `c9c2b763d109005241827ddb1cb957e28fcf7003a759d387f0888a85700f7380`
- Fields: `eventId`, `eventType`, `tenantId`, `safePayload`, `sourceRef`, `createdAt`

## 生产接口

### ReleaseCandidateDecision
- Owner: `P13`
- Version: `1.1`
- Schema hash: `370b260730ee559a3f292d57c82b9296f626c4b437defa1dc2776f59020f9045`
- Values: `RELEASE_CANDIDATE_READY`, `RELEASE_CANDIDATE_BLOCKED`

