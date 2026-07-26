# P06 冻结接口合同 V1.1

共享注册表：`../../shared/SDAR_v1.3_Frozen_Interface_Registry_V1.1.json`
注册表 SHA-256：`d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`

## 消费接口

### ArtifactValidationResult
- Version: `1.1`
- Schema hash: `0a9b4fe3b71242744760ecf7bfcd14cf4272b32ac130e111878f67f3514fd64b`
- Fields: `validationRunId`, `artifactRef`, `datasetRef`, `validationType`, `metrics`, `failureRefs`, `counterexampleRefs`, `unsafe`, `result`, `validatorVersion`, `metricCatalogVersion`, `artifactHash`, `datasetHash`, `resultHash`, `completedAt`

### ArtifactCounterexample
- Version: `1.1`
- Schema hash: `ef317932640d095863d9bb13c96e2f738989bc7858aec9a613f76c4438ad46f3`
- Fields: `counterexampleId`, `artifactRef`, `replayCaseRef`, `failureRef`, `conditionFingerprint`, `environmentClass`, `failureBoundaryCandidate`, `sourceRefs`, `status`, `createdAt`

### ArtifactGovernancePort
- Version: `1.1`
- Schema hash: `991d8aeb156f03d07b6181ac2d1d097f78633cf7988a93336b61815e8c3b74cf`
- Signature: `requestValidation; recordApproval; activate; requestRevalidation; deprecate; rollback; killSwitch`

## 生产接口

### ArtifactShadowRun
- Owner: `P06`
- Version: `1.1`
- Schema hash: `57b1f4a99385c94d967ac2eb84ed90dc74ab196c25e42fc67de488d963ec369d`
- Fields: `shadowRunId`, `artifactRef`, `artifactHash`, `formalRequestRef`, `formalGoalRef`, `formalPlanRef`, `formalGoalVersion`, `formalPlanVersion`, `status`, `shadowMode`, `startedAt`, `completedAt`

### ArtifactShadowResult
- Owner: `P06`
- Version: `1.1`
- Schema hash: `69f51efc62cb86f2b0df4e5a95cf3bce00580869a0b6fb891498cdc260c1ec69`
- Fields: `shadowRunRef`, `artifactRef`, `shadowDecisionRef`, `shadowPlanRef`, `formalPlanRef`, `formalOutcomeRef`, `comparison`, `policyViolation`, `unsafeAttempt`, `stale`, `resultHash`, `evaluatorVersion`, `completedAt`

### ArtifactPromotionPackage
- Owner: `P06`
- Version: `1.1`
- Schema hash: `4889edac5db4fe3251d9b29c4aaddb05341bb1d9adb257398a556859a517bf52`
- Fields: `promotionPackageId`, `artifactRef`, `artifactHash`, `validationSummaryRef`, `validationSummaryHash`, `shadowSummaryRef`, `shadowSummaryHash`, `counterexampleSummaryRef`, `counterexampleSummaryHash`, `riskReviewRef`, `riskReviewHash`, `dependencySnapshotRef`, `dependencySnapshotHash`, `promotionPolicyVersion`, `eligibility`, `contentHash`, `createdAt`

### ArtifactApprovalRecord
- Owner: `P06`
- Version: `1.1`
- Schema hash: `a041ba372f0e123ba7ba4d5fb451ba889e0f46ae727a4714aabb5c70c119394d`
- Fields: `approvalId`, `artifactId`, `artifactVersion`, `approverId`, `decision`, `reason`, `validationSummaryHash`, `promotionPackageHash`, `createdAt`

### ArtifactActivationRecord
- Owner: `P06`
- Version: `1.1`
- Schema hash: `d45959a850c3433df4be744f77e758209e317ceb88c5dc816d448878b2e3a7ef`
- Fields: `activationId`, `artifactRef`, `artifactHash`, `approvalRef`, `approvalHash`, `previousActiveArtifactRef`, `activePointerVersion`, `activatedBy`, `activatedAt`

### ArtifactRevalidationTrigger
- Owner: `P06`
- Version: `1.1`
- Schema hash: `cd9b13e443b5fa7aa80a004bbb99b3e988a44247eed92997efa8682ea774745a`
- Fields: `triggerId`, `artifactRef`, `triggerType`, `sourceRefs`, `severity`, `createdAt`

