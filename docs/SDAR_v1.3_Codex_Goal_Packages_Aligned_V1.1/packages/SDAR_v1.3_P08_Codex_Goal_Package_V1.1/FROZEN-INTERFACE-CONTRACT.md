# P08 冻结接口合同 V1.1

共享注册表：`../../shared/SDAR_v1.3_Frozen_Interface_Registry_V1.1.json`
注册表 SHA-256：`d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`

## 消费接口

### RuntimeExecutionDecision
- Version: `1.1`
- Schema hash: `4ad37edc562bf39d27982f23f70d27ee8af1a3dfe3486dfc34725eec62b5b4de`
- Fields: `decisionId`, `requestId`, `path`, `selectedArtifactRef`, `parameterBindings`, `missingParameters`, `requiredConfirmations`, `reasonCodes`, `matcherSnapshotHash`, `policySnapshotHash`, `createdAt`

### PlanTemplateArtifactDefinition
- Version: `1.1`
- Schema hash: `b089d44944f3db3c5fcfff016a5b56f5d3482d89088448697b5cd4f20d425d04`
- Fields: `goalPattern`, `parameterSchema`, `parameterBindings`, `skillGoalGraph`, `completionContractTemplate`, `recoveryBranches`

### ParameterBindingResult
- Version: `1.1`
- Schema hash: `13eaeb0cad67bd18fc3b83d9bf2315d6c72213602260c5f5898c419b4c9891a5`
- Fields: `artifactRef`, `bindings`, `missingRequiredParameters`, `rejectedCandidateBindings`, `requiresConfirmation`

## 生产接口

### TemplateInstantiationInput
- Owner: `P08`
- Version: `1.1`
- Schema hash: `b1305ecee05292e77d0694bed39b1ea1bcaf5679c26a17bf21360fe523c1fb7a`
- Fields: `requestRef`, `goalContractRef`, `goalVersion`, `artifactRef`, `artifactVersion`, `artifactHash`, `activePointerVersion`, `applicabilityRef`, `parameterBindingRef`, `dependencyValidationRef`, `capabilityReadinessRef`, `policyDecisionRef`, `matcherSnapshotHash`, `policySnapshotHash`, `idempotencyKey`, `deadlineAt`, `cancellationRef`

### GoalContextSnapshot
- Owner: `P08`
- Version: `1.1`
- Schema hash: `8b7c4d0307be2e7786ddcd4187eff7f428f89788564415196c8d9d98a60a809d`
- Fields: `goalContractRef`, `goalVersion`, `objective`, `requiredCriterionRefs`, `optionalCriterionRefs`, `evidenceRequirementRefs`, `artifactRequirementRefs`, `targetScope`, `constraints`, `authorizationRefs`, `riskLevel`, `contentHash`

### UserGoalPlanCandidate
- Owner: `P08`
- Version: `1.1`
- Schema hash: `0703bdf935e746d6e3ec5b27a72d334baa39d50e8daa4ca144ef67a41f00d396`
- Fields: `candidateId`, `goalContractRef`, `goalVersion`, `sourceArtifactRef`, `sourceArtifactVersion`, `sourceArtifactHash`, `parameterBindings`, `skillGoalGraph`, `completionContract`, `recoveryBranches`, `criterionCoverage`, `adaptationRefs`, `runtimeSnapshotHash`, `contentHash`

### TemplateInstantiationResult
- Owner: `P08`
- Version: `1.1`
- Schema hash: `4d10a971c8fb2d79355f6364de04d45fea36143d0ebcd0a9b9faca785264de96`
- Fields: `instantiationId`, `requestRef`, `artifactRef`, `disposition`, `planCandidateRef`, `missingParameters`, `requiredConfirmations`, `reasonCodes`, `createdAt`

### FormalPlanHandoffResult
- Owner: `P08`
- Version: `1.1`
- Schema hash: `7cd74f217530c34f78a6d5793f2e190675dee96e6e9cb3dd39cf69dec05fe883`
- Fields: `handoffId`, `planCandidateRef`, `disposition`, `formalPlanningSessionRef`, `formalPlanRef`, `formalPlanVersion`, `validationRef`, `goalLockRef`, `reasonCodes`, `completedAt`

### TemplateRuntime
- Owner: `P08`
- Version: `1.1`
- Schema hash: `fe1a817f0a5633b648d018742e0fcb2278e0ef887d9a9adf1922d55a755e553a`
- Signature: `instantiate(input: TemplateInstantiationInput): Promise<UserGoalPlanCandidate>`

### FormalPlanHandoffPort
- Owner: `P08`
- Version: `1.1`
- Schema hash: `84f9be4c6bcd7ed775c1f56779f671709efe541edc498b6bb71047a1e55d9336`
- Signature: `submit(candidate: UserGoalPlanCandidate): Promise<FormalPlanHandoffResult>`

