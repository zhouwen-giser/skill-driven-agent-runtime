import { describe, it, expect } from 'vitest';

import {
  ArtifactCandidateGenerator,
  CandidateStaticValidator,
} from '../src/compiler/candidate-generator.js';
import {
  NoOpSemanticModel,
  PatternFusionService,
  PatternGeneralizationService,
} from '../src/compiler/pattern-generalization.js';
import type { DiscoveredProcessPattern, WorkflowPattern } from '../../domain/src/index.js';

const quality = {
  support: 0.9,
  successRate: 0.85,
  traceCoverage: 0.8,
  fitness: 0.75,
  precisionProxy: 0.7,
  environmentCoverage: 0.6,
  contradictionRate: 0.05,
  generalization: 0.5,
  mandatoryThreshold: 0.8,
};

const workflowPattern: WorkflowPattern = {
  workflowPatternId: 'wp-test-001',
  taskTypeId: 'task-type-sdar-unit-test',
  activityPatterns: [
    { activity: 'observe_input', required: true, supportRate: 0.95, capabilityRefs: [] },
    { activity: 'verify_constraint', required: true, supportRate: 0.9, capabilityRefs: [] },
    { activity: 'execute_action', required: true, supportRate: 0.88, capabilityRefs: [] },
    { activity: 'recover_failure', required: false, supportRate: 0.3, capabilityRefs: [] },
  ],
  dependencyPatterns: [
    {
      predecessorActivity: 'observe_input',
      successorActivity: 'verify_constraint',
      relation: 'direct_follows',
      supportRefs: ['trace-1', 'trace-2'],
      contradictionRefs: [],
    },
    {
      predecessorActivity: 'verify_constraint',
      successorActivity: 'execute_action',
      relation: 'precedes',
      supportRefs: ['trace-1'],
      contradictionRefs: [],
    },
  ],
  recoveryPatterns: [
    {
      triggerActivity: 'execute_action',
      resumeActivity: 'verify_constraint',
      activitySequence: ['recover_failure', 'verify_constraint'],
      supportRefs: ['trace-3'],
    },
  ],
  sourcePatternRef: 'dp-test-001',
  sourceTraceRefs: ['trace-1', 'trace-2', 'trace-3'],
  quality,
};

const discoveredPattern: DiscoveredProcessPattern = {
  patternId: 'dp-test-001',
  cohortFingerprint: 'cohort-test',
  algorithmVersion: 'sdar-deterministic-process-miner/1.1',
  mandatoryActivities: ['observe_input', 'verify_constraint', 'execute_action'],
  optionalActivities: ['recover_failure'],
  orderingConstraints: [],
  parallelCandidates: [],
  recoveryBranches: [],
  failureVariants: [],
  supportRefs: ['trace-1', 'trace-2'],
  contradictionRefs: ['trace-fail-1'],
  environmentCoverage: ['env-staging'],
  quality,
};

describe('P04 Pattern Generalization and Plan Template Candidate Compiler', () => {
  const fusionService = new PatternFusionService();
  const generalizationService = new PatternGeneralizationService();
  const generator = new ArtifactCandidateGenerator();

  async function generateCandidate() {
    const fusedPattern = await fusionService.fuse({
      workflowPattern,
      discoveredPattern,
      domain: 'sdar-test-domain',
      tenantId: 'tenant-test',
      environmentClasses: ['env-staging'],
      deviceClasses: ['device-class-a'],
      tenantScope: 'single',
      userScope: 'single',
      model: new NoOpSemanticModel(),
    });

    const generalizedPattern = generalizationService.generalize({
      fusedPattern,
      knownTaskTypeCapabilities: ['cap-observe', 'cap-verify', 'cap-execute'],
    });

    const candidate = generator.generate({
      generalizedPattern,
      fusedPattern,
      knownCapabilityIds: ['cap-observe', 'cap-verify', 'cap-execute'],
      tenantId: 'tenant-test',
      createdAt: '2026-07-28T00:00:00Z',
    });

    return { fusedPattern, generalizedPattern, candidate };
  }

  it('fuses structural facts from P03 without LLM overwriting them', async () => {
    const { fusedPattern } = await generateCandidate();
    expect(fusedPattern.fusionVersion).toBe('sdar-pattern-fusion/1.1');
    expect(fusedPattern.structuralPattern.taskTypeId).toBe('task-type-sdar-unit-test');
    expect(fusedPattern.structuralPattern.activityPatterns).toHaveLength(4);
    expect(fusedPattern.sourceWorkflowPatternRef).toBe('wp-test-001');
    expect(fusedPattern.sourceProcessPatternRef).toBe('dp-test-001');
    expect(fusedPattern.contradictionRefs).toContain('trace-fail-1');
    expect(fusedPattern.semanticCandidate.explanation).toContain('no-op');
  });

  it('generalizes instance fields into variables and invariants', async () => {
    const { generalizedPattern } = await generateCandidate();
    expect(generalizedPattern.generalizerVersion).toBe('sdar-pattern-generalizer/1.1');
    expect(generalizedPattern.variables.length).toBeGreaterThan(0);
    expect(generalizedPattern.invariants.length).toBeGreaterThan(0);
    expect(generalizedPattern.requiredConditions.length).toBeGreaterThan(0);
    expect(generalizedPattern.counterexampleRefs).toContain('trace-fail-1');
    expect(generalizedPattern.retainedExampleRefs).toContain('trace-1');
  });

  it('produces a candidate artifact with status=candidate and type=plan_template', async () => {
    const { candidate } = await generateCandidate();
    expect(candidate.artifact.status).toBe('candidate');
    expect(candidate.artifact.artifactType).toBe('plan_template');
    expect(candidate.artifact.riskLevel).toBe('medium');
  });

  it('builds complete lineage referencing P03 outputs', async () => {
    const { fusedPattern, candidate } = await generateCandidate();
    expect(candidate.lineage.sourcePatternRefs).toContain('wp-test-001');
    expect(candidate.lineage.sourcePatternRefs).toContain('dp-test-001');
    expect(candidate.lineage.sourcePatternRefs).toContain(fusedPattern.fusedPatternId);
    expect(candidate.lineage.generationMethods).toContain('process_mining');
    expect(candidate.lineage.generationMethods).toContain('model_assisted_generalization');
  });

  it('computes a stable fingerprint', async () => {
    const { candidate } = await generateCandidate();
    expect(candidate.fingerprint).toHaveLength(64);
    const { candidate: candidate2 } = await generateCandidate();
    expect(candidate2.fingerprint).toBe(candidate.fingerprint);
  });

  it('passes static validation for a well-formed candidate', async () => {
    const { candidate } = await generateCandidate();
    expect(candidate.validation.result).toBe('passed_static');
    expect(candidate.validation.schemaValid).toBe(true);
    expect(candidate.validation.dagValid).toBe(true);
    expect(candidate.validation.requiredCriteriaCovered).toBe(true);
    expect(candidate.validation.capabilityShapeValid).toBe(true);
    expect(candidate.validation.parameterPolicyValid).toBe(true);
    expect(candidate.validation.sideEffectReplaySafe).toBe(true);
    expect(candidate.validation.boundsValid).toBe(true);
    expect(candidate.validation.duplicateFingerprint).toBeUndefined();
  });

  it('detects duplicate fingerprints', async () => {
    const { candidate } = await generateCandidate();
    const validator = new CandidateStaticValidator();
    const result = validator.validate({
      artifact: candidate.artifact,
      fingerprint: candidate.fingerprint,
      existingFingerprints: [candidate.fingerprint],
    });
    expect(result.result).toBe('failed_static');
    expect(result.duplicateFingerprint).toBe(candidate.fingerprint);
  });

  it('classifies steps into correct node types', async () => {
    const { candidate } = await generateCandidate();
    const def = candidate.artifact.definition as unknown as {
      skillGoalGraph: { nodes: { nodeType: string; objectiveTemplate: string }[] };
    };
    const nodeTypes = def.skillGoalGraph.nodes.map((n) => n.nodeType);
    expect(nodeTypes).toContain('observation');
    expect(nodeTypes).toContain('verification');
    expect(nodeTypes).toContain('action');
    expect(nodeTypes).toContain('recovery');
  });

  it('produces a DAG with no cycles and valid dependencies', async () => {
    const { candidate } = await generateCandidate();
    const def = candidate.artifact.definition as unknown as {
      skillGoalGraph: {
        nodes: { nodeKey: string }[];
        dependencies: { predecessorNodeKey: string; successorNodeKey: string }[];
      };
    };
    const nodeKeys = new Set(def.skillGoalGraph.nodes.map((n) => n.nodeKey));
    for (const dep of def.skillGoalGraph.dependencies) {
      expect(nodeKeys.has(dep.predecessorNodeKey)).toBe(true);
      expect(nodeKeys.has(dep.successorNodeKey)).toBe(true);
    }
  });

  it('sets recovery branch sideEffectReplayPolicy to forbidden', async () => {
    const { candidate } = await generateCandidate();
    const def = candidate.artifact.definition as unknown as {
      recoveryBranches: { sideEffectReplayPolicy: string }[];
    };
    expect(def.recoveryBranches.length).toBeGreaterThan(0);
    for (const branch of def.recoveryBranches) {
      expect(branch.sideEffectReplayPolicy).toBe('forbidden');
    }
  });

  it('binds capabilities not exact Skill IDs', async () => {
    const { candidate } = await generateCandidate();
    const def = candidate.artifact.definition as unknown as {
      skillGoalGraph: { nodes: { requiredCapabilities: readonly string[] }[] };
    };
    for (const node of def.skillGoalGraph.nodes) {
      for (const cap of node.requiredCapabilities) {
        expect(cap.startsWith('skill:')).toBe(false);
      }
    }
  });

  it('produces a completion contract template with criteria', async () => {
    const { candidate } = await generateCandidate();
    const def = candidate.artifact.definition as unknown as {
      completionContractTemplate: { criteria: unknown[]; evidenceRequirements: unknown[] };
    };
    expect(def.completionContractTemplate.criteria.length).toBeGreaterThan(0);
    expect(def.completionContractTemplate.evidenceRequirements.length).toBeGreaterThan(0);
  });
});
