# P12 冻结接口合同 V1.1

共享注册表：`../../shared/SDAR_v1.3_Frozen_Interface_Registry_V1.1.json`
注册表 SHA-256：`d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`

## 消费接口

### ArtifactGovernancePort
- Version: `1.1`
- Schema hash: `991d8aeb156f03d07b6181ac2d1d097f78633cf7988a93336b61815e8c3b74cf`
- Signature: `requestValidation; recordApproval; activate; requestRevalidation; deprecate; rollback; killSwitch`

### FastGateway
- Version: `1.1`
- Schema hash: `be8f17ffcf597a021a8758844521cf4ba43dd1537e0d74dc7be2116c91cc16fe`
- Signature: `evaluate(input: RuntimeRequestContext): Promise<RuntimeExecutionDecision>`

### CaseRuntime
- Version: `1.1`
- Schema hash: `a2cb1f3f4c0a18abf03d3fb1a552b1f480e11e8a2ac5d3f1aa98c849dd96a387`
- Signature: `retrieve(input: CaseRetrievalInput): Promise<CaseMatch[]>; adapt(input: CaseAdaptationInput): Promise<CaseAdaptationResult>`

### ModelRouteRuntime
- Version: `1.1`
- Schema hash: `386a10226570efe3572177718a9bca0f826cf6abc95ac91b63279a5993ae3dae`
- Signature: `evaluate(input: ModelRouteContext): Promise<ModelRouteDecision>`

## 生产接口

### ManagementApiContract
- Owner: `P12`
- Version: `1.1`
- Schema hash: `842c040064b7171337082d865d4b46cbc27c8063ab3b0a3f881f4458247e8cbe`
- Fields: `queryOperations`, `commandOperations`, `pagination`, `filters`, `expectedVersion`, `idempotency`, `rbac`, `tenant`, `redaction`, `openapiVersion`

### A2AArtifactProjection
- Owner: `P12`
- Version: `1.1`
- Schema hash: `bdf152659c84b4fbbcb7d1d9dd47b97aedf73f5e82c55265a796ec4fd406d0ff`
- Fields: `publicCapabilitySummary`, `inputRequired`, `confirmation`, `formalTaskState`, `safeEvidence`, `redactionPolicyVersion`

### SseArtifactEventProjection
- Owner: `P12`
- Version: `1.1`
- Schema hash: `c9c2b763d109005241827ddb1cb957e28fcf7003a759d387f0888a85700f7380`
- Fields: `eventId`, `eventType`, `tenantId`, `safePayload`, `sourceRef`, `createdAt`

