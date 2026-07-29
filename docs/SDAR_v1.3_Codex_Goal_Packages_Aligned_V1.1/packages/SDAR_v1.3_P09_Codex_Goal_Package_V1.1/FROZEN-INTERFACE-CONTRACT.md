# P09 冻结接口合同 V1.1

共享注册表：`../../shared/SDAR_v1.3_Frozen_Interface_Registry_V1.1.json`
注册表 SHA-256：`d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`

## 消费接口

### RuntimeExecutionDecision
- Version: `1.1`
- Schema hash: `4ad37edc562bf39d27982f23f70d27ee8af1a3dfe3486dfc34725eec62b5b4de`
- Fields: `decisionId`, `requestId`, `path`, `selectedArtifactRef`, `parameterBindings`, `missingParameters`, `requiredConfirmations`, `reasonCodes`, `matcherSnapshotHash`, `policySnapshotHash`, `createdAt`

### DecisionRuleArtifactDefinition
- Version: `1.1`
- Schema hash: `5710c7a6e2aa4b76f19449776af894cf039140f3f35a88fc14525ecbef920e85`
- Fields: `category`, `condition`, `decision`, `priority`, `conflictGroup`, `conflictPolicy`

### FormalPlanHandoffPort
- Version: `1.1`
- Schema hash: `84f9be4c6bcd7ed775c1f56779f671709efe541edc498b6bb71047a1e55d9336`
- Signature: `submit(candidate: UserGoalPlanCandidate): Promise<FormalPlanHandoffResult>`

## 生产接口

### RuleDecisionContext
- Owner: `P09`
- Version: `1.1`
- Schema hash: `151c3f7fafb1c7a8d3d6361feabdf924c5e96b8988ebfff887c8660b7efee77e`
- Fields: `requestRef`, `goalContractRef`, `goalVersion`, `planRef`, `planVersion`, `artifactRef`, `artifactVersion`, `artifactHash`, `activePointerVersion`, `tenantId`, `authorizationRefs`, `requestSnapshotRef`, `worldStateSnapshotRef`, `businessEventRefs`, `parameterBindingRef`, `capabilityReadinessRef`, `policyDecisionRef`, `dependencyValidationRef`, `runtimeSnapshotHash`

### RuleConditionResult
- Owner: `P09`
- Version: `1.1`
- Schema hash: `627bf8a47de6632abcfa0fe5abd5f197d1c37826636bf878f2b22da454442d82`
- Fields: `conditionId`, `result`, `operandRefs`, `observedValues`, `operator`, `reasonCodes`

### RuleDecisionResult
- Owner: `P09`
- Version: `1.1`
- Schema hash: `44c06ea58232e4713b695dc3d7082cd189a5e7b00fe94374c76c0af09e7a4f47`
- Fields: `evaluationId`, `ruleRef`, `ruleHash`, `matched`, `unknown`, `conditionResults`, `proposedAction`, `actionPayload`, `evaluatorVersion`, `runtimeSnapshotHash`, `resultHash`, `createdAt`

### RuleConflictResolution
- Owner: `P09`
- Version: `1.1`
- Schema hash: `03f47932366feffc992f3ffc991a51db71a71db5ea6eb3aeb79de9a13b223358`
- Fields: `resolutionId`, `evaluationRefs`, `selectedRuleRefs`, `suppressedRuleRefs`, `disposition`, `policySeverity`, `specificityOrder`, `reasonCodes`, `resolverVersion`, `resultHash`

### RulePlanPatchCandidate
- Owner: `P09`
- Version: `1.1`
- Schema hash: `a406785ef94494b4aabaead4556d0652e8929f3c5b8d44923cb45e49d74d3163`
- Fields: `patchCandidateId`, `goalContractRef`, `goalVersion`, `planRef`, `planVersion`, `sourceRuleRefs`, `patchOperations`, `affectedCriterionRefs`, `requiredConfirmations`, `bounded`, `contentHash`

### RuleRuntime
- Owner: `P09`
- Version: `1.1`
- Schema hash: `77b30dc4384fbf082345b90280d01f15609b5aa1a166ab827825d5dee14efaca`
- Signature: `evaluate(input: RuleDecisionContext): Promise<RuleDecisionResult>`

