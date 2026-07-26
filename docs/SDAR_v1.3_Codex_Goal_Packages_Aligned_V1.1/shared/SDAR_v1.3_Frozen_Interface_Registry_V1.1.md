# SDAR v1.3 跨包冻结接口注册表 V1.1

`registrySha256: d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`

## 正式任务包

`P00～P13，共14个正式任务包；P14不在本注册表。`

## 统一权威接口

### HandoffEnvelope
- Owner: `shared`
- Version: `1.1`
- Schema hash: `d8b539823cd27e96ba4a1c15925818267a8fc4af9aa4699cad597e009a1580b5`
- Fields: `schemaVersion`, `packageId`, `packageVersion`, `sequence`, `status`, `repository`, `baselineSha`, `branch`, `commits`, `draftPrUrl`, `contractRegistryVersion`, `contractRegistrySha256`, `consumedContracts`, `producedContracts`, `migrations`, `repositoryPorts`, `applicationPorts`, `runtimePorts`, `events`, `queues`, `featureFlags`, `reasonCodeCatalogVersion`, `evidenceRefs`, `acceptanceSummary`, `knownLimitations`, `openBlockers`, `nextPackage`, `packageOutputs`

### CompiledArtifactType
- Owner: `P01`
- Version: `1.1`
- Schema hash: `2dc5bd1322559c8ae0f5dabe945e69c01b6cb69ad379ceaa0f633f2e88072cea`
- Enum: `intent_route`, `plan_template`, `decision_rule`, `case_template`, `model_route`

### CompiledArtifactStatus
- Owner: `P01`
- Version: `1.1`
- Schema hash: `266a7448640bf17113b431919c1fb6113b022e1b9d8a932b9443404f620c8ba5`
- Enum: `discovered`, `candidate`, `validating`, `awaiting_approval`, `active`, `revalidating`, `deprecated`, `archived`, `rejected`

### CompiledArtifact
- Owner: `P01`
- Version: `1.1`
- Schema hash: `8afcafacad1085eb35d7b3fb0dd7715b05e7ff279f0d78b529a4b64fbe39bdcf`
- Fields: `artifactId`, `artifactKey`, `version`, `artifactType`, `name`, `description`, `scope`, `definition`, `applicability`, `requiredCapabilities`, `requiredPolicies`, `dependencySnapshot`, `riskLevel`, `status`, `lineageRef`, `validationSummaryRef`, `contentHash`, `createdAt`

### ArtifactApplicability
- Owner: `P01`
- Version: `1.1`
- Schema hash: `4af9af86a57212d4120637a0c97484890eb6c34e729fd7d90d6d893c32bf47c8`
- Fields: `requiredConditions`, `optionalConditions`, `forbiddenConditions`, `requiredParameters`, `allowedEnvironmentClasses`, `excludedEnvironmentClasses`, `minimumIntentScore`, `minimumConditionScore`, `maximumUncertainty`, `outOfDistributionPolicy`

### ArtifactDependencySnapshot
- Owner: `P01`
- Version: `1.1`
- Schema hash: `ab5eb452c0299802016cf8771536a2796cf656c8117a67d0a8c6158aca2e127a`
- Fields: `capabilityCatalogHash`, `policyVersionRefs`, `taskTypeVersionRefs`, `schemaVersionRefs`, `requiredSkillVersionRefs`, `compilerVersion`

### ConditionExpression
- Owner: `P01`
- Version: `1.1`
- Schema hash: `db033c6d65b1123fefd8185a8424eb6e227d8fea5978c599c48a7c835db5607e`
- Fields: `type`, `children`, `child`, `field`, `operator`, `value`
- Notes: all|any|not|atomic; active evaluation is deterministic

### IntentRouteArtifactDefinition
- Owner: `P01`
- Version: `1.1`
- Schema hash: `7a95d4c0620a5623725cb5672d22433a47981f8b239997a3e872a597378b8f7a`
- Fields: `taskTypeId`, `semanticExamples`, `exactPatterns`, `structuredHints`, `nextPath`

### PlanTemplateArtifactDefinition
- Owner: `P01`
- Version: `1.1`
- Schema hash: `b089d44944f3db3c5fcfff016a5b56f5d3482d89088448697b5cd4f20d425d04`
- Fields: `goalPattern`, `parameterSchema`, `parameterBindings`, `skillGoalGraph`, `completionContractTemplate`, `recoveryBranches`

### SkillGoalNodeTemplate
- Owner: `P01`
- Version: `1.1`
- Schema hash: `f8deaf1d8882195927d9c5070262fd14c8e894e084eaafc29e193dff8f3cb0a7`
- Fields: `nodeKey`, `nodeType`, `objectiveTemplate`, `requiredCapabilities`, `requiredEffectRefs`, `coveredCriterionTemplateIds`, `evidenceRequirements`, `artifactRequirements`, `inputTemplate`, `assumptionsAllowed`, `constraints`
- Notes: nodeType includes action|observation|reasoning|verification|recovery|human_gate

### DecisionRuleArtifactDefinition
- Owner: `P01`
- Version: `1.1`
- Schema hash: `5710c7a6e2aa4b76f19449776af894cf039140f3f35a88fc14525ecbef920e85`
- Fields: `category`, `condition`, `decision`, `priority`, `conflictGroup`, `conflictPolicy`

### DecisionOutput
- Owner: `P01`
- Version: `1.1`
- Schema hash: `e1b890a30d853179f36092c01e1404c5b811f1cc54a63b98bf3eef9045877dc9`
- Fields: `decisionType`, `parameters`, `explanationCode`

### CaseArtifactDefinition
- Owner: `P01`
- Version: `1.1`
- Schema hash: `c1b03024222e19ed2834e25accdb8e4d841ae3e2d35ea28ecba056a79d585ea5`
- Fields: `problemFingerprint`, `solutionPattern`, `adaptationRules`, `applicability`, `failureBoundaries`, `priorOutcomeSummary`

### ModelRouteArtifactDefinition
- Owner: `P01`
- Version: `1.1`
- Schema hash: `2f271f5b96f9d83675b2176ea8f7a8eea76a86f1e3cc5e52c255a42cb6016678`
- Fields: `conditions`, `route`, `budget`, `fallbackRoutes`

### ArtifactLineage
- Owner: `P01`
- Version: `1.1`
- Schema hash: `aa6629a29c59194e6584813656dd3a0b930da324f2a8e9e3002d9580310b6f57`
- Fields: `lineageId`, `artifactId`, `artifactVersion`, `sourceEpisodeRefs`, `sourceKnowledgeRefs`, `sourceCorrectionRefs`, `sourcePatternRefs`, `generationMethods`, `validationRunRefs`, `supersedesArtifactRefs`

### ArtifactRuntimeBinding
- Owner: `P01`
- Version: `1.1`
- Schema hash: `52a678f6ef4de068f780d94aad27bcb4ae080f1ab3351b64c0f608719ba3a337`
- Fields: `bindingId`, `artifactId`, `artifactVersion`, `runtimeType`, `compilerVersion`, `compiledPayloadHash`, `compiledAt`

### ArtifactRepository
- Owner: `P02`
- Version: `1.1`
- Schema hash: `617560087d746b79cd5fa38f82bf8c7a90448f56e5b54c1117f0b186bae54c53`
- Signature: `findActiveIndex(query); getDefinition(ref); saveCandidate(candidate); activate(input); deprecate(input)`

### ArtifactValidationRepository
- Owner: `P02`
- Version: `1.1`
- Schema hash: `0c94dc844ed8cf5f4e9e4ca678e208172cd3a394affbf93ce910765899f86ab9`
- Signature: `createRun(input); appendResult(input); findPromotionSummary(ref)`

### ArtifactExecutionRepository
- Owner: `P02`
- Version: `1.1`
- Schema hash: `c32e0994dd2d25cbe5df2116e98b0c93252d5a75bb5e83867c25038fcec12650`
- Signature: `start(input); complete(input); appendFeedback(input)`

### ArtifactRegistryService
- Owner: `P02`
- Version: `1.1`
- Schema hash: `011be4e2c1686e0f68256aa9c4cf9f98dff2d92fcb4cf043b2d09b06a0c7cab5`
- Signature: `createCandidate; getVersion; queryActiveIndex; invalidateDependency; rebuildProjection`

### OperatorIdentityPort
- Owner: `P02`
- Version: `1.1`
- Schema hash: `1ec57c600b439bcd1efe67c67ee319b04f38681e2ab3da6fad71dbae734dfe75`
- Signature: `requireIdentity; requirePermission; getTenantScope`

### ArtifactGovernancePort
- Owner: `P02`
- Version: `1.1`
- Schema hash: `991d8aeb156f03d07b6181ac2d1d097f78633cf7988a93336b61815e8c3b74cf`
- Signature: `requestValidation; recordApproval; activate; requestRevalidation; deprecate; rollback; killSwitch`

### ExperienceTrace
- Owner: `P03`
- Version: `1.1`
- Schema hash: `d929a15aa9fc268bd713ddf9d44d8b1a856d8edc8acf8650ddc1b8511945c4f9`
- Fields: `traceId`, `sourceEpisodeId`, `taskTypeRefs`, `goalFingerprint`, `capabilityFingerprint`, `environmentFingerprint`, `trace`, `completeness`, `dataClassification`, `normalizerVersion`, `sourceHash`, `createdAt`

### ExperienceTraceEvent
- Owner: `P03`
- Version: `1.1`
- Schema hash: `8b9742001edfbbe7a6dc93971d5f08dff002f32d56a7ca124c5b54e59133a878`
- Fields: `eventId`, `sequence`, `occurredAt`, `eventType`, `actorType`, `capabilityRefs`, `authorityRefs`, `parentEventRefs`, `concurrencyGroup`, `branchRef`, `payloadSummary`

### CohortDefinition
- Owner: `P03`
- Version: `1.1`
- Schema hash: `864abd2238982993ced478f96be4a65eb53b6813f8a984b2b1c05175a44a4f90`
- Fields: `tenantId`, `taskTypeId`, `goalFingerprint`, `capabilityFingerprint`, `environmentClass`, `deviceClass`, `timeRange`, `minimumCompleteness`

### ProcessVariant
- Owner: `P03`
- Version: `1.1`
- Schema hash: `f8f772dfbc589945e691bb9052b0164941e62dab0f7ac68f7d8021c16010fa86`
- Fields: `variantId`, `activitySequence`, `concurrencyGroups`, `branchSequence`, `occurrenceCount`, `traceRefs`, `successCount`, `failureCount`

### DiscoveredProcessPattern
- Owner: `P03`
- Version: `1.1`
- Schema hash: `de261049c901dc1e19fcce26adc665149f1cfab9c7b83a2f25e2a6b5fbd70eac`
- Fields: `patternId`, `cohortFingerprint`, `algorithmVersion`, `mandatoryActivities`, `optionalActivities`, `orderingConstraints`, `parallelCandidates`, `recoveryBranches`, `failureVariants`, `supportRefs`, `contradictionRefs`, `environmentCoverage`, `quality`

### WorkflowPattern
- Owner: `P03`
- Version: `1.1`
- Schema hash: `5ff2cbf281b8c298e1ae972879c4c7ffc7264eb5e5358912c4c46de94080f99b`
- Fields: `workflowPatternId`, `taskTypeId`, `activityPatterns`, `dependencyPatterns`, `recoveryPatterns`, `sourcePatternRef`, `sourceTraceRefs`, `quality`

### FusedPattern
- Owner: `P04`
- Version: `1.1`
- Schema hash: `df1216e93f02a3ec0cc24d96547d5db3436500789818ec8bcee3847fcbd9d24e`
- Fields: `fusedPatternId`, `sourceWorkflowPatternRef`, `sourceProcessPatternRef`, `sourceTraceRefs`, `structuralPattern`, `semanticCandidate`, `applicabilityCandidate`, `supportRefs`, `contradictionRefs`, `confidence`, `fusionVersion`, `contentHash`

### GeneralizedPattern
- Owner: `P04`
- Version: `1.1`
- Schema hash: `96f2c70c36985897ebbc700b540048314cad2e2597777e7b9b64118e227a08bd`
- Fields: `generalizedPatternId`, `domain`, `taskTypeId`, `variables`, `invariants`, `requiredConditions`, `forbiddenConditions`, `retainedExampleRefs`, `counterexampleRefs`, `sourceFusedPatternRef`, `generalizerVersion`, `contentHash`

### CandidateStaticValidationResult
- Owner: `P04`
- Version: `1.1`
- Schema hash: `3365fa7c49f249c3ea0935d87781da8d90253d6683bba97075beff1276278aba`
- Fields: `artifactRef`, `schemaValid`, `dagValid`, `requiredCriteriaCovered`, `capabilityShapeValid`, `parameterPolicyValid`, `sideEffectReplaySafe`, `boundsValid`, `duplicateFingerprint`, `errors`, `warnings`, `validatorVersion`, `result`

### ArtifactReplayCase
- Owner: `P05`
- Version: `1.1`
- Schema hash: `ab24f3c2d8a692f6e569c7e95f04f4389244941da0b297ec799610e8d1bab64f`
- Fields: `replayCaseId`, `tenantId`, `requestSnapshotRef`, `goalContractSnapshotRef`, `capabilityCatalogSnapshotRef`, `worldStateSnapshotRef`, `policySnapshotRef`, `readinessSnapshotRef`, `acceptedPlanSnapshotRef`, `executionTraceSnapshotRef`, `outcomeSnapshotRef`, `correctionRefs`, `environmentClass`, `deviceClass`, `taskTypeId`, `sourceEpisodeRefs`, `goalLineageHash`, `snapshotCompleteness`, `contentHash`

### ReplayDatasetManifest
- Owner: `P05`
- Version: `1.1`
- Schema hash: `132f1c215f12fdd28388ac3879589fd22e8772f1fd75ce058ce36977802c746e`
- Fields: `datasetId`, `datasetVersion`, `purpose`, `tenantId`, `taskTypeIds`, `caseRefs`, `splitPolicyVersion`, `sourceRange`, `sourceHash`, `contentHash`, `leakageCheckRef`, `createdAt`

### ArtifactValidationRun
- Owner: `P05`
- Version: `1.1`
- Schema hash: `c602d26e36dc9fc55b0ecaeeeebbf962af8e4d8f80080b7d9f12798be2afdd1a`
- Fields: `validationRunId`, `artifactId`, `artifactVersion`, `validationType`, `datasetRef`, `status`, `result`, `metrics`, `counterexampleRefs`, `startedAt`, `completedAt`

### ArtifactValidationResult
- Owner: `P05`
- Version: `1.1`
- Schema hash: `0a9b4fe3b71242744760ecf7bfcd14cf4272b32ac130e111878f67f3514fd64b`
- Fields: `validationRunId`, `artifactRef`, `datasetRef`, `validationType`, `metrics`, `failureRefs`, `counterexampleRefs`, `unsafe`, `result`, `validatorVersion`, `metricCatalogVersion`, `artifactHash`, `datasetHash`, `resultHash`, `completedAt`

### ArtifactValidationFailure
- Owner: `P05`
- Version: `1.1`
- Schema hash: `e017c434add5d1f1aec004552a8795c34509461699d351d879a02003ddb37182`
- Fields: `failureId`, `validationRunRef`, `replayCaseRef`, `category`, `severity`, `expectedRef`, `actualRef`, `evidenceRefs`, `explanation`

### ArtifactCounterexample
- Owner: `P05`
- Version: `1.1`
- Schema hash: `ef317932640d095863d9bb13c96e2f738989bc7858aec9a613f76c4438ad46f3`
- Fields: `counterexampleId`, `artifactRef`, `replayCaseRef`, `failureRef`, `conditionFingerprint`, `environmentClass`, `failureBoundaryCandidate`, `sourceRefs`, `status`, `createdAt`

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

### ArtifactIndexEntry
- Owner: `P07`
- Version: `1.1`
- Schema hash: `dd7bc4378007ad394fa1905aebc529b30f24fc279857ba67605f29036afe9bf0`
- Fields: `artifactRef`, `artifactKey`, `artifactVersion`, `artifactType`, `tenantId`, `domain`, `taskTypeIds`, `riskLevel`, `status`, `exactPatterns`, `structuredHints`, `embeddingRef`, `activePointerVersion`, `contentHash`

### ArtifactMatchScore
- Owner: `P07`
- Version: `1.1`
- Schema hash: `73ddec591cef1fc8e4b4d25d5cf20e7f64523e1ca66a24ca86db32ba8ed18bc5`
- Fields: `intentScore`, `structuredConditionScore`, `parameterCoverageScore`, `capabilityShapeScore`, `environmentSimilarityScore`, `validationConfidenceScore`, `recentReliabilityScore`, `riskPenalty`, `totalScore`

### ArtifactMatch
- Owner: `P07`
- Version: `1.1`
- Schema hash: `7334e4ba7c70f3744b81bb14bef308ca5abd32c6b99f7f05bf0d210b2d7267d7`
- Fields: `artifactRef`, `rank`, `score`, `retrievalSources`, `reasonCodes`

### ArtifactApplicabilityResult
- Owner: `P07`
- Version: `1.1`
- Schema hash: `0f87d569e3a38dc37526077d92040e1db7c745120c56ec7a79430d369265ec81`
- Fields: `applicable`, `confidence`, `satisfiedConditionIds`, `missingConditionIds`, `violatedConditionIds`, `uncertainConditionIds`, `outOfDistribution`, `disposition`

### ParameterBindingResult
- Owner: `P07`
- Version: `1.1`
- Schema hash: `13eaeb0cad67bd18fc3b83d9bf2315d6c72213602260c5f5898c419b4c9891a5`
- Fields: `artifactRef`, `bindings`, `missingRequiredParameters`, `rejectedCandidateBindings`, `requiresConfirmation`

### DependencyValidationResult
- Owner: `P07`
- Version: `1.1`
- Schema hash: `1a8a8c2c0f3001fdda76864c4029b3bb30193ecf4487e02b361c1ec1d6485470`
- Fields: `artifactRef`, `valid`, `mismatches`, `snapshotHash`, `reasonCodes`

### CapabilityReadinessResult
- Owner: `P07`
- Version: `1.1`
- Schema hash: `d1715f16e6faddabc1967207e4abd5b2c94f6fa92d2c7e51024e747b9d475fa4`
- Fields: `artifactRef`, `requiredCapabilities`, `skillCandidateRefs`, `providerReadiness`, `valid`, `reasonCodes`

### RuntimeExecutionDecision
- Owner: `P07`
- Version: `1.1`
- Schema hash: `4ad37edc562bf39d27982f23f70d27ee8af1a3dfe3486dfc34725eec62b5b4de`
- Fields: `decisionId`, `requestId`, `path`, `selectedArtifactRef`, `parameterBindings`, `missingParameters`, `requiredConfirmations`, `reasonCodes`, `matcherSnapshotHash`, `policySnapshotHash`, `createdAt`

### FastGatewayPath
- Owner: `P07`
- Version: `1.1`
- Schema hash: `af5fb1fd8fd79ea3b56580dbc1d073bb9e0ad8dd3b568fba2fecf1bb59f1e24b`
- Enum: `compiled_fast`, `template_adapt`, `case_adapt`, `small_model`, `cognitive_runtime`, `human_input`, `denied`

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

### CaseRetrievalInput
- Owner: `P11`
- Version: `1.1`
- Schema hash: `161342c806b7f58254efac7d076d3193da80982d9c0bea22998c91e71cd3b1de`
- Fields: `runtimeRequestRef`, `goalContextRef`, `taskTypeId`, `problemFingerprint`, `tenantId`, `deadlineAt`, `runtimeSnapshotHash`

### CaseMatch
- Owner: `P11`
- Version: `1.1`
- Schema hash: `135dbfad26d68afa26201c43cf69816a80be23d4a550c28062a755ff6cfb084f`
- Fields: `caseRef`, `score`, `applicability`, `failureBoundaryStatus`, `reasonCodes`

### CaseAdaptationInput
- Owner: `P11`
- Version: `1.1`
- Schema hash: `0c81b6bcabb43c588175a33d2621c431463a2547a6040efdfe39883e3a427929`
- Fields: `caseRef`, `goalContextRef`, `parameterBindingRef`, `policyDecisionRef`, `deadlineAt`, `runtimeSnapshotHash`

### CaseAdaptationResult
- Owner: `P11`
- Version: `1.1`
- Schema hash: `b2cd17de0f8a9bd09948981f29c368a1bc0ae18fedf4c9caf4d422e26ed2a72d`
- Fields: `caseRef`, `parameterMappings`, `planPatchCandidate`, `recoveryPlanCandidate`, `confidence`, `unknowns`, `validationRequired`

### CaseRuntime
- Owner: `P11`
- Version: `1.1`
- Schema hash: `a2cb1f3f4c0a18abf03d3fb1a552b1f480e11e8a2ac5d3f1aa98c849dd96a387`
- Signature: `retrieve(input: CaseRetrievalInput): Promise<CaseMatch[]>; adapt(input: CaseAdaptationInput): Promise<CaseAdaptationResult>`

### ModelProfile
- Owner: `P11`
- Version: `1.1`
- Schema hash: `03bc8f277534a5a1529d186697f7afa61eb27342a2f6ca6da85e5521d2af70bd`
- Fields: `profileId`, `providerId`, `modelId`, `modelVersion`, `capabilityTags`, `qualityTier`, `latencyTier`, `costTier`, `contextWindow`, `modalities`, `structuredOutputSupport`, `toolCallingSupport`, `dataResidency`, `dataClassificationAllowance`, `rateCapacity`, `readiness`, `health`, `profileVersion`

### ModelRouteContext
- Owner: `P11`
- Version: `1.1`
- Schema hash: `346e0917e77a181b332581bfdb94943742dc0dfec035938e50ba3ac225b93aa2`
- Fields: `requestRef`, `tenantId`, `taskTypeId`, `operationType`, `riskLevel`, `dataClassification`, `requiredCapabilities`, `outputSchemaRef`, `deadlineAt`, `budget`, `policySnapshotHash`, `providerProfileSnapshotHash`

### ModelRouteDecision
- Owner: `P11`
- Version: `1.1`
- Schema hash: `9785cd514c16f49982012f3943441defe246c33dfcf3429a3504885187b7d1fd`
- Fields: `route`, `reasonCodes`, `budget`, `fallbackRoutes`, `selectedProfileRefs`, `decisionHash`

### ModelCascadeRun
- Owner: `P11`
- Version: `1.1`
- Schema hash: `160a4e179dc1911f4b56557361bb0c688ea79d6c7f0964646fe70309959591df`
- Fields: `cascadeRunId`, `routeDecisionRef`, `status`, `stepRefs`, `selectedOutputRef`, `totalCostUnits`, `totalInputTokens`, `totalOutputTokens`, `completedAt`

### ModelRouteRuntime
- Owner: `P11`
- Version: `1.1`
- Schema hash: `386a10226570efe3572177718a9bca0f826cf6abc95ac91b63279a5993ae3dae`
- Signature: `evaluate(input: ModelRouteContext): Promise<ModelRouteDecision>`

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

### ReleaseCandidateDecision
- Owner: `P13`
- Version: `1.1`
- Schema hash: `370b260730ee559a3f292d57c82b9296f626c4b437defa1dc2776f59020f9045`
- Enum: `RELEASE_CANDIDATE_READY`, `RELEASE_CANDIDATE_BLOCKED`

### BaselineGateResult
- Owner: `P00`
- Version: `1.1`
- Schema hash: `5aacbf026e86abc963544573d7cd45db971ecb160b9f310e063f8b73961e4135`
- Fields: `status`, `repository`, `baselineSha`, `v123FinalEvidenceRefs`, `fullVerifyStatus`, `migrationHead`, `openBlockers`

### V123PrerequisiteMatrix
- Owner: `P00`
- Version: `1.1`
- Schema hash: `04281d02bccf1e1ce84f80091d3c4a1d2e75d1bb59705d8b8af7634b2d4de95c`
- Fields: `schemaVersion`, `baselineSha`, `items`, `fullVerify`, `decision`

## 核心表名

- `compiled_artifact`: artifact_id, artifact_key, version, artifact_type, tenant_id, domain, status, risk_level, definition, applicability, dependency_snapshot, lineage_id, validation_summary_id, content_hash, created_at
- `artifact_active_pointer`: artifact_key, artifact_id, artifact_version, activated_by, activated_at, lock_version
- `artifact_lineage`: lineage_id, artifact_id, artifact_version, source_episode_refs, source_knowledge_refs, source_correction_refs, source_pattern_refs, generation_methods, compiler_version, created_at
- `artifact_validation_run`: validation_run_id, artifact_id, artifact_version, validation_type, dataset_ref, status, result, metrics, counterexample_refs, started_at, completed_at
- `artifact_approval`: approval_id, artifact_id, artifact_version, approver_id, decision, reason, validation_summary_hash, created_at
- `artifact_execution`: artifact_execution_id, artifact_id, artifact_version, task_id, goal_id, goal_version, mode, decision_snapshot, generated_plan_id, status, fallback_reason_code, started_at, completed_at
- `artifact_feedback`: feedback_id, artifact_execution_id, artifact_id, feedback_type, reason_code, summary, impact, outcome_ref, created_at
- `artifact_match_log`: match_id, request_id, task_id, candidate_artifact_id, score, applicability, decision, reason_codes, policy_snapshot_hash, created_at
- `experience_trace`: trace_id, source_episode_id, task_type_refs, goal_fingerprint, capability_fingerprint, environment_fingerprint, trace, completeness, created_at
- `pattern_candidate`: pattern_id, pattern_type, cohort_fingerprint, definition, support_refs, contradiction_refs, confidence, status, created_at

## 统一事件名

- `experience.trace_created`
- `compiler.pattern_discovered`
- `compiler.artifact_candidate_created`
- `artifact.validation_started`
- `artifact.validation_completed`
- `artifact.shadow_started`
- `artifact.shadow_completed`
- `artifact.promotion_ready`
- `artifact.approval_recorded`
- `artifact.activated`
- `artifact.revalidating`
- `artifact.deprecated`
- `artifact.match_evaluated`
- `artifact.execution_started`
- `artifact.execution_completed`
- `artifact.execution_failed`
- `artifact.feedback_recorded`
- `gateway.route_selected`
- `gateway.confirmation_required`
- `gateway.fallback_started`
- `gateway.formal_handoff`
- `model_route.selected`
- `model_cascade.escalated`

## 统一队列名

- `sdar-compiler-normalization`
- `sdar-compiler-process-mining`
- `sdar-compiler-pattern-generalization`
- `sdar-compiler-artifact-generation`
- `sdar-artifact-replay`
- `sdar-artifact-simulation`
- `sdar-artifact-shadow`
- `sdar-artifact-revalidation`

## 统一 Feature Flags

- `SDAR_V13_ARTIFACT_MODE`: ['off', 'shadow', 'advisory', 'active']
- `SDAR_V13_TEMPLATE_ENABLED`: ['false', 'true']
- `SDAR_V13_RULE_ENABLED`: ['false', 'true']
- `SDAR_V13_FAST_GATEWAY_ENABLED`: ['false', 'true']
- `SDAR_V13_CASE_ENABLED`: ['false', 'true']
- `SDAR_V13_MODEL_CASCADE_ENABLED`: ['false', 'true']
- `SDAR_V13_TENANT_ALLOWLIST`: ['csv']
