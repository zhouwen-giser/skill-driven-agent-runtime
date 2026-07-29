import { describe, expect, it } from 'vitest';

import {
  ArtifactCandidateGenerator,
  CandidateStaticValidator,
} from '../src/compiler/candidate-generator.js';
import {
  CandidateGenerationApplicationService,
  type CandidateGenerationCompletion,
  type CandidateGenerationRun,
  type CandidateGenerationRunRepository,
} from '../src/compiler/candidate-generation.js';
import {
  PatternFusionService,
  PatternGeneralizationService,
  type SemanticModelPort,
} from '../src/compiler/pattern-generalization.js';
import type {
  DiscoveredProcessPattern,
  PatternScopeEvidence,
  PlanTemplateArtifactDefinition,
  WorkflowPattern,
} from '../../domain/src/index.js';

const quality = {
  supportCount: 3,
  totalTraceCount: 4,
  supportRate: 0.75,
  successRate: 0.75,
  traceCoverage: 0.75,
  fitness: 0.8,
  precisionProxy: 0.7,
  environmentCoverage: 0.5,
  contradictionRate: 0.25,
  generalization: 0.6,
  mandatoryThreshold: 0.75,
} as const;

const workflowPattern: WorkflowPattern = {
  workflowPatternId: 'wp-p04r-real-001',
  taskTypeId: 'task-type-workflow-inspection',
  activityPatterns: [
    activity(
      'skill-goal:inspect-workflow',
      'skill_goal',
      'Inspect the persisted workflow',
      'cap-observe',
      true,
    ),
    activity(
      'skill-goal:verify-policy',
      'verification',
      'Verify the workflow policy',
      'cap-verify',
      true,
    ),
    activity(
      'provider-operation:apply-policy',
      'provider_operation',
      'Apply the verified policy',
      'cap-execute',
      true,
    ),
    activity(
      'recovery:apply-policy:resume',
      'skill_goal',
      'Recover policy application',
      'cap-recover',
      false,
    ),
  ],
  dependencyPatterns: [
    dependency('skill-goal:inspect-workflow', 'skill-goal:verify-policy', 'parallel'),
    dependency('skill-goal:inspect-workflow', 'provider-operation:apply-policy', 'precedes'),
    dependency('skill-goal:verify-policy', 'provider-operation:apply-policy', 'precedes'),
  ],
  recoveryPatterns: [
    {
      triggerActivityKey: 'provider-operation:apply-policy',
      resumeActivityKey: 'skill-goal:verify-policy',
      activitySequence: ['recovery:apply-policy:resume', 'skill-goal:verify-policy'],
      requiredCapabilityRefs: ['cap-recover'],
      supportRefs: ['trace-3'],
    },
  ],
  sourcePatternRef: 'process-pattern-p04r-001',
  sourceTraceRefs: ['trace-1', 'trace-2', 'trace-3'],
  quality,
};

const discoveredPattern: DiscoveredProcessPattern = {
  patternId: 'process-pattern-p04r-001',
  cohortFingerprint: `sha256:${'a'.repeat(64)}`,
  algorithmVersion: 'sdar-deterministic-process-miner/1.2',
  mandatoryActivities: workflowPattern.activityPatterns
    .filter((item) => item.required)
    .map((item) => item.activityKey),
  optionalActivities: ['recovery:apply-policy:resume'],
  orderingConstraints: [],
  parallelCandidates: [],
  recoveryBranches: workflowPattern.recoveryPatterns,
  failureVariants: [],
  supportRefs: ['trace-1', 'trace-2', 'trace-3'],
  contradictionRefs: ['trace-failure-1'],
  environmentCoverage: ['server/a', 'server/b'],
  quality,
};

const scopeEvidence: PatternScopeEvidence = {
  tenantCount: 1,
  userCount: 2,
  deviceClassCount: 2,
  environmentClassCount: 2,
  successCount: 2,
  failureCount: 1,
  hasTemporaryAuthorization: false,
  hasFailureBoundary: true,
};

const catalog = ['cap-observe', 'cap-verify', 'cap-execute', 'cap-recover'];

const semanticModel: SemanticModelPort = {
  modelId: 'test-semantic-model/1.2',
  promptHash: 'prompt-hash',
  suggestSemanticCandidates: () =>
    Promise.resolve({
      activityNames: {},
      parameterCandidates: [
        {
          parameterName: 'maximumRetries',
          suggestedSchema: { type: 'integer', minimum: 0, maximum: 3, enum: [0, 1, 2, 3] },
          sourceField: 'runtime.retryBudget',
          domainClass: 'bounded_retry_budget',
          allowedSources: ['user_confirmed', 'runtime_context'],
          trustLevel: 'trusted',
          required: true,
          defaultPolicy: 'low_risk_only',
          confidence: 0.8,
        },
      ],
      capabilityMappings: [],
      negativeExamples: [],
      explanation: 'bounded semantic candidate',
    }),
};

describe('P04R bounded Plan Template candidate compiler', () => {
  async function fuse(overrides: Partial<PatternScopeEvidence> = {}) {
    return new PatternFusionService().fuse({
      workflowPattern,
      discoveredPattern,
      domain: 'workflow-operations',
      tenantId: 'tenant-test',
      environmentClasses: ['server', 'edge'],
      deviceClasses: ['device-a', 'device-b'],
      tenantScope: 'single',
      userScope: 'multi',
      scopeEvidence: { ...scopeEvidence, ...overrides },
      model: semanticModel,
    });
  }

  async function generate() {
    const fusedPattern = await fuse();
    const generalizedPattern = new PatternGeneralizationService().generalize({
      fusedPattern,
      knownTaskTypeCapabilities: catalog,
    });
    const candidate = new ArtifactCandidateGenerator().generate({
      generalizedPattern,
      fusedPattern,
      knownCapabilityIds: catalog,
      sourceEpisodeRefs: ['episode-1', 'episode-2', 'episode-3'],
      sourceCorrectionRefs: ['correction-1'],
      tenantId: 'tenant-test',
      createdAt: '2026-07-28T00:00:00.000Z',
    });
    return { fusedPattern, generalizedPattern, candidate };
  }

  it('preserves the full P03 WorkflowPattern V1.2 and scope evidence', async () => {
    const fused = await fuse();
    expect(fused.fusionVersion).toBe('sdar-pattern-fusion/1.2');
    expect(fused.structuralPattern).toEqual(workflowPattern);
    expect(fused.scopeEvidence).toEqual(scopeEvidence);
    expect(fused.contradictionRefs).toEqual(['trace-failure-1']);
  });

  it('executes all anti-overfitting gates', async () => {
    const service = new PatternGeneralizationService();
    const singleDevice = await fuse({ deviceClassCount: 1 });
    expect(() =>
      service.generalize({ fusedPattern: singleDevice, knownTaskTypeCapabilities: catalog }),
    ).toThrow(/SINGLE_DEVICE/u);

    const singleEnvironment = await fuse({ environmentClassCount: 1 });
    expect(() =>
      service.generalize({ fusedPattern: singleEnvironment, knownTaskTypeCapabilities: catalog }),
    ).toThrow(/SINGLE_ENVIRONMENT/u);

    const singleUser = await fuse({ userCount: 1 });
    expect(() =>
      service.generalize({ fusedPattern: singleUser, knownTaskTypeCapabilities: catalog }),
    ).toThrow(/SINGLE_USER/u);
    const isolatedSingleUser = {
      ...singleUser,
      applicabilityCandidate: {
        ...singleUser.applicabilityCandidate,
        userScope: 'single' as const,
      },
    };
    expect(() =>
      service.generalize({
        fusedPattern: isolatedSingleUser,
        knownTaskTypeCapabilities: catalog,
      }),
    ).not.toThrow();

    const temporaryAuthorization = await fuse({ hasTemporaryAuthorization: true });
    expect(() =>
      service.generalize({
        fusedPattern: temporaryAuthorization,
        knownTaskTypeCapabilities: catalog,
      }),
    ).toThrow(/TEMPORARY_AUTHORIZATION/u);

    const singleSuccess = await fuse({
      successCount: 1,
      failureCount: 0,
      hasFailureBoundary: false,
    });
    expect(() =>
      service.generalize({ fusedPattern: singleSuccess, knownTaskTypeCapabilities: catalog }),
    ).toThrow(/SINGLE_SUCCESS/u);

    const lostFailureBoundary = {
      ...(await fuse()),
      structuralPattern: { ...workflowPattern, recoveryPatterns: [] },
    };
    expect(() =>
      service.generalize({
        fusedPattern: lostFailureBoundary,
        knownTaskTypeCapabilities: catalog,
      }),
    ).toThrow(/FAILURE_BOUNDARY_LOST/u);
  });

  it('uses knownTaskTypeCapabilities and knownCapabilityIds as real Catalog gates', async () => {
    const fusedPattern = await fuse();
    expect(() =>
      new PatternGeneralizationService().generalize({
        fusedPattern,
        knownTaskTypeCapabilities: catalog.filter((id) => id !== 'cap-execute'),
      }),
    ).toThrow(/CAPABILITY_CATALOG_MISMATCH/u);

    const generalizedPattern = new PatternGeneralizationService().generalize({
      fusedPattern,
      knownTaskTypeCapabilities: catalog,
    });
    expect(() =>
      new ArtifactCandidateGenerator().generate({
        generalizedPattern,
        fusedPattern,
        knownCapabilityIds: catalog.filter((id) => id !== 'cap-execute'),
        sourceEpisodeRefs: ['episode-1'],
        sourceCorrectionRefs: [],
        createdAt: '2026-07-28T00:00:00.000Z',
      }),
    ).toThrow(/CAPABILITY_CATALOG_MISMATCH/u);
  });

  it('preserves operation/effect-backed observations with their Catalog Capability', async () => {
    const fusedPattern = await fuse();
    const observation = {
      ...activity(
        'progress-observation:progress-1',
        'observation',
        'Observe stalled workflow progress',
        'cap-observe',
        false,
      ),
      effectRefs: ['effect:workflow-progress'],
    };
    const withObservation = {
      ...fusedPattern,
      structuralPattern: {
        ...fusedPattern.structuralPattern,
        activityPatterns: [...fusedPattern.structuralPattern.activityPatterns, observation],
      },
    };
    const generalizedPattern = new PatternGeneralizationService().generalize({
      fusedPattern: withObservation,
      knownTaskTypeCapabilities: catalog,
    });
    const candidate = new ArtifactCandidateGenerator().generate({
      generalizedPattern,
      fusedPattern: withObservation,
      knownCapabilityIds: catalog,
      sourceEpisodeRefs: ['episode-1', 'episode-2', 'episode-3'],
      sourceCorrectionRefs: [],
      tenantId: 'tenant-test',
      createdAt: '2026-07-28T00:00:00.000Z',
    });
    const definition = candidate.artifact.definition as PlanTemplateArtifactDefinition;
    expect(
      definition.skillGoalGraph.nodes.find((node) =>
        node.constraints.includes('activity-key:progress-observation:progress-1'),
      ),
    ).toMatchObject({
      nodeType: 'observation',
      requiredCapabilities: ['cap-observe'],
      requiredEffectRefs: ['effect:workflow-progress'],
    });
    expect(candidate.validation).toMatchObject({
      result: 'passed_static',
      capabilityShapeValid: true,
      capabilityCatalogAligned: true,
    });
    expect(candidate.validation.warnings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CAPABILITY_EMPTY' })]),
    );
  });

  it('compiles exact activity mapping, parallel groups, parameters and recovery losslessly', async () => {
    const { candidate } = await generate();
    const definition = candidate.artifact.definition as PlanTemplateArtifactDefinition;
    if (candidate.artifact.artifactType !== 'plan_template') throw new Error('fixture drift');

    expect(definition.skillGoalGraph.nodes).toHaveLength(workflowPattern.activityPatterns.length);
    expect(
      definition.skillGoalGraph.nodes.flatMap((node) =>
        node.constraints.filter((constraint) => constraint.startsWith('parallel-group:')),
      ),
    ).toHaveLength(2);
    expect(
      definition.skillGoalGraph.dependencies.filter((edge) => edge.predicate === 'optional'),
    ).toEqual([
      expect.objectContaining({
        condition: expect.objectContaining({
          type: 'atomic',
          field: expect.stringMatching(/^runtime\.failure\./u),
        }),
      }),
    ]);
    expect(definition.parameterSchema).toMatchObject({
      properties: {
        maximumRetries: {
          type: 'integer',
          minimum: 0,
          maximum: 3,
          enum: [0, 1, 2, 3],
          'x-sdar-allowedSources': ['user_confirmed', 'runtime_context'],
          'x-sdar-trustLevel': 'trusted',
          'x-sdar-sourceField': 'runtime.retryBudget',
          'x-sdar-domainClass': 'bounded_retry_budget',
          'x-sdar-defaultPolicy': 'low_risk_only',
        },
      },
    });
    expect(definition.parameterBindings).toEqual([
      expect.objectContaining({
        parameterName: 'maximumRetries',
        required: true,
        allowedSources: 'user_confirmed',
        trustLevel: 'trusted',
        defaultPolicy: 'low_risk_only',
      }),
    ]);
    expect(definition.recoveryBranches[0]).toMatchObject({
      requiredCapabilities: ['cap-recover'],
      planPatchTemplate: {
        triggerActivityKey: 'provider-operation:apply-policy',
        resumeActivityKey: 'skill-goal:verify-policy',
        activitySequence: ['recovery:apply-policy:resume', 'skill-goal:verify-policy'],
      },
    });
  });

  it('fails instead of silently dropping a dependency with an unknown activityKey', async () => {
    const fusedPattern = await fuse();
    const drifted = {
      ...fusedPattern,
      structuralPattern: {
        ...fusedPattern.structuralPattern,
        dependencyPatterns: [
          ...fusedPattern.structuralPattern.dependencyPatterns,
          dependency('missing-activity', 'skill-goal:verify-policy', 'precedes'),
        ],
      },
    };
    const generalizedPattern = {
      ...new PatternGeneralizationService().generalize({
        fusedPattern,
        knownTaskTypeCapabilities: catalog,
      }),
      sourceFusedPatternRef: drifted.fusedPatternId,
    };
    expect(() =>
      new ArtifactCandidateGenerator().generate({
        generalizedPattern,
        fusedPattern: drifted,
        knownCapabilityIds: catalog,
        sourceEpisodeRefs: ['episode-1'],
        sourceCorrectionRefs: [],
        createdAt: '2026-07-28T00:00:00.000Z',
      }),
    ).toThrow(/ACTIVITY_NODE_MISSING/u);
  });

  it('rejects direct or transitive ordering paths between parallel activities', async () => {
    const fusedPattern = await fuse();
    const parallelConflict = {
      ...fusedPattern,
      structuralPattern: {
        ...fusedPattern.structuralPattern,
        dependencyPatterns: [
          ...fusedPattern.structuralPattern.dependencyPatterns,
          dependency('skill-goal:inspect-workflow', 'recovery:apply-policy:resume', 'parallel'),
        ],
      },
    };
    const generalizedPattern = new PatternGeneralizationService().generalize({
      fusedPattern: parallelConflict,
      knownTaskTypeCapabilities: catalog,
    });
    expect(() =>
      new ArtifactCandidateGenerator().generate({
        generalizedPattern,
        fusedPattern: parallelConflict,
        knownCapabilityIds: catalog,
        sourceEpisodeRefs: ['episode-1', 'episode-2', 'episode-3'],
        sourceCorrectionRefs: [],
        tenantId: 'tenant-test',
        createdAt: '2026-07-28T00:00:00.000Z',
      }),
    ).toThrow(/PARALLEL_ORDER_CONFLICT/u);

    const directConflict = {
      ...fusedPattern,
      structuralPattern: {
        ...fusedPattern.structuralPattern,
        dependencyPatterns: [
          ...fusedPattern.structuralPattern.dependencyPatterns,
          dependency('skill-goal:inspect-workflow', 'skill-goal:verify-policy', 'precedes'),
        ],
      },
    };
    const directGeneralized = new PatternGeneralizationService().generalize({
      fusedPattern: directConflict,
      knownTaskTypeCapabilities: catalog,
    });
    expect(() =>
      new ArtifactCandidateGenerator().generate({
        generalizedPattern: directGeneralized,
        fusedPattern: directConflict,
        knownCapabilityIds: catalog,
        sourceEpisodeRefs: ['episode-1', 'episode-2', 'episode-3'],
        sourceCorrectionRefs: [],
        tenantId: 'tenant-test',
        createdAt: '2026-07-28T00:00:00.000Z',
      }),
    ).toThrow(/PARALLEL_DIRECT_CONFLICT/u);
  });

  it('rejects exact Skill, Provider and MCP bindings even when present in the Catalog', async () => {
    for (const forbiddenId of ['skill:fixed', 'provider:fixed', 'mcp:fixed']) {
      const fusedPattern = await fuse();
      const exactBinding = {
        ...fusedPattern,
        structuralPattern: {
          ...fusedPattern.structuralPattern,
          activityPatterns: fusedPattern.structuralPattern.activityPatterns.map((item, index) =>
            index === 0 ? { ...item, capabilityRefs: [forbiddenId] } : item,
          ),
        },
      };
      const extendedCatalog = [...catalog, forbiddenId];
      const generalizedPattern = new PatternGeneralizationService().generalize({
        fusedPattern: exactBinding,
        knownTaskTypeCapabilities: extendedCatalog,
      });
      expect(() =>
        new ArtifactCandidateGenerator().generate({
          generalizedPattern,
          fusedPattern: exactBinding,
          knownCapabilityIds: extendedCatalog,
          sourceEpisodeRefs: ['episode-1', 'episode-2', 'episode-3'],
          sourceCorrectionRefs: [],
          tenantId: 'tenant-test',
          createdAt: '2026-07-28T00:00:00.000Z',
        }),
      ).toThrow(/EXACT_BINDING_FORBIDDEN/u);
    }

    const fusedPattern = await fuse();
    const exactRecoveryBinding = {
      ...fusedPattern,
      structuralPattern: {
        ...fusedPattern.structuralPattern,
        recoveryPatterns: fusedPattern.structuralPattern.recoveryPatterns.map((recovery) => ({
          ...recovery,
          requiredCapabilityRefs: ['provider:fixed-recovery'],
        })),
      },
    };
    const extendedCatalog = [...catalog, 'provider:fixed-recovery'];
    const generalizedPattern = new PatternGeneralizationService().generalize({
      fusedPattern: exactRecoveryBinding,
      knownTaskTypeCapabilities: extendedCatalog,
    });
    expect(() =>
      new ArtifactCandidateGenerator().generate({
        generalizedPattern,
        fusedPattern: exactRecoveryBinding,
        knownCapabilityIds: extendedCatalog,
        sourceEpisodeRefs: ['episode-1', 'episode-2', 'episode-3'],
        sourceCorrectionRefs: [],
        tenantId: 'tenant-test',
        createdAt: '2026-07-28T00:00:00.000Z',
      }),
    ).toThrow(/EXACT_BINDING_FORBIDDEN/u);
  });

  it('compiles a normal conditional WorkflowPattern dependency as optional plus condition', async () => {
    const fusedPattern = await fuse();
    const conditionalActivity = activity(
      'skill-goal:notify-owner',
      'human_gate',
      'Notify the workflow owner when policy verification fails',
      'cap-verify',
      false,
    );
    const withConditional = {
      ...fusedPattern,
      structuralPattern: {
        ...fusedPattern.structuralPattern,
        activityPatterns: [...fusedPattern.structuralPattern.activityPatterns, conditionalActivity],
        dependencyPatterns: [
          ...fusedPattern.structuralPattern.dependencyPatterns,
          dependency('skill-goal:verify-policy', 'skill-goal:notify-owner', 'conditional', {
            type: 'atomic',
            field: 'runtime.policyVerificationFailed',
            operator: 'eq',
            value: true,
          }),
        ],
      },
    };
    const generalizedPattern = new PatternGeneralizationService().generalize({
      fusedPattern: withConditional,
      knownTaskTypeCapabilities: catalog,
    });
    const candidate = new ArtifactCandidateGenerator().generate({
      generalizedPattern,
      fusedPattern: withConditional,
      knownCapabilityIds: catalog,
      sourceEpisodeRefs: ['episode-1', 'episode-2', 'episode-3'],
      sourceCorrectionRefs: [],
      tenantId: 'tenant-test',
      createdAt: '2026-07-28T00:00:00.000Z',
    });
    const definition = candidate.artifact.definition as PlanTemplateArtifactDefinition;
    expect(definition.skillGoalGraph.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          predicate: 'optional',
          condition: {
            type: 'atomic',
            field: 'runtime.policyVerificationFailed',
            operator: 'eq',
            value: true,
          },
        }),
      ]),
    );
  });

  it('isolates a single-user candidate through runtime-evaluable applicability', async () => {
    const source = await fuse({ userCount: 1 });
    const fusedPattern = {
      ...source,
      applicabilityCandidate: {
        ...source.applicabilityCandidate,
        userScope: 'single' as const,
      },
    };
    const generalizedPattern = new PatternGeneralizationService().generalize({
      fusedPattern,
      knownTaskTypeCapabilities: catalog,
    });
    expect(() =>
      new ArtifactCandidateGenerator().generate({
        generalizedPattern,
        fusedPattern,
        knownCapabilityIds: catalog,
        sourceEpisodeRefs: ['episode-1'],
        sourceCorrectionRefs: [],
        sourceUserScopeIds: [],
        tenantId: 'tenant-test',
        createdAt: '2026-07-28T00:00:00.000Z',
      }),
    ).toThrow(/SINGLE_USER_SCOPE_UNRESOLVED/u);
    const candidate = new ArtifactCandidateGenerator().generate({
      generalizedPattern,
      fusedPattern,
      knownCapabilityIds: catalog,
      sourceEpisodeRefs: ['episode-1'],
      sourceCorrectionRefs: [],
      sourceUserScopeIds: ['user-a'],
      tenantId: 'tenant-test',
      createdAt: '2026-07-28T00:00:00.000Z',
    });
    expect(candidate.artifact.applicability.requiredConditions).toContainEqual({
      type: 'atomic',
      field: 'request.userId',
      operator: 'eq',
      value: 'user-a',
    });
    expect(candidate.artifact.artifactKey).toMatch(/:user:/u);
  });

  it('coalesces direct-follows and precedence evidence into one required DAG edge', async () => {
    const fusedPattern = await fuse();
    const withOverlappingOrderingEvidence = {
      ...fusedPattern,
      structuralPattern: {
        ...fusedPattern.structuralPattern,
        dependencyPatterns: [
          ...fusedPattern.structuralPattern.dependencyPatterns,
          dependency(
            'skill-goal:verify-policy',
            'provider-operation:apply-policy',
            'direct_follows',
          ),
        ],
      },
    };
    const generalizedPattern = new PatternGeneralizationService().generalize({
      fusedPattern: withOverlappingOrderingEvidence,
      knownTaskTypeCapabilities: catalog,
    });
    const candidate = new ArtifactCandidateGenerator().generate({
      generalizedPattern,
      fusedPattern: withOverlappingOrderingEvidence,
      knownCapabilityIds: catalog,
      sourceEpisodeRefs: ['episode-1', 'episode-2', 'episode-3'],
      sourceCorrectionRefs: [],
      tenantId: 'tenant-test',
      createdAt: '2026-07-28T00:00:00.000Z',
    });
    const definition = candidate.artifact.definition as PlanTemplateArtifactDefinition;
    const verify = definition.skillGoalGraph.nodes.find((node) =>
      node.constraints.includes('activity-key:skill-goal:verify-policy'),
    );
    const apply = definition.skillGoalGraph.nodes.find((node) =>
      node.constraints.includes('activity-key:provider-operation:apply-policy'),
    );
    expect(
      definition.skillGoalGraph.dependencies.filter(
        (edge) =>
          edge.predecessorNodeKey === verify?.nodeKey && edge.successorNodeKey === apply?.nodeKey,
      ),
    ).toEqual([expect.objectContaining({ predicate: 'required' })]);
  });

  it('computes stable distinct fingerprint inputs and passes all Static Validator V1.2 gates', async () => {
    const { fusedPattern, generalizedPattern, candidate } = await generate();
    expect(candidate.fingerprint).toHaveLength(64);
    expect(candidate.validation).toMatchObject({
      result: 'passed_static',
      schemaValid: true,
      activityIdentityValid: true,
      dagValid: true,
      parallelSemanticsValid: true,
      requiredCriteriaCovered: true,
      capabilityShapeValid: true,
      capabilityCatalogAligned: true,
      parameterPolicyValid: true,
      parameterSchemaAligned: true,
      applicabilityEvaluable: true,
      lineageComplete: true,
      recoverySemanticsValid: true,
      sideEffectReplaySafe: true,
      boundsValid: true,
      validatorVersion: 'sdar-candidate-static-validator/1.2',
    });

    const validator = new CandidateStaticValidator();
    const duplicate = validator.validate({
      artifact: candidate.artifact,
      lineage: candidate.lineage,
      generalizedPattern,
      fusedPattern,
      knownCapabilityIds: catalog,
      fingerprint: candidate.fingerprint,
      existingFingerprints: [candidate.fingerprint],
    });
    expect(duplicate.result).toBe('failed_static');
    expect(duplicate.duplicateFingerprint).toBe(candidate.fingerprint);
  });

  it('fails static validation when Recovery resume or Activity resolution drifts', async () => {
    const { fusedPattern, generalizedPattern, candidate } = await generate();
    const definition = candidate.artifact.definition as PlanTemplateArtifactDefinition;
    const recovery = definition.recoveryBranches[0];
    const failureBoundary = generalizedPattern.failureBoundaries[0];
    if (recovery === undefined || typeof recovery.planPatchTemplate !== 'object') {
      throw new Error('fixture drift');
    }
    if (failureBoundary === undefined) throw new Error('fixture drift');
    const driftedArtifact = {
      ...candidate.artifact,
      definition: {
        ...definition,
        recoveryBranches: [
          {
            ...recovery,
            planPatchTemplate: {
              triggerActivityKey: 'provider-operation:apply-policy',
              activitySequence: ['recovery:missing-activity'],
            },
          },
        ],
      },
    };
    const result = new CandidateStaticValidator().validate({
      artifact: driftedArtifact,
      lineage: candidate.lineage,
      generalizedPattern: {
        ...generalizedPattern,
        failureBoundaries: [
          {
            ...failureBoundary,
            activitySequence: ['recovery:missing-activity'],
          },
        ],
      },
      fusedPattern,
      knownCapabilityIds: catalog,
      fingerprint: candidate.fingerprint,
    });
    expect(result.result).toBe('failed_static');
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'RECOVERY_ACTIVITY_NODE_MISSING' }),
        expect.objectContaining({ code: 'RECOVERY_BOUNDARY_LOST' }),
      ]),
    );
  });

  it('retains formal Episode, Trace, Pattern and Correction lineage', async () => {
    const { candidate } = await generate();
    expect(candidate.lineage.sourceEpisodeRefs).toEqual(['episode-1', 'episode-2', 'episode-3']);
    expect(candidate.lineage.sourceCorrectionRefs).toEqual(['correction-1']);
    expect(candidate.lineage.sourcePatternRefs).toEqual(
      expect.arrayContaining([
        workflowPattern.workflowPatternId,
        workflowPattern.sourcePatternRef,
        ...workflowPattern.sourceTraceRefs,
      ]),
    );
  });
});

describe('CandidateGenerationApplicationService durable orchestration', () => {
  it('claims authoritative source data and completes only after static validation', async () => {
    let completion: CandidateGenerationCompletion | undefined;
    const repository = candidateRunRepository({
      completeAtomically: (_run, _workerId, _leaseToken, value) => {
        completion = value;
        return Promise.resolve(true);
      },
    });
    const service = new CandidateGenerationApplicationService({
      runs: repository,
      catalog: {
        listKnownCapabilityIds: () => Promise.resolve(catalog),
        listTaskTypeCapabilityIds: () => Promise.resolve(catalog),
      },
      fusion: new PatternFusionService(),
      generalization: new PatternGeneralizationService(),
      generator: new ArtifactCandidateGenerator(),
      clock: { now: () => '2026-07-28T00:00:00.000Z' },
      retryPolicy: { maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 10_000 },
    });

    await service.process(candidateRun(), 'candidate-worker');

    expect(completion?.candidate.validation.result).toBe('passed_static');
    expect(completion?.candidate.artifact.status).toBe('candidate');
    expect(completion?.candidate.lineage.sourceEpisodeRefs).toHaveLength(3);
  });

  it('records a fenced retry instead of completing when Task Type capabilities drift', async () => {
    let failed: Readonly<{ errorCode: string; retryAt: string | undefined }> | undefined;
    const repository = candidateRunRepository({
      fail: (_runId, _workerId, _leaseToken, errorCode, _summary, _now, retryAt) => {
        failed = { errorCode, retryAt };
        return Promise.resolve(true);
      },
    });
    const service = new CandidateGenerationApplicationService({
      runs: repository,
      catalog: {
        listKnownCapabilityIds: () => Promise.resolve(catalog),
        listTaskTypeCapabilityIds: () => Promise.resolve(['cap-observe']),
      },
      fusion: new PatternFusionService(),
      generalization: new PatternGeneralizationService(),
      generator: new ArtifactCandidateGenerator(),
      clock: { now: () => '2026-07-28T00:00:00.000Z' },
      retryPolicy: { maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 10_000 },
    });

    await service.process(candidateRun(), 'candidate-worker');

    expect(failed?.errorCode).toMatch(/GENERALIZATION_CAPABILITY_CATALOG_MISMATCH/u);
    expect(failed?.retryAt).toBe('2026-07-28T00:00:01.000Z');
  });
});

function candidateRun(): CandidateGenerationRun {
  return {
    runId: 'candidate-run-1',
    tenantId: 'tenant-test',
    sourcePatternRef: discoveredPattern.patternId,
    sourceEventId: 'event-pattern-1',
    status: 'leased',
    attempt: 1,
    maxAttempts: 3,
    availableAt: '2026-07-28T00:00:00.000Z',
    leaseOwner: 'candidate-worker',
    leaseToken: 'lease-1',
    leaseExpiresAt: '2026-07-28T00:02:00.000Z',
    idempotencyKey: 'candidate-generation:tenant-test:process-pattern-p04r',
    payload: {},
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
  };
}

function candidateRunRepository(
  overrides: Partial<CandidateGenerationRunRepository>,
): CandidateGenerationRunRepository {
  return {
    createRun: () => Promise.resolve(candidateRun()),
    claim: () => Promise.resolve([candidateRun()]),
    loadSource: () =>
      Promise.resolve({
        tenantId: 'tenant-test',
        domain: 'workflow-operations',
        workflowPattern,
        discoveredPattern,
        environmentClasses: ['server', 'edge'],
        deviceClasses: ['device-a', 'device-b'],
        userScope: 'multi',
        sourceUserScopeIds: ['user-a', 'user-b'],
        scopeEvidence,
        sourceEpisodeRefs: ['episode-1', 'episode-2', 'episode-3'],
        sourceCorrectionRefs: ['correction-1'],
      }),
    findExistingFingerprints: () => Promise.resolve([]),
    completeAtomically: () => Promise.resolve(true),
    fail: () => Promise.resolve(true),
    listRequeueable: () => Promise.resolve([]),
    ...overrides,
  };
}

function activity(
  activityKey: string,
  activityKind: WorkflowPattern['activityPatterns'][number]['activityKind'],
  objectiveSummary: string,
  capabilityId: string,
  required: boolean,
): WorkflowPattern['activityPatterns'][number] {
  return {
    activityKey,
    activityKind,
    objectiveSummary,
    required,
    supportCount: required ? 3 : 1,
    supportRate: required ? 1 : 1 / 3,
    capabilityRefs: [capabilityId],
    effectRefs: [`effect:${activityKey}`],
    lifecycleEventTypes: ['skill_attempt_started', 'skill_attempt_completed'],
  };
}

function dependency(
  predecessorActivityKey: string,
  successorActivityKey: string,
  relation: WorkflowPattern['dependencyPatterns'][number]['relation'],
  condition?: WorkflowPattern['dependencyPatterns'][number]['condition'],
): WorkflowPattern['dependencyPatterns'][number] {
  return {
    predecessorActivityKey,
    successorActivityKey,
    relation,
    ...(condition === undefined ? {} : { condition }),
    supportRefs: ['trace-1'],
    contradictionRefs: [],
  };
}
