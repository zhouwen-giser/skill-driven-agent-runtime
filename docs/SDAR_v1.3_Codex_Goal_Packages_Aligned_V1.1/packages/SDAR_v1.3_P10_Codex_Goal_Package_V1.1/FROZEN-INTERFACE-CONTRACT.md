# P10 冻结接口合同 V1.1

共享注册表：`../../shared/SDAR_v1.3_Frozen_Interface_Registry_V1.1.json`
注册表 SHA-256：`d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`

## 消费接口

### RuntimeExecutionDecision
- Version: `1.1`
- Schema hash: `4ad37edc562bf39d27982f23f70d27ee8af1a3dfe3486dfc34725eec62b5b4de`
- Fields: `decisionId`, `requestId`, `path`, `selectedArtifactRef`, `parameterBindings`, `missingParameters`, `requiredConfirmations`, `reasonCodes`, `matcherSnapshotHash`, `policySnapshotHash`, `createdAt`

### TemplateRuntime
- Version: `1.1`
- Schema hash: `fe1a817f0a5633b648d018742e0fcb2278e0ef887d9a9adf1922d55a755e553a`
- Signature: `instantiate(input: TemplateInstantiationInput): Promise<UserGoalPlanCandidate>`

### RuleRuntime
- Version: `1.1`
- Schema hash: `77b30dc4384fbf082345b90280d01f15609b5aa1a166ab827825d5dee14efaca`
- Signature: `evaluate(input: RuleDecisionContext): Promise<RuleDecisionResult>`

### FormalPlanHandoffPort
- Version: `1.1`
- Schema hash: `84f9be4c6bcd7ed775c1f56779f671709efe541edc498b6bb71047a1e55d9336`
- Signature: `submit(candidate: UserGoalPlanCandidate): Promise<FormalPlanHandoffResult>`

## 生产接口

### RuntimeRequestContext
- Owner: `P10`
- Version: `1.1`
- Schema hash: `6ada60cdd637cd3a2467347c8ef858ce2932c5e56d891c7aaaf1dfaabc41595e`
- Fields: `requestId`, `taskId`, `contextId`, `rawText`, `normalizedText`, `actor`, `extractedFeatures`, `worldStateRef`, `capabilitySummaryRef`, `policySnapshotRef`, `deadlineAt`, `cancellationRef`, `idempotencyKey`, `createdAt`

### FastGateway
- Owner: `P10`
- Version: `1.1`
- Schema hash: `be8f17ffcf597a021a8758844521cf4ba43dd1537e0d74dc7be2116c91cc16fe`
- Signature: `evaluate(input: RuntimeRequestContext): Promise<RuntimeExecutionDecision>`

### GatewayDecisionRecord
- Owner: `P10`
- Version: `1.1`
- Schema hash: `1beecf8ae5527d5b8db7bcf89c36b4e73d35e083d6818f9ad18874f13e31d3ab`
- Fields: `gatewayDecisionId`, `requestId`, `runtimeDecisionRef`, `stageResults`, `formalHandoffRef`, `fallbackRef`, `reasonCodes`, `runtimeSnapshotHash`, `decisionHash`, `createdAt`

### GatewayFeedbackEnvelope
- Owner: `P10`
- Version: `1.1`
- Schema hash: `22faac79bc9ea9d8bcac5bc42e626bba79b5ed04579e371ba5dfadbc611aaf6b`
- Fields: `feedbackId`, `requestId`, `gatewayDecisionRef`, `selectedArtifactRefs`, `formalGoalRef`, `formalPlanRef`, `formalOutcomeRef`, `feedbackType`, `payload`, `sourceRefs`, `createdAt`

