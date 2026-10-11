import type { Pool } from 'pg';
import {
  EnvironmentEvidenceCredentialResolver,
  HttpEvidenceExportTransport,
} from '../../../../packages/evidence-export-adapter/src/index.js';
import { AjvJsonSchemaValidator } from '../../../../packages/json-schema-adapter/src/index.js';
import {
  CanonicalEvidenceProjectionPipeline,
  CatalogValidatingEvidenceWriter,
  ControlEnrichedMcpCapabilityEvidenceSource,
  EpisodeEvidenceCoverageProjectionPipeline,
  EpisodeEvidenceCoverageService,
  EvidenceInfrastructureProjectionPipeline,
  EvidenceInfrastructureProjector,
  EvidenceOperationsService,
  EvidenceQualityEvaluator,
  ExperienceReplayArtifactEvidenceProjector,
  McpCapabilityEvidenceProjector,
  RuntimeCoreEvidenceProjector,
  RuntimeEvidenceExportService,
  SkillEvidenceProjector,
} from '../../../../packages/runtime-control-application/src/index.js';
import {
  PostgresEvidenceInfrastructureSource,
  PostgresEvidenceOperationsRepository,
  PostgresEvidenceQualityAuthoritySource,
  PostgresEvidenceStore,
  PostgresExperienceReplayArtifactEvidenceSource,
  PostgresMcpCapabilityEvidenceSource,
  PostgresRuntimeCoreEvidenceSource,
  PostgresRuntimeEvidenceExportStore,
  PostgresSkillEvidenceSource,
} from '../../../../packages/runtime-control-persistence-postgres/src/index.js';
import type { ServerRuntimeOptions } from './contracts.js';
import type { RuntimeCleanupScope } from './runtime-cleanup-scope.js';
export interface composeEvidenceDependencies {
  readonly cleanupScope: RuntimeCleanupScope;
  options: ServerRuntimeOptions;
  readonly pool: Pool;
  readonly clock: { now: () => string };
  readonly deviceWorkScope:
    { allowedDeviceIds: string[]; sdarServiceKey: string; includeNonDevice: boolean } | undefined;
}
export function composeEvidence(dependencies: composeEvidenceDependencies) {
  const { options, pool, clock, deviceWorkScope } = dependencies;
  const evidenceExport = new RuntimeEvidenceExportService({
    store: new PostgresRuntimeEvidenceExportStore(pool),
    transport: new HttpEvidenceExportTransport(
      new EnvironmentEvidenceCredentialResolver(),
      5000,
      options.outboundEndpointPolicy?.unsafeTestOpen === true,
    ),
    clock,
    actorId: 'sdar-runtime',
  });
  const evidenceStore = new PostgresEvidenceStore(pool, deviceWorkScope);
  const catalogValidatingEvidenceWriter = new CatalogValidatingEvidenceWriter({
    delegate: evidenceStore,
    validator: new AjvJsonSchemaValidator({ strict: false }),
    ...(options.evidenceObservationScope === undefined
      ? {}
      : { observationScope: options.evidenceObservationScope }),
  });
  const evidenceProjectorWriter = Object.assign(catalogValidatingEvidenceWriter, {
    hasRecord: evidenceStore.hasRecord.bind(evidenceStore),
    recordQualityIssue: evidenceStore.recordQualityIssue.bind(evidenceStore),
    resolveQualityIssues: evidenceStore.resolveQualityIssues.bind(evidenceStore),
    resolveSourceQualityIssues: evidenceStore.resolveSourceQualityIssues.bind(evidenceStore),
    saveCheckpoint: evidenceStore.saveCheckpoint.bind(evidenceStore),
  });
  const runtimeCoreEvidenceSource = new PostgresRuntimeCoreEvidenceSource(pool, deviceWorkScope);
  const runtimeCoreEvidenceProjector = new RuntimeCoreEvidenceProjector({
    source: runtimeCoreEvidenceSource,
    writer: evidenceProjectorWriter,
    environment: options.evidenceEnvironment ?? 'runtime',
    clock,
  });
  const skillEvidenceSource = new PostgresSkillEvidenceSource(pool, deviceWorkScope);
  const skillEvidenceProjector = new SkillEvidenceProjector({
    source: skillEvidenceSource,
    writer: evidenceProjectorWriter,
    environment: options.evidenceEnvironment ?? 'runtime',
    clock,
  });
  const runtimeMcpCapabilityEvidenceSource = new PostgresMcpCapabilityEvidenceSource(
    pool,
    deviceWorkScope,
  );
  const mcpCapabilityEvidenceSource =
    options.capabilityAuthorityReader === undefined
      ? runtimeMcpCapabilityEvidenceSource
      : new ControlEnrichedMcpCapabilityEvidenceSource({
          runtime: runtimeMcpCapabilityEvidenceSource,
          authority: options.capabilityAuthorityReader,
        });
  const mcpCapabilityEvidenceProjector = new McpCapabilityEvidenceProjector({
    source: mcpCapabilityEvidenceSource,
    writer: evidenceProjectorWriter,
    environment: options.evidenceEnvironment ?? 'runtime',
    clock,
  });
  const experienceReplayArtifactEvidenceSource = new PostgresExperienceReplayArtifactEvidenceSource(
    pool,
    deviceWorkScope,
  );
  const experienceReplayArtifactEvidenceProjector = new ExperienceReplayArtifactEvidenceProjector({
    source: experienceReplayArtifactEvidenceSource,
    writer: evidenceProjectorWriter,
    environment: options.evidenceEnvironment ?? 'runtime',
    clock,
  });
  const canonicalEvidenceProjectionPipeline = new CanonicalEvidenceProjectionPipeline({
    writer: evidenceStore,
    runtimeCore: {
      source: runtimeCoreEvidenceSource,
      projector: runtimeCoreEvidenceProjector,
    },
    skill: { source: skillEvidenceSource, projector: skillEvidenceProjector },
    mcpCapability: {
      source: mcpCapabilityEvidenceSource,
      projector: mcpCapabilityEvidenceProjector,
    },
    experienceReplayArtifact: {
      source: experienceReplayArtifactEvidenceSource,
      projector: experienceReplayArtifactEvidenceProjector,
    },
    clock,
  });
  const evidenceQualityEvaluator = new EvidenceQualityEvaluator({
    source: new PostgresEvidenceQualityAuthoritySource(pool, deviceWorkScope),
    writer: evidenceStore,
    clock,
  });
  const episodeEvidenceCoverageService = new EpisodeEvidenceCoverageService({
    repository: evidenceStore,
    clock,
  });
  const evidenceOperations = new EvidenceOperationsService({
    repository: new PostgresEvidenceOperationsRepository(pool, deviceWorkScope),
    coverageRecovery: {
      async reconcileEpisode(target) {
        await episodeEvidenceCoverageService.reconcile({
          episodeId: target.episodeId,
          taskId: target.taskId,
          terminalOutcomeId: target.terminalOutcomeId,
          sealRequested: target.sealRequested,
        });
      },
    },
    clock,
  });
  const episodeEvidenceCoverageProjectionPipeline = new EpisodeEvidenceCoverageProjectionPipeline({
    writer: evidenceStore,
    source: evidenceStore,
    reconciler: episodeEvidenceCoverageService,
    clock,
  });
  const evidenceInfrastructureSource = new PostgresEvidenceInfrastructureSource(
    pool,
    deviceWorkScope,
  );
  const evidenceInfrastructureProjector = new EvidenceInfrastructureProjector({
    source: evidenceInfrastructureSource,
    writer: evidenceProjectorWriter,
    environment: options.evidenceEnvironment ?? 'runtime',
    clock,
  });
  const evidenceInfrastructureProjectionPipeline = new EvidenceInfrastructureProjectionPipeline({
    writer: evidenceStore,
    source: evidenceInfrastructureSource,
    projector: evidenceInfrastructureProjector,
    clock,
  });
  return {
    evidenceExport,
    evidenceOperations,
    canonicalEvidenceProjectionPipeline,
    evidenceQualityEvaluator,
    episodeEvidenceCoverageProjectionPipeline,
    evidenceInfrastructureProjectionPipeline,
  };
}
