import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const preflight = process.argv.includes('--preflight');
const packageBundleRoot = resolve(root, 'docs', 'SDAR_v1.3_Codex_Goal_Packages_Aligned_V1.1');
const packagesRoot = resolve(packageBundleRoot, 'packages');
const sharedRoot = resolve(packageBundleRoot, 'shared');
const reportsRoot = resolve(root, 'reports', 'goal');
const expectedFormalPackages = Array.from(
  { length: 14 },
  (_, index) => `P${String(index).padStart(2, '0')}`,
);
const expectedGoals = Array.from(
  { length: 23 },
  (_, index) => `G${String(index).padStart(2, '0')}`,
);
const expectedHandoffFields = [
  'schemaVersion',
  'packageId',
  'packageVersion',
  'sequence',
  'status',
  'repository',
  'baselineSha',
  'branch',
  'commits',
  'draftPrUrl',
  'contractRegistryVersion',
  'contractRegistrySha256',
  'consumedContracts',
  'producedContracts',
  'migrations',
  'repositoryPorts',
  'applicationPorts',
  'runtimePorts',
  'events',
  'queues',
  'featureFlags',
  'reasonCodeCatalogVersion',
  'evidenceRefs',
  'acceptanceSummary',
  'knownLimitations',
  'openBlockers',
  'nextPackage',
  'packageOutputs',
];
const requiredP05OverlayContracts = [
  'WorkflowPattern',
  'FusedPattern',
  'GeneralizedPattern',
  'CandidateStaticValidationResult',
];
const authorityDefinitions = [
  {
    id: 'formal_goal',
    owner: 'GoalService and PostgresRuntimeRepository',
    writePorts: ['GoalRepository', 'GoalContractRepository'],
    readProjections: ['GoalReadRepository', 'A2A task projection', 'Management query projection'],
    databaseTables: ['goal', 'user_goal_contract'],
    events: ['goal.created', 'goal.patched', 'goal.canceled'],
    tests: [
      'packages/application/test/user-goal-planning.unit.test.ts',
      'packages/persistence-postgres/test/user-goal-runtime.integration.test.ts',
    ],
    forbiddenWriters: ['Console', 'A2A adapter', 'Compiler', 'Redis worker'],
    allowedSqlWriters: [
      writer(
        'packages/persistence-postgres/src/repositories.ts',
        'GoalRepository and runtime transaction boundary',
      ),
      writer(
        'packages/persistence-postgres/src/user-goal-runtime-repository.ts',
        'GoalContractRepository transaction boundary',
      ),
    ],
  },
  {
    id: 'formal_plan',
    owner: 'UserGoalPlanController',
    writePorts: ['UserGoalRuntimeRepository', 'ConfirmedPlanHandoff'],
    readProjections: ['UserGoalPlanReadRepository', 'Template candidate projection'],
    databaseTables: ['user_goal_plan', 'skill_goal'],
    events: ['plan.created', 'plan.revised', 'plan.completed'],
    tests: [
      'packages/application/test/user-goal-plan-controller.unit.test.ts',
      'packages/persistence-postgres/test/user-goal-runtime.integration.test.ts',
    ],
    forbiddenWriters: ['Template runtime', 'Decision rule runtime', 'Case runtime', 'Model route'],
    allowedSqlWriters: [
      writer(
        'packages/persistence-postgres/src/user-goal-runtime-repository.ts',
        'UserGoalRuntimeRepository',
      ),
      writer(
        'packages/persistence-postgres/src/repositories.ts',
        'ConfirmedPlanHandoff and runtime repository transaction',
      ),
    ],
  },
  {
    id: 'skill_attempt',
    owner: 'Skill Goal and Attempt Authority',
    writePorts: ['UserGoalRuntimeRepository', 'SkillAttemptRepository'],
    readProjections: ['Attempt read model', 'Artifact execution evidence link'],
    databaseTables: ['skill_attempt'],
    events: ['skill_attempt.started', 'skill_attempt.completed'],
    tests: [
      'packages/domain/test/user-goal-runtime.unit.test.ts',
      'packages/persistence-postgres/test/user-goal-runtime.integration.test.ts',
    ],
    forbiddenWriters: ['Template runtime', 'Rule runtime', 'Worker wake payload'],
    allowedSqlWriters: [
      writer(
        'packages/persistence-postgres/src/user-goal-runtime-repository.ts',
        'UserGoalRuntimeRepository',
      ),
      writer(
        'packages/persistence-postgres/src/repositories.ts',
        'SkillAttemptRepository transaction boundary',
      ),
    ],
  },
  {
    id: 'formal_workflow',
    owner: 'LangGraph Formal Workflow Runtime',
    writePorts: ['WorkflowRepository', 'WorkflowContinuationRepository'],
    readProjections: ['Workflow management projection', 'A2A task projection'],
    databaseTables: [
      'workflow_plan',
      'workflow_instance',
      'workflow_control',
      'workflow_control_round',
    ],
    events: ['workflow.started', 'workflow.waiting_external', 'workflow.completed'],
    tests: [
      'packages/application/test/workflow-controller.unit.test.ts',
      'packages/persistence-postgres/test/workflow-continuation.integration.test.ts',
    ],
    forbiddenWriters: ['Compiler artifacts', 'Console', 'A2A projection store', 'Redis queue'],
    allowedSqlWriters: [
      writer(
        'packages/persistence-postgres/src/repositories.ts',
        'WorkflowRepository and WorkflowControlRepository',
      ),
      writer(
        'packages/persistence-postgres/src/workflow-continuation-repository.ts',
        'WorkflowContinuationRepository',
      ),
    ],
  },
  {
    id: 'outcome_recovery',
    owner: 'Outcome, Recovery and Terminal Authority',
    writePorts: ['OutcomeRepository', 'RecoveryRepository', 'UserGoalRuntimeRepository'],
    readProjections: ['Outcome evidence projection', 'Artifact feedback link'],
    databaseTables: [
      'outcome_decision',
      'runtime_terminal_outcome',
      'recovery_decision',
      'completed_effect',
    ],
    events: ['outcome.committed', 'recovery.decided'],
    tests: [
      'packages/application/test/user-goal-plan-controller.unit.test.ts',
      'packages/persistence-postgres/test/user-goal-runtime.integration.test.ts',
    ],
    forbiddenWriters: ['A2A adapter', 'Rule runtime', 'Template runtime', 'Redis worker'],
    allowedSqlWriters: [
      writer(
        'packages/persistence-postgres/src/repositories.ts',
        'OutcomeRepository and terminal transaction authority',
      ),
      writer(
        'packages/persistence-postgres/src/user-goal-runtime-repository.ts',
        'UserGoalRuntimeRepository recovery transaction',
      ),
    ],
  },
  {
    id: 'artifact_definition',
    owner: 'P02 PostgreSQL ArtifactRepository',
    writePorts: [
      'ArtifactRepository',
      'ReplayValidationRepository',
      'ArtifactShadowGovernanceRepository',
    ],
    readProjections: ['ArtifactRegistry', 'ArtifactManagementQueryRepository'],
    databaseTables: [
      'compiled_artifact',
      'artifact_lineage',
      'artifact_validation_run',
      'experience_trace',
      'pattern_candidate',
      'candidate_generation_run',
    ],
    events: [
      'compiler.artifact_candidate_created',
      'artifact.validation_completed',
      'artifact.shadow_completed',
    ],
    tests: [
      'packages/persistence-postgres/test/artifact-authority.integration.test.ts',
      'packages/persistence-postgres/test/artifact-shadow-p06.integration.test.ts',
    ],
    forbiddenWriters: ['Compiler domain service', 'Management API', 'Console', 'Redis worker'],
    allowedSqlWriters: [
      writer(
        'packages/persistence-postgres/src/compiler/artifact-repositories.ts',
        'ArtifactRepository',
      ),
      writer(
        'packages/persistence-postgres/src/compiler/artifact-governance-store.ts',
        'ArtifactGovernanceStore state transition port',
      ),
      writer(
        'packages/persistence-postgres/src/compiler/artifact-replay-validation-repository.ts',
        'ReplayValidationRepository',
      ),
      writer(
        'packages/persistence-postgres/src/compiler/artifact-shadow-governance-repository.ts',
        'ArtifactShadowGovernanceRepository',
      ),
      writer(
        'packages/persistence-postgres/src/compiler/experience-compilation-repositories.ts',
        'ExperienceCompilationRepository',
      ),
      writer(
        'packages/persistence-postgres/src/compiler/candidate-generation-repositories.ts',
        'CandidateGenerationRepository',
      ),
    ],
  },
  {
    id: 'artifact_active',
    owner: 'P06 Approval, Activation and Active Pointer Authority',
    writePorts: ['ArtifactGovernancePort', 'ArtifactGovernanceStore'],
    readProjections: ['ArtifactActiveProjection', 'ArtifactRegistry'],
    databaseTables: ['artifact_approval', 'artifact_active_pointer'],
    events: ['artifact.approval_recorded', 'artifact.activated', 'artifact.deprecated'],
    tests: [
      'packages/persistence-postgres/test/artifact-authority.integration.test.ts',
      'packages/persistence-postgres/test/artifact-shadow-p06.integration.test.ts',
    ],
    forbiddenWriters: ['Management HTTP handler', 'Console', 'Worker', 'Redis cache'],
    allowedSqlWriters: [
      writer(
        'packages/persistence-postgres/src/compiler/artifact-governance-store.ts',
        'ArtifactGovernanceStore',
      ),
      writer(
        'packages/persistence-postgres/src/compiler/artifact-repositories.ts',
        'ArtifactRepository activation compatibility port',
      ),
      writer(
        'packages/persistence-postgres/src/compiler/artifact-shadow-governance-repository.ts',
        'ArtifactShadowGovernanceRepository governed transition',
      ),
    ],
  },
  {
    id: 'artifact_runtime_evidence',
    owner: 'Artifact execution evidence repositories',
    writePorts: ['ArtifactExecutionRepository', 'ArtifactFeedbackRepository'],
    readProjections: ['P07 active retrieval', 'P12 management runtime projection'],
    databaseTables: ['artifact_execution', 'artifact_feedback', 'artifact_match_log'],
    events: [
      'artifact.match_evaluated',
      'artifact.execution_completed',
      'artifact.feedback_recorded',
    ],
    tests: [
      'packages/application/test/artifact-retrieval.contract.test.ts',
      'packages/persistence-postgres/test/artifact-retrieval-p07.integration.test.ts',
    ],
    forbiddenWriters: ['Console', 'A2A adapter', 'Redis cache'],
    allowedSqlWriters: [
      writer(
        'packages/persistence-postgres/src/compiler/artifact-repositories.ts',
        'ArtifactExecutionRepository',
      ),
      writer(
        'packages/persistence-postgres/src/compiler/artifact-retrieval-repository.ts',
        'ArtifactRetrievalEvidenceRepository',
      ),
      writer(
        'packages/persistence-postgres/src/compiler/fast-gateway-repository.ts',
        'FastGateway evidence repository',
      ),
    ],
  },
  {
    id: 'a2a_task_projection',
    owner: 'Formal task runtime with A2A projection adapter',
    writePorts: ['AgentTaskRepository', 'ExternalTaskProjectionRepository'],
    readProjections: ['A2AProjectionTaskStore'],
    databaseTables: ['agent_task', 'external_task_projection'],
    events: ['task.updated', 'a2a.projection_saved'],
    tests: [
      'packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts',
      'packages/a2a-adapter/test/http-endpoint.contract.test.ts',
    ],
    forbiddenWriters: ['A2A HTTP endpoint', 'Console', 'Redis queue'],
    allowedSqlWriters: [
      writer(
        'packages/persistence-postgres/src/repositories.ts',
        'AgentTaskRepository and ExternalTaskProjectionRepository',
      ),
      writer(
        'packages/persistence-postgres/src/remote-task-input-repository.ts',
        'RemoteTaskInputRepository formal wait transition',
      ),
    ],
  },
];

assertRepositoryRoot();

const candidateSha = gitText(['rev-parse', 'HEAD']);
const branch = gitText(['branch', '--show-current']);
const generatedAt = gitText(['show', '-s', '--format=%cI', candidateSha]);
const packageDirectories = discoverPackageDirectories();
const baseRegistry = readJson(resolve(sharedRoot, 'SDAR_v1.3_Frozen_Interface_Registry_V1.1.json'));
const overlayRegistry = readJson(
  resolve(sharedRoot, 'SDAR_v1.3_Frozen_Interface_Registry_V1.2.json'),
);
const mergedContracts = {
  ...baseRegistry.contracts,
  ...overlayRegistry.contracts,
};
const matrix = readJson(resolve(sharedRoot, 'SDAR_v1.3_Package_Execution_Matrix_V1.1.json'));
const bundleManifest = readJson(resolve(packageBundleRoot, 'bundle-manifest.json'));

const handoffReport = {
  schemaVersion: '1.0',
  reportId: 'SDAR-V1.3-P13-HANDOFF-INTEGRITY',
  mode: preflight ? 'preflight' : 'final',
  generatedAt,
  repository: 'zhouwen-giser/skill-driven-agent-runtime',
  branch,
  candidateSha,
  expectedTopLevelFieldCount: expectedHandoffFields.length,
  packages: [],
  remediationPackage: undefined,
  findings: [],
  status: 'pending',
};
const authorityReport = {
  schemaVersion: '1.0',
  reportId: 'SDAR-V1.3-P13-AUTHORITY-AUDIT',
  mode: preflight ? 'preflight' : 'final',
  generatedAt,
  candidateSha,
  authorities: authorityDefinitions.map((definition) => ({
    owner: definition.owner,
    authority: definition.id,
    writePorts: definition.writePorts,
    readProjections: definition.readProjections,
    databaseTables: definition.databaseTables,
    events: definition.events,
    tests: definition.tests,
    forbiddenWriters: definition.forbiddenWriters,
    allowedSqlWriters: definition.allowedSqlWriters,
    status: 'pending',
  })),
  directWriterScan: {
    protectedTables: authorityDefinitions.flatMap((definition) => definition.databaseTables),
    sqlWrites: [],
    boundaryChecks: [],
  },
  findings: [],
  status: 'pending',
};
const consistencyReport = {
  schemaVersion: '1.0',
  reportId: 'SDAR-V1.3-P13-FOURTEEN-PACKAGE-CONSISTENCY',
  mode: preflight ? 'preflight' : 'final',
  generatedAt,
  candidateSha,
  expectedCounts: {
    formalProductPackages: 14,
    mandatoryRemediationPackages: 1,
    optionalPostReleasePackages: 1,
  },
  actualCounts: {},
  registry: {},
  sequence: {},
  goals: {},
  selfChecks: [],
  packages: [],
  findings: [],
  status: 'pending',
};

validateRegistriesAndPackageShape();
validateFormalHandoffs();
validateP04rChain();
runAllPackageSelfChecks();
runAuthorityAudit();
finalizeAndWriteReports();

const blockingCount =
  handoffReport.findings.length +
  authorityReport.findings.length +
  consistencyReport.findings.length;
const p13 = handoffReport.packages.find((entry) => entry.package === 'P13');
process.stdout.write(
  `P13 release ${preflight ? 'preflight' : 'validation'} ${blockingCount === 0 ? 'passed' : 'failed'}: ` +
    `${String(blockingCount)} blocking drift(s), P13 handoff ${p13?.status ?? 'unknown'}, ` +
    `${String(consistencyReport.selfChecks.filter((check) => check.passed).length)}/` +
    `${String(consistencyReport.selfChecks.length)} package self-checks passed.\n`,
);
process.exitCode = blockingCount === 0 ? 0 : 1;

function writer(path, port) {
  return { path, port };
}

function assertRepositoryRoot() {
  const required = ['package.json', 'packages', 'apps', 'infra', 'reports', 'docs'];
  const missing = required.filter((entry) => !existsSync(resolve(root, entry)));
  if (missing.length > 0)
    throw new Error(`P13_RELEASE_VALIDATOR_REPOSITORY_ROOT_REQUIRED:${missing.join(',')}`);
}

function discoverPackageDirectories() {
  const discovered = new Map();
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = resolve(packagesRoot, entry.name);
    const manifestPath = resolve(directory, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    if (discovered.has(manifest.packageId))
      throw new Error(`P13_DUPLICATE_PACKAGE_ID:${manifest.packageId}`);
    discovered.set(manifest.packageId, { directory, manifest });
  }
  return discovered;
}

function validateRegistriesAndPackageShape() {
  const baseHash = canonicalRegistryHash(baseRegistry);
  const overlayHash = canonicalRegistryHash(overlayRegistry);
  consistencyReport.registry = {
    base: {
      version: baseRegistry.schemaVersion,
      declaredSha256: baseRegistry.registrySha256,
      actualSha256: baseHash,
      valid: baseRegistry.registrySha256 === baseHash,
    },
    overlay: {
      version: overlayRegistry.schemaVersion,
      declaredSha256: overlayRegistry.registrySha256,
      actualSha256: overlayHash,
      valid: overlayRegistry.registrySha256 === overlayHash,
      kind: overlayRegistry.registryKind,
      baseRegistry: overlayRegistry.baseRegistry,
      baseRegistrySha256: overlayRegistry.baseRegistrySha256,
    },
  };
  if (baseRegistry.registrySha256 !== baseHash)
    finding(consistencyReport, 'REGISTRY_V11_HASH_DRIFT', 'Shared Registry V1.1 hash drifted.');
  if (overlayRegistry.registrySha256 !== overlayHash)
    finding(consistencyReport, 'REGISTRY_V12_HASH_DRIFT', 'Shared Registry V1.2 hash drifted.');
  if (
    overlayRegistry.schemaVersion !== '1.2' ||
    overlayRegistry.registryKind !== 'immutable_delta' ||
    overlayRegistry.baseRegistrySha256 !== baseRegistry.registrySha256
  ) {
    finding(
      consistencyReport,
      'REGISTRY_V12_NOT_IMMUTABLE_DELTA',
      'Shared Registry V1.2 is not a valid immutable delta over V1.1.',
    );
  }

  const manifests = [...packageDirectories.values()].map(({ manifest }) => manifest);
  const formal = manifests.filter((manifest) => manifest.formalPackage === true);
  const remediation = manifests.filter(
    (manifest) =>
      manifest.formalPackage === false && manifest.packageClass === 'mandatory_remediation',
  );
  const optional = manifests.filter((manifest) => manifest.packageId === 'SDAR-V1.3-P14-OPTIONAL');
  consistencyReport.actualCounts = {
    formalProductPackages: formal.length,
    mandatoryRemediationPackages: remediation.length,
    optionalPostReleasePackages: optional.length,
  };
  const expectedCounts = consistencyReport.expectedCounts;
  if (
    formal.length !== expectedCounts.formalProductPackages ||
    remediation.length !== expectedCounts.mandatoryRemediationPackages ||
    optional.length !== expectedCounts.optionalPostReleasePackages ||
    JSON.stringify(overlayRegistry.counts) !== JSON.stringify(expectedCounts)
  ) {
    finding(
      consistencyReport,
      'PACKAGE_COUNTS_DRIFT',
      'Package accounting is not exactly 14 formal, 1 mandatory remediation and 1 optional.',
      consistencyReport.actualCounts,
    );
  }

  const formalLabels = formal
    .map((manifest) => manifest.sequenceLabel)
    .sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(formalLabels) !== JSON.stringify(expectedFormalPackages))
    finding(
      consistencyReport,
      'FORMAL_PACKAGE_MEMBERSHIP_DRIFT',
      'Formal package membership differs from P00-P13.',
      formalLabels,
    );

  const formalGoals = formal
    .sort((left, right) => left.sequence - right.sequence)
    .flatMap((manifest) => manifest.atomicGoals ?? []);
  consistencyReport.goals = {
    expected: expectedGoals,
    actual: formalGoals,
    g23Present: formalGoals.includes('G23'),
  };
  if (
    JSON.stringify(formalGoals) !== JSON.stringify(expectedGoals) ||
    formalGoals.includes('G23') ||
    bundleManifest.atomicGoals.includes('G23')
  ) {
    finding(
      consistencyReport,
      'ATOMIC_GOAL_COVERAGE_DRIFT',
      'Atomic Goal coverage must be exactly G00-G22 with no G23.',
      formalGoals,
    );
  }
  if (
    bundleManifest.formalPackageCount !== 14 ||
    JSON.stringify(bundleManifest.formalPackages) !== JSON.stringify(expectedFormalPackages) ||
    bundleManifest.p14Included !== false
  ) {
    finding(
      consistencyReport,
      'BUNDLE_MANIFEST_PACKAGE_DRIFT',
      'Bundle manifest does not preserve the 14-package formal baseline.',
    );
  }

  const p04 = matrix.find((entry) => entry.package === 'P04');
  const p04r = matrix.find((entry) => entry.package === 'P04R');
  const p05 = matrix.find((entry) => entry.package === 'P05');
  consistencyReport.sequence = {
    p04Next: p04?.next,
    p04r: {
      formal: p04r?.formal,
      mandatoryRemediation: p04r?.mandatoryRemediation,
      goals: p04r?.goals,
      next: p04r?.next,
    },
    p05DependsOnP04r: p05?.dependsOn.includes('P04R'),
    p05RequiredP04rStatus: p05?.requiredStatus.P04R,
  };
  if (
    p04?.next !== 'P04R' ||
    p04r?.formal !== false ||
    p04r?.mandatoryRemediation !== true ||
    p04r?.goals.length !== 0 ||
    p04r?.next !== 'P05' ||
    !p05?.dependsOn.includes('P04R') ||
    p05?.requiredStatus.P04R !== 'COMPLETED'
  ) {
    finding(
      consistencyReport,
      'P04_P04R_P05_SEQUENCE_DRIFT',
      'Execution matrix must sequence P04 -> P04R -> P05.',
    );
  }
}

function validateFormalHandoffs() {
  for (const packageLabel of expectedFormalPackages) {
    const packageId = `SDAR-V1.3-${packageLabel}`;
    const discovered = packageDirectories.get(packageId);
    if (discovered === undefined) {
      finding(handoffReport, 'PACKAGE_MANIFEST_MISSING', `${packageLabel} manifest is missing.`);
      continue;
    }
    const { directory, manifest } = discovered;
    const lock = readJson(resolve(directory, 'CONTRACT-LOCK.json'));
    const template = readJson(resolve(directory, 'templates', 'STANDARD-HANDOFF.json'));
    const entry = {
      package: packageLabel,
      packageId,
      manifestSchemaVersion: manifest.schemaVersion,
      lockSchemaVersion: lock.schemaVersion,
      handoffSchemaVersion: undefined,
      topLevelFieldCount: undefined,
      status: 'pending',
      evidenceRefs: [],
      commitRefs: [],
      contractHashes: 'pending',
      findings: [],
    };
    handoffReport.packages.push(entry);
    consistencyReport.packages.push({
      package: packageLabel,
      goals: manifest.atomicGoals,
      registryVersion: manifest.contractRegistryVersion,
      registrySha256: manifest.contractRegistrySha256,
      status: 'pending',
    });

    validateFormalPackageLock(packageLabel, manifest, lock, template, entry);

    const handoffPath = resolve(reportsRoot, `v1.3-${packageLabel.toLowerCase()}-handoff.json`);
    if (!existsSync(handoffPath)) {
      if (preflight && packageLabel === 'P13') {
        entry.status = 'pending_preflight';
        consistencyReport.packages.at(-1).status = 'pending_preflight';
        continue;
      }
      packageFinding(entry, 'HANDOFF_MISSING', `${packageLabel} Handoff is missing.`);
      continue;
    }

    const handoff = readJson(handoffPath);
    entry.handoffSchemaVersion = handoff.schemaVersion;
    entry.topLevelFieldCount = Object.keys(handoff).length;
    entry.status =
      handoff.status === '' && preflight && packageLabel === 'P13'
        ? 'pending_preflight'
        : handoff.status;
    consistencyReport.packages.at(-1).status = entry.status;
    validateHandoffEnvelope(packageLabel, manifest, lock, handoff, entry);
  }
  for (const entry of handoffReport.packages) {
    for (const issue of entry.findings)
      finding(handoffReport, `${entry.package}_${issue.code}`, issue.message, issue.details);
  }
}

function validateFormalPackageLock(packageLabel, manifest, lock, template, entry) {
  if (
    manifest.packageId !== `SDAR-V1.3-${packageLabel}` ||
    lock.packageId !== manifest.packageId ||
    manifest.schemaVersion !== '1.1' ||
    lock.schemaVersion !== '1.1' ||
    manifest.handoffSchemaVersion !== '1.1'
  ) {
    packageFinding(
      entry,
      'PACKAGE_SCHEMA_ID_DRIFT',
      `${packageLabel} manifest/lock identity or schema version drifted.`,
    );
  }
  const lockedFields = lock.handoffEnvelope?.fields;
  if (
    !Array.isArray(lockedFields) ||
    lockedFields.length !== 28 ||
    !sameStringSet(lockedFields, expectedHandoffFields) ||
    Object.keys(template).length !== 28 ||
    !sameStringSet(Object.keys(template), lockedFields)
  ) {
    packageFinding(
      entry,
      'HANDOFF_FIELD_LOCK_DRIFT',
      `${packageLabel} STANDARD-HANDOFF does not match the locked 28-field envelope.`,
    );
  }
  if (
    lock.handoffEnvelope?.version !== manifest.handoffSchemaVersion ||
    lock.registryVersion !== manifest.contractRegistryVersion ||
    lock.registrySha256 !== manifest.contractRegistrySha256 ||
    ![baseRegistry.registrySha256, overlayRegistry.registrySha256].includes(
      manifest.contractRegistrySha256,
    )
  ) {
    packageFinding(
      entry,
      'REGISTRY_LOCK_DRIFT',
      `${packageLabel} registry version/hash lock drifted.`,
    );
  }
  validateLockedContracts(packageLabel, manifest, lock, entry);
}

function validateLockedContracts(packageLabel, manifest, lock, entry) {
  const consumed = lock.consumedContracts ?? {};
  const produced = lock.producedContracts ?? {};
  if (
    !sameStringSet(manifest.consumesContracts, Object.keys(consumed)) ||
    !sameStringSet(manifest.producesContracts, Object.keys(produced))
  ) {
    packageFinding(
      entry,
      'MANIFEST_CONTRACT_SET_DRIFT',
      `${packageLabel} manifest contract names differ from CONTRACT-LOCK.`,
    );
  }
  for (const [direction, contracts] of [
    ['consumed', consumed],
    ['produced', produced],
  ]) {
    for (const [name, contract] of Object.entries(contracts)) {
      const registered = mergedContracts[name];
      if (
        registered === undefined ||
        contract.name !== name ||
        contract.version !== registered.version ||
        contract.schemaHash !== registered.schemaHash
      ) {
        packageFinding(
          entry,
          'CONTRACT_HASH_DRIFT',
          `${packageLabel} ${direction} contract ${name} does not match the Shared Registry.`,
        );
      }
    }
  }
}

function validateHandoffEnvelope(packageLabel, manifest, lock, handoff, entry) {
  const lockedFields = lock.handoffEnvelope.fields;
  if (Object.keys(handoff).length !== 28 || !sameStringSet(Object.keys(handoff), lockedFields)) {
    packageFinding(
      entry,
      'HANDOFF_TOP_LEVEL_FIELDS_DRIFT',
      `${packageLabel} Handoff must contain exactly the locked 28 top-level fields.`,
      Object.keys(handoff),
    );
  }
  if (
    handoff.packageId !== manifest.packageId ||
    handoff.schemaVersion !== manifest.handoffSchemaVersion ||
    handoff.packageVersion !== manifest.packageVersion ||
    handoff.sequence !== manifest.sequence
  ) {
    packageFinding(
      entry,
      'HANDOFF_IDENTITY_DRIFT',
      `${packageLabel} Handoff identity/schema fields do not match its manifest.`,
    );
  }
  const allowedStatus =
    preflight && packageLabel === 'P13' && (handoff.status === '' || handoff.status === 'PENDING')
      ? true
      : manifest.allowedCompletionStatuses.includes(handoff.status);
  if (!allowedStatus)
    packageFinding(
      entry,
      'HANDOFF_STATUS_INVALID',
      `${packageLabel} Handoff status ${String(handoff.status)} is not allowed.`,
    );
  if (packageLabel === 'P00' && handoff.status !== 'READY_FULL')
    packageFinding(entry, 'PREDECESSOR_STATUS_DRIFT', 'P00 must be READY_FULL.');
  if (packageLabel !== 'P00' && packageLabel !== 'P13' && handoff.status !== 'COMPLETED') {
    packageFinding(entry, 'PREDECESSOR_STATUS_DRIFT', `${packageLabel} must be COMPLETED.`);
  }
  if (
    handoff.contractRegistryVersion !== manifest.contractRegistryVersion ||
    handoff.contractRegistrySha256 !== manifest.contractRegistrySha256
  ) {
    packageFinding(
      entry,
      'HANDOFF_REGISTRY_DRIFT',
      `${packageLabel} Handoff registry version/hash drifted.`,
    );
  }
  validateHandoffContracts(packageLabel, lock, handoff, entry);
  validateEvidenceRefs(packageLabel, handoff.evidenceRefs, entry);
  validateCommitRefs(packageLabel, handoff, entry);
  if (
    packageLabel !== 'P13' &&
    (handoff.openBlockers.length !== 0 ||
      handoff.acceptanceSummary.failed !== 0 ||
      handoff.acceptanceSummary.blocked !== 0)
  ) {
    packageFinding(
      entry,
      'COMPLETED_HANDOFF_HAS_FAILURES',
      `${packageLabel} completed Handoff retains blockers or failed/blocked acceptance.`,
    );
  }
}

function validateHandoffContracts(packageLabel, lock, handoff, entry) {
  const pairs = [
    ['consumed', handoff.consumedContracts, lock.consumedContracts ?? {}],
    ['produced', handoff.producedContracts, lock.producedContracts ?? {}],
  ];
  let valid = true;
  for (const [direction, actual, expected] of pairs) {
    if (
      !sameStringSet(
        actual.map((contract) => contract.name),
        Object.keys(expected),
      )
    ) {
      packageFinding(
        entry,
        'HANDOFF_CONTRACT_SET_DRIFT',
        `${packageLabel} ${direction} Handoff contracts differ from CONTRACT-LOCK.`,
      );
      valid = false;
    }
    for (const contract of actual) {
      const locked = expected[contract.name];
      if (
        locked === undefined ||
        contract.version !== locked.version ||
        contract.schemaHash !== locked.schemaHash
      ) {
        packageFinding(
          entry,
          'HANDOFF_CONTRACT_HASH_DRIFT',
          `${packageLabel} ${direction} contract ${contract.name} hash/version drifted.`,
        );
        valid = false;
      }
    }
  }
  for (const [name, output] of Object.entries(handoff.packageOutputs)) {
    const locked = lock.producedContracts[name];
    if (
      locked === undefined ||
      output.contractVersion !== locked.version ||
      output.schemaHash !== locked.schemaHash
    ) {
      packageFinding(
        entry,
        'PACKAGE_OUTPUT_HASH_DRIFT',
        `${packageLabel} package output ${name} does not match its produced contract.`,
      );
      valid = false;
    }
    validateEvidenceRefs(`${packageLabel}:${name}`, output.refs ?? [], entry);
  }
  entry.contractHashes = valid ? 'aligned' : 'blocking_drift';
}

function validateEvidenceRefs(packageLabel, refs, entry) {
  for (const ref of refs) {
    const result = validateRepositoryRef(ref);
    entry.evidenceRefs.push({ ref, exists: result.exists, reason: result.reason });
    if (!result.exists)
      packageFinding(
        entry,
        'EVIDENCE_REF_MISSING',
        `${packageLabel} evidence ref does not resolve: ${ref}`,
        result.reason,
      );
  }
}

function validateCommitRefs(packageLabel, handoff, entry) {
  const refs = [
    ['baselineSha', handoff.baselineSha],
    ...Object.entries(handoff.commits).map(([name, value]) => [`commits.${name}`, value]),
  ];
  for (const [name, ref] of refs) {
    const result = commitAncestor(ref);
    entry.commitRefs.push({ name, ref, ...result });
    if (!result.resolves || !result.ancestor)
      packageFinding(
        entry,
        'COMMIT_NOT_ANCESTOR',
        `${packageLabel} ${name} is not a commit ancestor of candidate HEAD: ${String(ref)}`,
        result,
      );
  }
}

function validateP04rChain() {
  const discovered = packageDirectories.get('SDAR-V1.3-P04R');
  if (discovered === undefined) {
    finding(handoffReport, 'P04R_PACKAGE_MISSING', 'Mandatory P04R package is missing.');
    return;
  }
  const { directory, manifest } = discovered;
  const lock = readJson(resolve(directory, 'CONTRACT-LOCK.json'));
  const handoffPath = resolve(reportsRoot, 'v1.3-p04r-handoff.json');
  if (!existsSync(handoffPath)) {
    finding(handoffReport, 'P04R_HANDOFF_MISSING', 'P04R Handoff is missing.');
    return;
  }
  const handoff = readJson(handoffPath);
  handoffReport.remediationPackage = {
    package: 'P04R',
    packageId: handoff.packageId,
    schemaVersion: handoff.schemaVersion,
    status: handoff.status,
    evidenceRefs: [],
    commitRefs: [],
  };
  const p04rEntry = handoffReport.remediationPackage;
  if (
    manifest.formalPackage !== false ||
    manifest.packageClass !== 'mandatory_remediation' ||
    manifest.newAtomicGoal !== false ||
    manifest.sortOrder !== 4.5 ||
    manifest.nextPackage !== 'P05' ||
    handoff.status !== 'COMPLETED' ||
    handoff.contractRegistryVersion !== '1.2' ||
    handoff.contractRegistrySha256 !== overlayRegistry.registrySha256 ||
    lock.targetContractRegistrySha256 !== overlayRegistry.registrySha256
  ) {
    finding(
      handoffReport,
      'P04R_HANDOFF_DRIFT',
      'P04R package, lock or completed Handoff drifted.',
    );
  }
  for (const contract of handoff.producedContracts) {
    const registered = overlayRegistry.contracts[contract.name];
    const locked = lock.produces.find((candidate) => candidate.name === contract.name);
    if (
      registered === undefined ||
      locked === undefined ||
      contract.version !== '1.2' ||
      contract.version !== registered.version ||
      contract.schemaHash !== registered.schemaHash ||
      contract.schemaHash !== locked.schemaHash
    ) {
      finding(
        handoffReport,
        'P04R_CONTRACT_HASH_DRIFT',
        `P04R contract ${contract.name} does not match the V1.2 overlay.`,
      );
    }
  }
  for (const ref of handoff.evidenceRefs) {
    const result = validateRepositoryRef(ref);
    p04rEntry.evidenceRefs.push({ ref, exists: result.exists, reason: result.reason });
    if (!result.exists)
      finding(
        handoffReport,
        'P04R_EVIDENCE_REF_MISSING',
        `P04R evidence ref does not resolve: ${ref}`,
      );
  }
  for (const [name, ref] of [
    ['baselineSha', handoff.baselineSha],
    ['completionSha', handoff.completionSha],
  ]) {
    const result = commitAncestor(ref);
    p04rEntry.commitRefs.push({ name, ref, ...result });
    if (!result.resolves || !result.ancestor)
      finding(
        handoffReport,
        'P04R_COMMIT_NOT_ANCESTOR',
        `P04R ${name} is not an ancestor of candidate HEAD: ${String(ref)}`,
      );
  }

  const p03 = handoffReport.packages.find((entry) => entry.package === 'P03');
  const p04 = handoffReport.packages.find((entry) => entry.package === 'P04');
  if (
    p03?.status !== 'COMPLETED' ||
    p04?.status !== 'COMPLETED' ||
    p03.contractHashes !== 'aligned' ||
    p04.contractHashes !== 'aligned'
  ) {
    finding(
      handoffReport,
      'P03_P04_REVISED_HANDOFF_INVALID',
      'P03 and P04 revised V1.2 Handoffs must be COMPLETED and contract-aligned.',
    );
  }
  if (
    handoff.p03HandoffRef !== 'reports/goal/v1.3-p03-handoff.json' ||
    handoff.p04HandoffRef !== 'reports/goal/v1.3-p04-handoff.json'
  ) {
    finding(
      handoffReport,
      'P04R_REVISED_HANDOFF_REFS_DRIFT',
      'P04R must reference the revised P03 and P04 Handoffs.',
    );
  }

  const p04Manifest = packageDirectories.get('SDAR-V1.3-P04')?.manifest;
  const p05Discovered = packageDirectories.get('SDAR-V1.3-P05');
  const p05Manifest = p05Discovered?.manifest;
  const p05Lock =
    p05Discovered === undefined
      ? undefined
      : readJson(resolve(p05Discovered.directory, 'CONTRACT-LOCK.json'));
  if (
    p04Manifest?.nextPackage !== 'P04R' ||
    !p05Manifest?.dependsOn.includes('P04R') ||
    p05Manifest?.requiredPredecessorStatus.P04R !== 'COMPLETED' ||
    p05Manifest?.contractRegistryVersion !== '1.2' ||
    p05Manifest?.contractRegistrySha256 !== overlayRegistry.registrySha256
  ) {
    finding(
      consistencyReport,
      'P04R_MANIFEST_DEPENDENCY_DRIFT',
      'P04/P05 manifests do not enforce the mandatory P04R gate.',
    );
  }
  for (const contractName of requiredP05OverlayContracts) {
    const locked = p05Lock?.consumedContracts[contractName];
    const registered = overlayRegistry.contracts[contractName];
    if (
      locked === undefined ||
      registered === undefined ||
      locked.version !== '1.2' ||
      locked.schemaHash !== registered.schemaHash
    ) {
      finding(
        consistencyReport,
        'P05_V12_CONTRACT_DRIFT',
        `P05 does not consume ${contractName} V1.2 with the overlay hash.`,
      );
    }
  }
}

function runAllPackageSelfChecks() {
  const packages = [...packageDirectories.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [packageId, { directory }] of packages) {
    const selfCheck = resolve(directory, 'scripts', 'self-check.mjs');
    if (!existsSync(selfCheck)) {
      const result = {
        packageId,
        command: `node ${relativePath(selfCheck)}`,
        passed: false,
        exitCode: null,
        output: 'self-check missing',
      };
      consistencyReport.selfChecks.push(result);
      finding(
        consistencyReport,
        'PACKAGE_SELF_CHECK_MISSING',
        `${packageId} self-check is missing.`,
      );
      continue;
    }
    const run = spawnSync(process.execPath, [selfCheck], {
      cwd: directory,
      encoding: 'utf8',
    });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
    const result = {
      packageId,
      command: `node ${relativePath(selfCheck)}`,
      passed: run.status === 0,
      exitCode: run.status,
      output,
    };
    consistencyReport.selfChecks.push(result);
    if (!result.passed)
      finding(
        consistencyReport,
        'PACKAGE_SELF_CHECK_FAILED',
        `${packageId} self-check failed.`,
        output,
      );
  }
}

function runAuthorityAudit() {
  const sourceFiles = [
    ...walkSourceFiles(resolve(root, 'packages')),
    ...walkSourceFiles(resolve(root, 'apps')),
  ].filter((file) => normalize(file).includes('/src/'));
  const authorityByTable = new Map();
  for (const definition of authorityDefinitions) {
    for (const table of definition.databaseTables) authorityByTable.set(table, definition);
  }
  const allSqlWrites = [];
  const sqlPattern =
    /\b(?:(INSERT\s+INTO)\s+(?:public\.)?"?([a-z][a-z0-9_]*)"?(?=\s*(?:\(|VALUES\b|SELECT\b|DEFAULT\b))|(UPDATE)\s+(?:public\.)?"?([a-z][a-z0-9_]*)"?(?:\s+(?:AS\s+)?[a-z][a-z0-9_]*)?\s+SET\b|(DELETE\s+FROM)\s+(?:public\.)?"?([a-z][a-z0-9_]*)"?(?:\s+(?:AS\s+)?[a-z][a-z0-9_]*)?\s*(?=WHERE\b|USING\b|RETURNING\b|;))/giu;
  for (const file of sourceFiles) {
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(sqlPattern)) {
      const verb = (match[1] ?? match[3] ?? match[5]).replace(/\s+/gu, ' ').toUpperCase();
      const table = (match[2] ?? match[4] ?? match[6]).toLowerCase();
      const path = relativePath(file);
      const line = content.slice(0, match.index).split(/\r?\n/u).length;
      const authority = authorityByTable.get(table);
      const allowed = authority?.allowedSqlWriters.find((candidate) => candidate.path === path);
      const hit = {
        path,
        line,
        verb,
        table,
        authority: authority?.id ?? 'unclassified',
        status:
          authority === undefined
            ? path.startsWith('packages/persistence-postgres/src/')
              ? 'persistence_unclassified'
              : 'forbidden_non_persistence_sql'
            : allowed === undefined
              ? 'forbidden'
              : 'allowed',
        allowedPort: allowed?.port,
      };
      allSqlWrites.push(hit);
      if (authority !== undefined && allowed === undefined)
        finding(
          authorityReport,
          'UNEXPECTED_AUTHORITY_SQL_WRITER',
          `${path}:${String(line)} writes ${table} outside its owning module allowlist.`,
          hit,
        );
      if (authority === undefined && !path.startsWith('packages/persistence-postgres/src/')) {
        finding(
          authorityReport,
          'DIRECT_SQL_OUTSIDE_PERSISTENCE',
          `${path}:${String(line)} contains a direct ${verb} SQL writer outside PostgreSQL persistence.`,
          hit,
        );
      }
    }
  }
  authorityReport.directWriterScan.sqlWrites = allSqlWrites;

  const boundaryPolicies = [
    {
      name: 'console_projection_only',
      roots: ['apps/console/src'],
      forbidden:
        /(?:from\s+['"][^'"]*(?:persistence-postgres|runtime-redis)[^'"]*['"]|from\s+['"](?:pg|redis|bullmq)['"])/giu,
      explanation:
        'Console may issue versioned Management API commands, but may not import persistence/queue clients or write SQL.',
    },
    {
      name: 'a2a_projection_only',
      roots: ['packages/a2a-adapter/src'],
      forbidden:
        /(?:from\s+['"][^'"]*(?:persistence-postgres|runtime-redis)[^'"]*['"]|from\s+['"](?:pg|redis|bullmq)['"])/giu,
      explanation:
        'A2AProjectionTaskStore uses AgentTaskRepository and ExternalTaskProjectionRepository ports; it cannot write Formal Goal, Plan, Workflow or Outcome state directly.',
    },
    {
      name: 'worker_wake_only',
      roots: ['packages/runtime-redis/src'],
      forbidden:
        /(?:from\s+['"][^'"]*persistence-postgres[^'"]*['"]|from\s+['"]pg['"]|\.(?:approve|activate|recordApproval|activateArtifact)\s*\()/giu,
      explanation:
        'BullMQ workers may wake application services; they cannot own PostgreSQL records or approve/activate Artifacts.',
    },
  ];
  for (const policy of boundaryPolicies) {
    const hits = [];
    for (const policyRoot of policy.roots) {
      for (const file of walkSourceFiles(resolve(root, policyRoot))) {
        const content = readFileSync(file, 'utf8');
        for (const match of content.matchAll(policy.forbidden)) {
          hits.push({
            path: relativePath(file),
            line: content.slice(0, match.index).split(/\r?\n/u).length,
            match: match[0].replace(/\s+/gu, ' ').slice(0, 160),
          });
        }
      }
    }
    authorityReport.directWriterScan.boundaryChecks.push({
      name: policy.name,
      explanation: policy.explanation,
      hits,
      status: hits.length === 0 ? 'aligned' : 'blocking_drift',
    });
    if (hits.length > 0)
      finding(
        authorityReport,
        'BOUNDARY_WRITER_DRIFT',
        `${policy.name} found forbidden direct-writer capability.`,
        hits,
      );
  }

  validateManagementIdentityBoundary();
  validateArtifactOperationalControlBoundary();
  validateCompiledRuntimeHandoffBoundary(sourceFiles);
  validateAuthorityEvidenceFiles();

  for (const authority of authorityReport.authorities) {
    const blocking = authorityReport.findings.some(
      (issue) =>
        issue.details?.authority === authority.authority ||
        authority.databaseTables.includes(issue.details?.table),
    );
    authority.status = blocking ? 'blocking_drift' : 'aligned';
  }
}

function validateManagementIdentityBoundary() {
  const endpointPath = resolve(root, 'packages', 'management-api', 'src', 'http-endpoint.ts');
  const endpoint = readFileSync(endpointPath, 'utf8');
  const commandRoute = sliceBetween(
    endpoint,
    "app.post(\n    '/api/v1/artifacts/:artifactId/commands/:operation'",
    "  app.get(\n    '/api/v1/artifact-events'",
  );
  const commandSchema = sliceBetween(
    endpoint,
    'const ArtifactManagementCommandSchema',
    'export interface ManagementOperations',
  );
  const usesResolvedPrincipal =
    commandRoute.includes('resolveManagementPrincipal') &&
    commandRoute.includes('management.commands.execute(principal, operation');
  const bodyIdentityAbsent =
    !/\b(?:actorId|operatorId|tenantId|permissions|roles)\b/u.test(commandSchema) &&
    !/\b(?:input|request\.body)\.(?:actorId|operatorId|tenantId|permissions|roles)\b/u.test(
      commandRoute,
    );
  const legacyCommandsDisabled = endpoint.includes('ARTIFACT_LEGACY_COMMAND_DISABLED');
  const cognitiveBodyActorLabels = (endpoint.match(/\bactorId:\s*z\.string\(\)/gu) ?? []).length;
  const result = {
    name: 'management_authenticated_principal',
    explanation:
      'P12 Artifact commands resolve deployment-owned identity from Authorization/request context. Existing cognitive actorId fields are allowlisted audit labels under the trusted-intranet baseline and are not accepted by the P12 Artifact command schema.',
    usesResolvedPrincipal,
    artifactCommandBodyIdentityAbsent: bodyIdentityAbsent,
    legacyArtifactCommandsDisabled: legacyCommandsDisabled,
    allowlistedCognitiveAuditLabelOccurrences: cognitiveBodyActorLabels,
    status:
      usesResolvedPrincipal && bodyIdentityAbsent && legacyCommandsDisabled
        ? 'aligned'
        : 'blocking_drift',
  };
  authorityReport.directWriterScan.boundaryChecks.push(result);
  if (result.status !== 'aligned')
    finding(
      authorityReport,
      'BODY_ACTOR_IDENTITY_DRIFT',
      'P12 Artifact management accepts body-owned identity or bypasses its principal resolver.',
      result,
    );
}

function validateArtifactOperationalControlBoundary() {
  const commandService = readFileSync(
    resolve(root, 'packages', 'application', 'src', 'compiler', 'artifact-management.ts'),
    'utf8',
  );
  const runtime = readFileSync(resolve(root, 'apps', 'server', 'src', 'runtime.ts'), 'utf8');
  const e2e = readFileSync(
    resolve(root, 'apps', 'server', 'test', 'artifact-operational-flags-p13.e2e.test.ts'),
    'utf8',
  );
  const promotionControl = sliceBetween(
    runtime,
    'const PROMOTION_CONTROLLED_ARTIFACT_MANAGEMENT_OPERATIONS',
    'const SHADOW_CONTROLLED_ARTIFACT_MANAGEMENT_OPERATIONS',
  );
  const shadowControl = sliceBetween(
    runtime,
    'const SHADOW_CONTROLLED_ARTIFACT_MANAGEMENT_OPERATIONS',
    'export async function startServerRuntime',
  );
  const requiredPromotionOperations = ['build-promotion-package', 'approve', 'reject', 'activate'];
  const forbiddenSafetyOperations = [
    'deprecate',
    'rollback',
    'kill-switch-enable',
    'kill-switch-disable',
  ];
  const result = {
    name: 'artifact_operational_command_controls',
    explanation:
      'P13 promotion/shadow stop controls gate management writes before governance, while deprecation, rollback and kill-switch safety commands remain available.',
    applicationPolicyEnforced:
      commandService.includes('ArtifactManagementOperationPolicy') &&
      commandService.includes('policyOperationFor(operation, input.validationType)') &&
      commandService.includes("ArtifactManagementError('ARTIFACT_OPERATION_DISABLED', 503)"),
    validationTypeAliasesControlled:
      commandService.includes("if (validationType === 'shadow') return 'shadow'") &&
      commandService.includes("if (validationType === 'revalidation') return 'revalidate'"),
    runtimePolicyInjected:
      runtime.includes('operationPolicy: {') &&
      runtime.includes('isArtifactManagementOperationEnabled(operation, artifactFlags)'),
    promotionOperationsCovered: requiredPromotionOperations.every((operation) =>
      promotionControl.includes(`'${operation}'`),
    ),
    shadowOperationsCovered: ['shadow', 'revalidate'].every((operation) =>
      shadowControl.includes(`'${operation}'`),
    ),
    safetyOperationsPreserved: forbiddenSafetyOperations.every(
      (operation) =>
        !promotionControl.includes(`'${operation}'`) && !shadowControl.includes(`'${operation}'`),
    ),
    bearerServerE2e:
      e2e.includes('ConfiguredBearerArtifactManagementIdentity') &&
      e2e.includes('ARTIFACT_OPERATION_DISABLED') &&
      e2e.includes("WHERE event_type='artifact.validation_started'") &&
      e2e.includes('rows: [{ validations: 0, validation_events: 0 }]') &&
      e2e.includes("process.env['SDAR_V13_PROMOTION_ENABLED'] = 'true'") &&
      e2e.includes("artifactCommand('activate'"),
  };
  const aligned = Object.entries(result)
    .filter(([, value]) => typeof value === 'boolean')
    .every(([, value]) => value === true);
  const evidence = {
    ...result,
    status: aligned ? 'aligned' : 'blocking_drift',
  };
  authorityReport.directWriterScan.boundaryChecks.push(evidence);
  if (!aligned)
    finding(
      authorityReport,
      'ARTIFACT_OPERATIONAL_CONTROL_DRIFT',
      'P13 management promotion/shadow commands bypass a release control or disable an emergency safety command.',
      evidence,
    );
}

function validateCompiledRuntimeHandoffBoundary(sourceFiles) {
  const runtimeFiles = new Set([
    'packages/application/src/compiler/template-runtime.ts',
    'packages/application/src/compiler/decision-rule-runtime.ts',
    'packages/application/src/compiler/case-model-runtime.ts',
  ]);
  const forbidden =
    /(?:from\s+['"][^'"]*persistence-postgres[^'"]*['"]|\.(?:saveGoal|createGoal|savePlan|createPlan|startAttempt|saveOutcome|commitOutcome)\s*\()/giu;
  const hits = [];
  for (const file of sourceFiles) {
    const path = relativePath(file);
    if (!runtimeFiles.has(path)) continue;
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(forbidden)) {
      hits.push({
        path,
        line: content.slice(0, match.index).split(/\r?\n/u).length,
        match: match[0].replace(/\s+/gu, ' '),
      });
    }
  }
  const result = {
    name: 'compiled_runtime_formal_handoff_only',
    explanation:
      'Template, Rule, Case and Model runtime modules may produce decisions/candidates only; Formal Plan/Attempt/Outcome writes remain behind ConfirmedPlanHandoff and formal runtime ports.',
    inspectedFiles: [...runtimeFiles],
    hits,
    status: hits.length === 0 ? 'aligned' : 'blocking_drift',
  };
  authorityReport.directWriterScan.boundaryChecks.push(result);
  if (hits.length > 0)
    finding(
      authorityReport,
      'COMPILED_RUNTIME_FORMAL_AUTHORITY_BYPASS',
      'A compiled runtime directly invokes a Formal Goal/Plan/Attempt/Outcome writer.',
      hits,
    );
}

function validateAuthorityEvidenceFiles() {
  for (const authority of authorityDefinitions) {
    for (const test of authority.tests) {
      if (!existsSync(resolve(root, test)))
        finding(
          authorityReport,
          'AUTHORITY_TEST_EVIDENCE_MISSING',
          `${authority.id} test evidence does not exist: ${test}`,
          { authority: authority.id, test },
        );
    }
  }
}

function finalizeAndWriteReports() {
  handoffReport.status =
    handoffReport.findings.length === 0
      ? preflight &&
        handoffReport.packages.find((entry) => entry.package === 'P13')?.status ===
          'pending_preflight'
        ? 'aligned_with_p13_pending'
        : 'aligned'
      : 'blocking_drift';
  authorityReport.status = authorityReport.findings.length === 0 ? 'aligned' : 'blocking_drift';
  consistencyReport.status =
    consistencyReport.findings.length === 0
      ? preflight
        ? 'aligned_preflight'
        : 'aligned'
      : 'blocking_drift';
  writeJson(resolve(reportsRoot, 'v1.3-final-handoff-integrity.json'), handoffReport);
  writeJson(resolve(reportsRoot, 'v1.3-final-authority-audit.json'), authorityReport);
  writeJson(resolve(reportsRoot, 'v1.3-final-package-consistency.json'), consistencyReport);
  writeFileSync(
    resolve(reportsRoot, 'v1.3-final-package-consistency.md'),
    renderConsistencyMarkdown(),
    'utf8',
  );
}

function renderConsistencyMarkdown() {
  const rows = consistencyReport.packages
    .map(
      (entry) =>
        `| ${entry.package} | ${(entry.goals ?? []).join(', ') || '--'} | ${entry.registryVersion} | ${entry.status} |`,
    )
    .join('\n');
  const selfChecks = consistencyReport.selfChecks
    .map(
      (entry) =>
        `| ${entry.packageId.replace('SDAR-V1.3-', '')} | ${entry.passed ? 'PASS' : 'FAIL'} | ${entry.exitCode ?? '--'} |`,
    )
    .join('\n');
  const findings =
    consistencyReport.findings.length === 0
      ? '- None.'
      : consistencyReport.findings
          .map((issue) => `- \`${issue.code}\`: ${issue.message}`)
          .join('\n');
  return (
    `# SDAR v1.3 Final Package Consistency

- Mode: \`${consistencyReport.mode}\`
- Candidate SHA: \`${candidateSha}\`
- Status: \`${consistencyReport.status}\`
- Package accounting: \`${String(consistencyReport.actualCounts.formalProductPackages)}/` +
    `${String(consistencyReport.actualCounts.mandatoryRemediationPackages)}/` +
    `${String(consistencyReport.actualCounts.optionalPostReleasePackages)}\` (formal/remediation/optional)
- Atomic Goals: \`G00-G22\`; G23 present: \`${String(consistencyReport.goals.g23Present)}\`

## Package Matrix

| Package | Goals | Registry | Handoff Status |
|---|---|---|---|
${rows}

P04R remains a mandatory non-formal gate sequenced \`P04 -> P04R -> P05\`. P14 remains optional post-release scope and is not counted as a formal package.

## Package Self-checks

| Package | Result | Exit |
|---|---|---:|
${selfChecks}

## Blocking Drift

${findings}
`
  );
}

function packageFinding(entry, code, message, details) {
  entry.findings.push({ code, message, ...(details === undefined ? {} : { details }) });
}

function finding(report, code, message, details) {
  report.findings.push({
    severity: 'blocking',
    code,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

function validateRepositoryRef(ref) {
  if (typeof ref !== 'string' || ref.length === 0)
    return { exists: false, reason: 'empty_or_non_string' };
  if (/^https?:\/\//u.test(ref))
    return { exists: false, reason: 'external_ref_not_repository_evidence' };
  const target = resolve(root, ref);
  const relativeTarget = relative(root, target);
  if (
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${sep}`) ||
    relativeTarget.includes(`..${sep}`)
  ) {
    return { exists: false, reason: 'ref_escapes_repository' };
  }
  if (!existsSync(target)) return { exists: false, reason: 'missing' };
  return {
    exists: statSync(target).isFile(),
    reason: statSync(target).isFile() ? 'file' : 'not_a_file',
  };
}

function commitAncestor(ref) {
  if (typeof ref !== 'string' || !/^[0-9a-f]{7,40}$/u.test(ref))
    return { resolves: false, ancestor: false, resolvedSha: undefined };
  const resolved = git(['rev-parse', '--verify', `${ref}^{commit}`]);
  if (resolved.status !== 0) return { resolves: false, ancestor: false, resolvedSha: undefined };
  const resolvedSha = resolved.stdout.trim();
  const ancestor = git(['merge-base', '--is-ancestor', resolvedSha, candidateSha]).status === 0;
  return { resolves: true, ancestor, resolvedSha };
}

function canonicalRegistryHash(registry) {
  const input = { ...registry };
  delete input.registrySha256;
  return createHash('sha256')
    .update(JSON.stringify(sortValue(input), null, 2))
    .digest('hex');
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function walkSourceFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const target = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkSourceFiles(target));
    else if (/\.(?:ts|tsx|mts|mjs)$/u.test(entry.name) && !/\.test\./u.test(entry.name))
      files.push(target);
  }
  return files;
}

function sliceBetween(content, start, end) {
  const startIndex = content.indexOf(start);
  if (startIndex === -1) return '';
  const endIndex = content.indexOf(end, startIndex + start.length);
  return endIndex === -1 ? content.slice(startIndex) : content.slice(startIndex, endIndex);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function git(args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

function gitText(args) {
  const result = git(args);
  if (result.status !== 0)
    throw new Error(`P13_GIT_COMMAND_FAILED:git ${args.join(' ')}:${result.stderr}`);
  return result.stdout.trim();
}

function relativePath(file) {
  return normalize(relative(root, file));
}

function normalize(value) {
  return value.replaceAll('\\', '/');
}
