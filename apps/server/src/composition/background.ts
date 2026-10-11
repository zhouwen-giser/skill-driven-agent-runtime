import type { Pool } from 'pg';
import type {
  ArtifactOutboxConsumer,
  ArtifactRevalidationApplicationService,
  ArtifactShadowApplicationService,
  CandidateGenerationRunReconciler,
  CandidateGenerationTriggerDispatcher,
  CompilationRunReconciler,
  ExperienceCompilationTriggerDispatcher,
  ExperienceJobReconciler,
  ExperienceOutboxDispatcher,
  FrozenMcpRegistryService,
  KnowledgePromotionService,
  ObservationJobReconciler,
  PlanPreparationProcessor,
  ReflectionJobReconciler,
  RemoteTaskAdmissionRecoveryService,
  RemoteTaskCancellationReconciler,
  RemoteTaskCancellationWorker,
  RemoteTaskContinuationReconciler,
  RemoteTaskContinuationService,
  RemoteTaskPollingService,
  RemoteTaskReconciler,
  ReplayValidationRunReconciler,
  ReplayValidationTriggerDispatcher,
  TaskAttemptDispatchService,
  TaskBusinessCommandService,
  TaskBusinessSyncService,
  TaskService,
  TaskWaitTimeoutService,
} from '../../../../packages/application/src/index.js';
import { CognitiveRuntimeReconciler } from '../../../../packages/application/src/index.js';
import type {
  PostgresArtifactShadowGovernanceRepository,
  PostgresMcpRegistryRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import type {
  CanonicalEvidenceProjectionPipeline,
  EpisodeEvidenceCoverageProjectionPipeline,
  EvidenceInfrastructureProjectionPipeline,
  EvidenceOperationsService,
  EvidenceQualityEvaluator,
  RuntimeEvidenceExportService,
} from '../../../../packages/runtime-control-application/src/index.js';
import {
  EvidenceBackgroundFairnessGate,
  EvidenceProjectionIssuePersistenceError,
  ForegroundActivityTracker,
  runEvidenceBackgroundSlices,
} from '../../../../packages/runtime-control-application/src/index.js';
import type {
  BullMqArtifactRevalidationQueue,
  BullMqArtifactRevalidationWorker,
  BullMqArtifactShadowQueue,
  BullMqArtifactShadowWorker,
  BullMqCandidateGenerationQueue,
  BullMqCandidateGenerationWorker,
  BullMqCompilationQueue,
  BullMqCompilationWorker,
  BullMqExperienceWorker,
  BullMqObservationWorker,
  BullMqReflectionWorker,
  BullMqReplayValidationQueue,
  BullMqReplayValidationWorker,
  ContextSerialExecutor,
} from '../../../../packages/runtime-redis/src/index.js';
import {
  BullMqContextWorker,
  BullMqRemoteTaskCancellationWorker,
  BullMqRemoteTaskContinuationWorker,
  BullMqRemoteTaskPollWorker,
} from '../../../../packages/runtime-redis/src/index.js';
import { evidenceRetentionIdentity } from '.././evidence-retention-identity.js';
import { reconcileRegisteredProviderBindings } from '.././provider-binding-reconciler.js';
import type { ServerRuntimeOptions } from './contracts.js';
import type { RuntimeCleanupScope } from './runtime-cleanup-scope.js';
import { runtimeErrorCode } from './runtime-support.js';
import type { RuntimeValueRef } from './runtime-value-ref.js';
export interface composeBackgroundDependencies {
  readonly cleanupScope: RuntimeCleanupScope;
  options: ServerRuntimeOptions;
  readonly taskWaitTimeouts: TaskWaitTimeoutService;
  readonly service: RuntimeValueRef<TaskService>;
  readonly taskAttemptDispatch: TaskAttemptDispatchService;
  readonly refreshCapabilityCatalog: () => Promise<void>;
  readonly mcpRepository: PostgresMcpRegistryRepository;
  readonly frozenMcpRegistry: FrozenMcpRegistryService;
  readonly experienceOutboxDispatcher: ExperienceOutboxDispatcher;
  readonly experienceReconciler: ExperienceJobReconciler;
  readonly clock: { now: () => string };
  readonly observationReconciler: ObservationJobReconciler;
  readonly reflectionReconciler: ReflectionJobReconciler;
  readonly experienceCompilation:
    | {
        replayValidationDispatcher?: ReplayValidationTriggerDispatcher;
        replayValidationReconciler?: ReplayValidationRunReconciler;
        replayValidationQueue?: BullMqReplayValidationQueue;
        replayValidationRetention?: (retentionNow: string, limit?: number) => Promise<number>;
        replayValidationWorker?: BullMqReplayValidationWorker;
        candidateDispatcher?: CandidateGenerationTriggerDispatcher;
        candidateReconciler?: CandidateGenerationRunReconciler;
        candidateQueue?: BullMqCandidateGenerationQueue;
        candidateWorker?: BullMqCandidateGenerationWorker;
        dispatcher: ExperienceCompilationTriggerDispatcher;
        normalizationReconciler: CompilationRunReconciler;
        miningReconciler: CompilationRunReconciler;
        normalizationQueue: BullMqCompilationQueue;
        miningQueue: BullMqCompilationQueue;
        normalizationWorker: BullMqCompilationWorker;
        miningWorker: BullMqCompilationWorker;
      }
    | undefined;
  readonly artifactShadowRuntime:
    | {
        revalidationWorker?: BullMqArtifactRevalidationWorker;
        repository: PostgresArtifactShadowGovernanceRepository;
        service: ArtifactShadowApplicationService;
        queue: BullMqArtifactShadowQueue;
        revalidationQueue: BullMqArtifactRevalidationQueue;
        revalidation: ArtifactRevalidationApplicationService | undefined;
        worker: BullMqArtifactShadowWorker;
      }
    | undefined;
  readonly requeueArtifactRevalidations: (limit?: number) => Promise<number>;
  readonly artifactOutboxConsumer: RuntimeValueRef<ArtifactOutboxConsumer | undefined>;
  readonly pool: Pool;
  readonly evidenceExport: RuntimeEvidenceExportService;
  readonly evidenceOperations: EvidenceOperationsService;
  readonly deviceWorkScope:
    { allowedDeviceIds: string[]; sdarServiceKey: string; includeNonDevice: boolean } | undefined;
  readonly canonicalEvidenceProjectionPipeline: CanonicalEvidenceProjectionPipeline;
  readonly evidenceQualityEvaluator: EvidenceQualityEvaluator;
  readonly episodeEvidenceCoverageProjectionPipeline: EpisodeEvidenceCoverageProjectionPipeline;
  readonly evidenceInfrastructureProjectionPipeline: EvidenceInfrastructureProjectionPipeline;
  readonly queueName: string;
  readonly processor: RuntimeValueRef<PlanPreparationProcessor>;
  readonly contextSerial: ContextSerialExecutor;
  readonly remoteTaskPolling: RemoteTaskPollingService | undefined;
  readonly remoteTaskContinuation: RemoteTaskContinuationService | undefined;
  readonly remoteTaskContinuationQueueName: string | undefined;
  readonly remoteTaskCancellationProcessor: RemoteTaskCancellationWorker | undefined;
  readonly remoteTaskCancellationQueueName: string | undefined;
  readonly taskBusinessSync: TaskBusinessSyncService | undefined;
  readonly taskBusinessCommands: TaskBusinessCommandService | undefined;
  readonly remoteTaskReconciler: RemoteTaskReconciler | undefined;
  readonly remoteTaskAdmissionRecovery: RemoteTaskAdmissionRecoveryService | undefined;
  readonly remoteTaskContinuationReconciler: RemoteTaskContinuationReconciler | undefined;
  readonly remoteTaskCancellationReconciler: RemoteTaskCancellationReconciler | undefined;
  readonly knowledgePromotion: KnowledgePromotionService;
  readonly experienceWorker: BullMqExperienceWorker;
  readonly observationWorker: BullMqObservationWorker;
  readonly reflectionWorker: BullMqReflectionWorker;
  readonly businessRefreshCompletion: RuntimeValueRef<Promise<void> | undefined>;
  readonly evidenceExportInFlight: RuntimeValueRef<Promise<void> | undefined>;
  readonly evidenceOperationsMaintenanceInFlight: RuntimeValueRef<Promise<void> | undefined>;
  readonly runtimeCoreEvidenceProjection: RuntimeValueRef<Promise<void> | undefined>;
  readonly providerBindingReconciliationInFlight: RuntimeValueRef<Promise<void> | undefined>;
}
export async function composeBackground(dependencies: composeBackgroundDependencies) {
  dependencies.businessRefreshCompletion.value = undefined;
  dependencies.evidenceExportInFlight.value = undefined;
  dependencies.evidenceOperationsMaintenanceInFlight.value = undefined;
  dependencies.runtimeCoreEvidenceProjection.value = undefined;
  dependencies.providerBindingReconciliationInFlight.value = undefined;
  const {
    cleanupScope,
    options,
    taskWaitTimeouts,
    taskAttemptDispatch,
    refreshCapabilityCatalog,
    mcpRepository,
    frozenMcpRegistry,
    experienceOutboxDispatcher,
    experienceReconciler,
    clock,
    observationReconciler,
    reflectionReconciler,
    experienceCompilation,
    artifactShadowRuntime,
    requeueArtifactRevalidations,
    pool,
    evidenceExport,
    evidenceOperations,
    deviceWorkScope,
    canonicalEvidenceProjectionPipeline,
    evidenceQualityEvaluator,
    episodeEvidenceCoverageProjectionPipeline,
    evidenceInfrastructureProjectionPipeline,
    queueName,
    contextSerial,
    remoteTaskPolling,
    remoteTaskContinuation,
    remoteTaskContinuationQueueName,
    remoteTaskCancellationProcessor,
    remoteTaskCancellationQueueName,
    taskBusinessSync,
    taskBusinessCommands,
    remoteTaskReconciler,
    remoteTaskAdmissionRecovery,
    remoteTaskContinuationReconciler,
    remoteTaskCancellationReconciler,
    knowledgePromotion,
    experienceWorker,
    observationWorker,
    reflectionWorker,
  } = dependencies;
  const waitSweepTimer = setInterval(() => {
    void (async () => {
      const expired = await taskWaitTimeouts.sweep();
      const releases = await Promise.allSettled(
        expired.map((task) => dependencies.service.value.releaseTimedOutWait(task.taskId)),
      );
      const failures: unknown[] = [];
      for (const release of releases)
        if (release.status === 'rejected') failures.push(release.reason as unknown);
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          'One or more expired Task checkpoints were not released.',
        );
    })().catch((error: unknown) => {
      process.stderr.write(
        `${JSON.stringify({ event: 'task_wait_sweep.failed', error: error instanceof Error ? error.message : String(error) })}\n`,
      );
    });
  }, options.taskWaitSweepIntervalMs ?? 1000);
  cleanupScope.registerSync(() => {
    clearInterval(waitSweepTimer);
  });

  waitSweepTimer.unref();
  let attemptDispatchRunning = false;
  const attemptDispatchTimer = setInterval(() => {
    if (attemptDispatchRunning) return;
    attemptDispatchRunning = true;
    void taskAttemptDispatch
      .dispatchQueued()
      .catch((error: unknown) => {
        process.stderr.write(
          `${JSON.stringify({ event: 'task_attempt_dispatch.failed', error: error instanceof Error ? error.message : String(error) })}\n`,
        );
      })
      .finally(() => {
        attemptDispatchRunning = false;
      });
  }, options.taskAttemptDispatchIntervalMs ?? 1000);
  cleanupScope.registerSync(() => {
    clearInterval(attemptDispatchTimer);
  });

  attemptDispatchTimer.unref();
  let capabilityCatalogRefreshRunning = false;
  const capabilityCatalogRefreshTimer = setInterval(() => {
    if (capabilityCatalogRefreshRunning) return;
    capabilityCatalogRefreshRunning = true;
    void refreshCapabilityCatalog()
      .catch((error: unknown) => {
        process.stderr.write(
          `${JSON.stringify({ event: 'capability_catalog_refresh.failed', errorCode: runtimeErrorCode(error), summary: error instanceof Error ? error.message : String(error) })}\n`,
        );
      })
      .finally(() => {
        capabilityCatalogRefreshRunning = false;
      });
  }, 250);
  cleanupScope.registerSync(() => {
    clearInterval(capabilityCatalogRefreshTimer);
  });

  capabilityCatalogRefreshTimer.unref();
  const reconcileProviderBindings = () => {
    const authority = options.currentMcpProviderBindingAuthorityReader;
    if (
      authority === undefined ||
      dependencies.providerBindingReconciliationInFlight.value !== undefined
    )
      return;
    dependencies.providerBindingReconciliationInFlight.value = reconcileRegisteredProviderBindings({
      servers: mcpRepository,
      authority,
      synchronize: (current) => frozenMcpRegistry.reconcileProviderBinding(current),
      onFailure(serverId, error) {
        process.stderr.write(
          `${JSON.stringify({ event: 'provider_binding_reconciliation.failed', serverId, errorCode: runtimeErrorCode(error) })}\n`,
        );
      },
    })
      .then(() => undefined)
      .catch((error: unknown) => {
        process.stderr.write(
          `${JSON.stringify({ event: 'provider_binding_reconciliation.failed', errorCode: runtimeErrorCode(error) })}\n`,
        );
      })
      .finally(() => {
        dependencies.providerBindingReconciliationInFlight.value = undefined;
      });
  };
  const providerBindingReconciliationTimer =
    options.currentMcpProviderBindingAuthorityReader === undefined
      ? undefined
      : setInterval(reconcileProviderBindings, 30000);
  cleanupScope.registerSync(() => {
    clearInterval(providerBindingReconciliationTimer);
  });

  providerBindingReconciliationTimer?.unref();
  reconcileProviderBindings();
  let experienceDispatchRunning = false;
  const experienceDispatchTimer = setInterval(() => {
    if (experienceDispatchRunning) return;
    experienceDispatchRunning = true;
    void experienceOutboxDispatcher
      .dispatch()
      .then(() => experienceReconciler.requeue(clock.now()))
      .then(() => observationReconciler.requeue(clock.now()))
      .then(() => reflectionReconciler.requeue(clock.now()))
      .then(() => experienceCompilation?.dispatcher.dispatch() ?? 0)
      .then(() => experienceCompilation?.normalizationReconciler.requeue(clock.now()) ?? 0)
      .then(() => experienceCompilation?.miningReconciler.requeue(clock.now()) ?? 0)
      .then(() => experienceCompilation?.candidateDispatcher?.dispatch() ?? 0)
      .then(() => experienceCompilation?.candidateReconciler?.requeue(clock.now()) ?? 0)
      .then(() => experienceCompilation?.replayValidationDispatcher?.dispatch() ?? 0)
      .then(() => experienceCompilation?.replayValidationReconciler?.requeue(clock.now()) ?? 0)
      .then(() => artifactShadowRuntime?.service.requeue(100) ?? 0)
      .then(() => requeueArtifactRevalidations(100))
      .then(() => dependencies.artifactOutboxConsumer.value?.consume(500) ?? 0)
      .catch((error: unknown) => {
        process.stderr.write(
          `${JSON.stringify({ event: 'experience_dispatch.failed', errorCode: runtimeErrorCode(error) })}\n`,
        );
      })
      .finally(() => {
        experienceDispatchRunning = false;
      });
  }, 500);
  cleanupScope.registerSync(() => {
    clearInterval(experienceDispatchTimer);
  });

  experienceDispatchTimer.unref();
  const foregroundActivity = new ForegroundActivityTracker();
  const foregroundTaskIsBusy = async (): Promise<boolean> => {
    if (foregroundActivity.isBusy()) return true;
    const result = await pool.query<{
      busy: boolean;
    }>(`SELECT EXISTS(
         SELECT 1 FROM agent_task
         WHERE phase IN (
           'context_loading','goal_deliberation','skill_resolution',
           'planning','executing','evaluating'
         ) OR updated_at >= clock_timestamp() - interval '500 milliseconds'
       ) AS busy`);
    return foregroundActivity.isBusy() || result.rows[0]?.busy === true;
  };
  const evidenceExportFairness = new EvidenceBackgroundFairnessGate({
    idleSliceLimit: 8,
    busySliceLimit: 1,
    maximumDeferralMs: 10000,
  });
  const evidenceProjectionFairness = new EvidenceBackgroundFairnessGate({
    idleSliceLimit: 8,
    busySliceLimit: 1,
    maximumDeferralMs: 10000,
  });
  const evidenceExportTimer = setInterval(() => {
    if (dependencies.evidenceExportInFlight.value !== undefined) return;
    dependencies.evidenceExportInFlight.value = (async () => {
      await runEvidenceBackgroundSlices({
        gate: evidenceExportFairness,
        maximumSlices: 8,
        idleItemLimit: 16,
        busyItemLimit: 1,
        foregroundBusy: foregroundTaskIsBusy,
        now: Date.now,
        runSlice: async ({ itemLimit }) => {
          const result = await evidenceExport.drain(itemLimit);
          return result.attemptedPartition !== undefined && result.delivered > 0;
        },
      });
    })()
      .catch((error: unknown) => {
        process.stderr.write(
          `${JSON.stringify({ event: 'evidence_export.delivery_failed', errorCode: runtimeErrorCode(error) })}\n`,
        );
      })
      .finally(() => {
        dependencies.evidenceExportInFlight.value = undefined;
      });
  }, 1000);
  cleanupScope.registerSync(() => {
    clearInterval(evidenceExportTimer);
  });

  evidenceExportTimer.unref();
  let lastEvidenceRetentionBucket: string | undefined;
  const maintainEvidenceOperations = async (): Promise<void> => {
    let recoveryResumeSucceeded = false;
    let retentionRunStillRunning = false;
    try {
      const recovered = await evidenceOperations.resumeRecoveryRuns(20);
      recoveryResumeSucceeded = true;
      retentionRunStillRunning = recovered.some(
        (run) => run.operation === 'apply_retention' && run.status === 'running',
      );
      const failedRecoveryRuns = recovered.filter((run) => run.status === 'failed');
      if (failedRecoveryRuns.length > 0) {
        process.stderr.write(
          `${JSON.stringify({
            event: 'evidence_operations.recovery_failed',
            recoveryRunIds: failedRecoveryRuns.map((run) => run.recoveryRunId),
          })}\n`,
        );
      }
    } catch (error: unknown) {
      process.stderr.write(
        `${JSON.stringify({
          event: 'evidence_operations.resume_failed',
          errorCode: runtimeErrorCode(error),
        })}\n`,
      );
    }
    // Finish the previously committed bounded retention run before scheduling a new daily run.
    if (!recoveryResumeSucceeded || retentionRunStillRunning) return;
    try {
      const configuration = await evidenceOperations.configuration();
      if (!configuration?.isActive) return;
      const requestedAt = clock.now();
      const retentionBucket = requestedAt.slice(0, 10);
      const retentionScope = `${configuration.exportId}:${String(configuration.revision)}:${retentionBucket}`;
      if (retentionScope === lastEvidenceRetentionBucket) return;
      const retentionIdentity = evidenceRetentionIdentity(
        configuration.exportId,
        configuration.revision,
        retentionBucket,
        deviceWorkScope,
      );
      const result = await evidenceOperations.applyRetention({
        operationId: `evidence-retention:${retentionIdentity}`,
        idempotencyKeyHash: `sha256:${retentionIdentity}`,
        actorId: 'sdar-runtime',
        reason: 'scheduled canonical Evidence diagnostic retention',
        requestedAt,
      });
      lastEvidenceRetentionBucket = retentionScope;
      if (result.status === 'failed') {
        process.stderr.write(
          `${JSON.stringify({
            event: 'evidence_operations.retention_failed',
            recoveryRunId: result.recoveryRunId,
            errorCode: result.errorCode,
          })}\n`,
        );
      }
    } catch (error: unknown) {
      process.stderr.write(
        `${JSON.stringify({
          event: 'evidence_operations.retention_failed',
          errorCode: runtimeErrorCode(error),
        })}\n`,
      );
    }
  };
  const scheduleEvidenceOperationsMaintenance = (): void => {
    if (dependencies.evidenceOperationsMaintenanceInFlight.value !== undefined) return;
    dependencies.evidenceOperationsMaintenanceInFlight.value = maintainEvidenceOperations().finally(
      () => {
        dependencies.evidenceOperationsMaintenanceInFlight.value = undefined;
      },
    );
  };
  await maintainEvidenceOperations();
  const evidenceOperationsMaintenanceTimer = setInterval(
    scheduleEvidenceOperationsMaintenance,
    1000,
  );
  cleanupScope.registerSync(() => {
    clearInterval(evidenceOperationsMaintenanceTimer);
  });

  evidenceOperationsMaintenanceTimer.unref();
  const runtimeCoreEvidenceProjectionTimer = setInterval(() => {
    if (dependencies.runtimeCoreEvidenceProjection.value !== undefined) return;
    dependencies.runtimeCoreEvidenceProjection.value = (async () => {
      const projectionClient = await pool.connect();
      try {
        const lease = await projectionClient.query<{
          acquired: boolean;
        }>(`SELECT pg_try_advisory_lock(
             hashtextextended('sdar:v141:canonical-evidence-projection',0)
           ) AS acquired`);
        if (lease.rows[0]?.acquired !== true) return;
        try {
          let canonicalAttemptedItems = 0;
          let canonicalFailedItems = 0;
          let canonicalSourceListingFailures = 0;
          let canonicalDurableIssueCount = 0;
          const canonicalProgress = { quiescent: false };
          await runEvidenceBackgroundSlices({
            gate: evidenceProjectionFairness,
            maximumSlices: 8,
            idleItemLimit: 10,
            busyItemLimit: 1,
            foregroundBusy: foregroundTaskIsBusy,
            now: Date.now,
            runSlice: async ({ itemLimit }) => {
              const result = await canonicalEvidenceProjectionPipeline.drain(itemLimit);
              canonicalAttemptedItems += result.attemptedItems;
              canonicalFailedItems += result.failedItems;
              canonicalSourceListingFailures += result.sourceListingFailures;
              canonicalDurableIssueCount += result.openIssueIds.length;
              if (result.attemptedItems === 0) canonicalProgress.quiescent = true;
              return result.sourceListingFailures === 0 && result.attemptedItems > 0;
            },
          });
          if (
            !canonicalProgress.quiescent ||
            canonicalFailedItems > 0 ||
            canonicalSourceListingFailures > 0
          ) {
            process.stderr.write(
              `${JSON.stringify({
                event: 'evidence_projection.seal_deferred',
                reason:
                  canonicalSourceListingFailures > 0
                    ? 'source_listing_failed'
                    : canonicalFailedItems > 0
                      ? 'projection_failed'
                      : 'canonical_backlog_not_quiescent',
                attemptedItems: canonicalAttemptedItems,
                failedItems: canonicalFailedItems,
                sourceListingFailures: canonicalSourceListingFailures,
                durableIssueCount: canonicalDurableIssueCount,
              })}\n`,
            );
            return;
          }
          if (await foregroundTaskIsBusy()) return;
          await evidenceQualityEvaluator.evaluate();
          const coverageResult = await episodeEvidenceCoverageProjectionPipeline.drain(10);
          const infrastructureResult = await evidenceInfrastructureProjectionPipeline.drain(25);
          const failedItems = coverageResult.failedItems + infrastructureResult.failedItems;
          const sourceListingFailures =
            coverageResult.sourceListingFailures + infrastructureResult.sourceListingFailures;
          if (failedItems > 0 || sourceListingFailures > 0) {
            process.stderr.write(
              `${JSON.stringify({
                event: 'evidence_projection.items_deferred',
                failedItems,
                sourceListingFailures,
                durableIssueCount:
                  coverageResult.openIssueIds.length + infrastructureResult.openIssueIds.length,
              })}\n`,
            );
          }
        } finally {
          await projectionClient.query(`SELECT pg_advisory_unlock(
               hashtextextended('sdar:v141:canonical-evidence-projection',0)
             )`);
        }
      } finally {
        projectionClient.release();
      }
    })()
      .catch((error: unknown) => {
        const issuePersistenceFailures =
          error instanceof EvidenceProjectionIssuePersistenceError
            ? error.result.issuePersistenceFailures
            : undefined;
        process.stderr.write(
          `${JSON.stringify({
            event: 'evidence_projection.pipeline_failed',
            errorCode: runtimeErrorCode(error),
            ...(issuePersistenceFailures === undefined ? {} : { issuePersistenceFailures }),
          })}\n`,
        );
      })
      .finally(() => {
        dependencies.runtimeCoreEvidenceProjection.value = undefined;
      });
  }, 2000);
  cleanupScope.registerSync(() => {
    clearInterval(runtimeCoreEvidenceProjectionTimer);
  });

  runtimeCoreEvidenceProjectionTimer.unref();
  const worker = new BullMqContextWorker({
    connection: options.redis,
    queueName,
    processor: dependencies.processor.value,
    serial: contextSerial,
  });
  worker.close = cleanupScope.register(worker.close.bind(worker));

  const remoteTaskWorker =
    remoteTaskPolling === undefined
      ? undefined
      : new BullMqRemoteTaskPollWorker({
          connection: options.redis,
          ...(options.frozenMcpTasks?.queueName === undefined
            ? {}
            : { queueName: options.frozenMcpTasks.queueName }),
          processor: remoteTaskPolling,
        });
  if (remoteTaskWorker !== undefined) {
    remoteTaskWorker.close = cleanupScope.register(remoteTaskWorker.close.bind(remoteTaskWorker));
  }

  const remoteTaskContinuationWorker =
    remoteTaskContinuation === undefined
      ? undefined
      : new BullMqRemoteTaskContinuationWorker({
          connection: options.redis,
          ...(remoteTaskContinuationQueueName === undefined
            ? {}
            : { queueName: remoteTaskContinuationQueueName }),
          processor: {
            process: (job) => remoteTaskContinuation.process(job),
          },
        });
  if (remoteTaskContinuationWorker !== undefined) {
    remoteTaskContinuationWorker.close = cleanupScope.register(
      remoteTaskContinuationWorker.close.bind(remoteTaskContinuationWorker),
    );
  }

  const remoteTaskCancellationWorker =
    remoteTaskCancellationProcessor === undefined
      ? undefined
      : new BullMqRemoteTaskCancellationWorker({
          connection: options.redis,
          ...(remoteTaskCancellationQueueName === undefined
            ? {}
            : { queueName: remoteTaskCancellationQueueName }),
          processor: remoteTaskCancellationProcessor,
        });
  if (remoteTaskCancellationWorker !== undefined) {
    remoteTaskCancellationWorker.close = cleanupScope.register(
      remoteTaskCancellationWorker.close.bind(remoteTaskCancellationWorker),
    );
  }

  let remoteTaskReconcileRunning = false;
  let businessRefreshAfter: string | undefined;
  let businessRefreshRunning = false;
  const businessRefreshTimer =
    taskBusinessSync === undefined
      ? undefined
      : setInterval(() => {
          if (businessRefreshRunning) return;
          businessRefreshRunning = true;
          dependencies.businessRefreshCompletion.value = taskBusinessSync
            .reconcile(32, businessRefreshAfter)
            .then(async (result) => {
              businessRefreshAfter = result.examined < 32 ? undefined : result.lastBindingId;
              const recovered = await taskBusinessCommands?.recover();
              if (recovered !== undefined && recovered.failures.length > 0)
                process.stderr.write(
                  `${JSON.stringify({ event: 'task_business.command_recovery_failures', failures: recovered.failures })}\n`,
                );
              if (result.failures.length > 0)
                process.stderr.write(
                  `${JSON.stringify({ event: 'task_business.refresh_failures', failures: result.failures })}\n`,
                );
            })
            .catch((error: unknown) => {
              process.stderr.write(
                `${JSON.stringify({ event: 'task_business.reconciliation_failed', errorCode: runtimeErrorCode(error) })}\n`,
              );
            })
            .finally(() => {
              businessRefreshRunning = false;
            });
        }, 15000);
  cleanupScope.registerSync(() => {
    clearInterval(businessRefreshTimer);
  });

  businessRefreshTimer?.unref();
  const remoteTaskReconcileTimer =
    remoteTaskReconciler === undefined
      ? undefined
      : setInterval(() => {
          if (remoteTaskReconcileRunning) return;
          remoteTaskReconcileRunning = true;
          void (async () => {
            await remoteTaskAdmissionRecovery?.reconcile(100, 'periodic');
            return remoteTaskReconciler.reconcile();
          })()
            .catch((error: unknown) => {
              process.stderr.write(
                `${JSON.stringify({ event: 'remote_task_reconcile.failed', error: error instanceof Error ? error.message : String(error) })}\n`,
              );
            })
            .finally(() => {
              remoteTaskReconcileRunning = false;
            });
        }, options.frozenMcpTasks?.reconcileIntervalMs ?? 1000);
  cleanupScope.registerSync(() => {
    clearInterval(remoteTaskReconcileTimer);
  });

  remoteTaskReconcileTimer?.unref();
  let remoteTaskContinuationReconcileRunning = false;
  const remoteTaskContinuationReconcileTimer =
    remoteTaskContinuationReconciler === undefined
      ? undefined
      : setInterval(() => {
          if (remoteTaskContinuationReconcileRunning) return;
          remoteTaskContinuationReconcileRunning = true;
          void remoteTaskContinuationReconciler
            .reconcile()
            .catch((error: unknown) => {
              process.stderr.write(
                `${JSON.stringify({ event: 'remote_task_continuation_reconcile.failed', error: error instanceof Error ? error.message : String(error) })}\n`,
              );
            })
            .finally(() => {
              remoteTaskContinuationReconcileRunning = false;
            });
        }, options.frozenMcpTasks?.reconcileIntervalMs ?? 1000);
  cleanupScope.registerSync(() => {
    clearInterval(remoteTaskContinuationReconcileTimer);
  });

  remoteTaskContinuationReconcileTimer?.unref();
  let remoteTaskCancellationReconcileRunning = false;
  const remoteTaskCancellationReconcileTimer =
    remoteTaskCancellationReconciler === undefined
      ? undefined
      : setInterval(() => {
          if (remoteTaskCancellationReconcileRunning) return;
          remoteTaskCancellationReconcileRunning = true;
          void remoteTaskCancellationReconciler
            .reconcile()
            .catch((error: unknown) => {
              process.stderr.write(
                `${JSON.stringify({ event: 'remote_task_cancellation_reconcile.failed', error: error instanceof Error ? error.message : String(error) })}\n`,
              );
            })
            .finally(() => {
              remoteTaskCancellationReconcileRunning = false;
            });
        }, options.frozenMcpTasks?.reconcileIntervalMs ?? 1000);
  cleanupScope.registerSync(() => {
    clearInterval(remoteTaskCancellationReconcileTimer);
  });

  remoteTaskCancellationReconcileTimer?.unref();
  if (remoteTaskReconciler !== undefined) await remoteTaskReconciler.reconcile();
  const initialBusinessRefresh = await taskBusinessSync?.reconcile();
  const initialBusinessCommandRecovery = await taskBusinessCommands?.recover();
  if (
    initialBusinessCommandRecovery !== undefined &&
    initialBusinessCommandRecovery.failures.length > 0
  )
    process.stderr.write(
      `${JSON.stringify({ event: 'task_business.initial_command_recovery_failures', failures: initialBusinessCommandRecovery.failures })}\n`,
    );
  if (initialBusinessRefresh !== undefined && initialBusinessRefresh.failures.length > 0)
    process.stderr.write(
      `${JSON.stringify({ event: 'task_business.initial_refresh_failures', failures: initialBusinessRefresh.failures })}\n`,
    );
  if (remoteTaskContinuationReconciler !== undefined)
    await remoteTaskContinuationReconciler.reconcile();
  if (remoteTaskCancellationReconciler !== undefined)
    await remoteTaskCancellationReconciler.reconcile();
  const cognitiveRuntimeReconciler = new CognitiveRuntimeReconciler({
    dispatchTerminalOutbox: () => experienceOutboxDispatcher.dispatch(),
    requeueExperience: () => experienceReconciler.requeue(clock.now()),
    requeueObservation: () => observationReconciler.requeue(clock.now()),
    requeueReflection: () => reflectionReconciler.requeue(clock.now()),
    rebuildActiveKnowledge: () => knowledgePromotion.rebuildActiveProjections(),
  });
  try {
    await cognitiveRuntimeReconciler.rebuild();
    if (experienceCompilation !== undefined) {
      await experienceCompilation.dispatcher.dispatch(500);
      await experienceCompilation.normalizationReconciler.requeue(clock.now(), 500);
      await experienceCompilation.miningReconciler.requeue(clock.now(), 500);
      await experienceCompilation.candidateDispatcher?.dispatch(500);
      await experienceCompilation.candidateReconciler?.requeue(clock.now(), 500);
      await experienceCompilation.replayValidationDispatcher?.dispatch(500);
      await experienceCompilation.replayValidationReconciler?.requeue(clock.now(), 500);
      await experienceCompilation.replayValidationRetention?.(clock.now(), 1000);
      await artifactShadowRuntime?.service.requeue(500);
      await requeueArtifactRevalidations(500);
      while ((await dependencies.artifactOutboxConsumer.value?.consume(500)) === 500) {
        // Drain ordered P02/P06 lifecycle events so ephemeral registry projections cannot retain stale actives.
      }
    }
  } catch (error: unknown) {
    process.stderr.write(
      `${JSON.stringify({ event: 'experience_startup_reconcile.failed', errorCode: runtimeErrorCode(error) })}\n`,
    );
  }
  worker.start();
  experienceWorker.start();
  observationWorker.start();
  reflectionWorker.start();
  experienceCompilation?.normalizationWorker.start();
  experienceCompilation?.miningWorker.start();
  experienceCompilation?.candidateWorker?.start();
  experienceCompilation?.replayValidationWorker?.start();
  artifactShadowRuntime?.worker.start();
  artifactShadowRuntime?.revalidationWorker?.start();
  remoteTaskWorker?.start();
  remoteTaskContinuationWorker?.start();
  remoteTaskCancellationWorker?.start();
  return {
    foregroundActivity,
    waitSweepTimer,
    attemptDispatchTimer,
    capabilityCatalogRefreshTimer,
    providerBindingReconciliationTimer,
    experienceDispatchTimer,
    evidenceExportTimer,
    evidenceOperationsMaintenanceTimer,
    runtimeCoreEvidenceProjectionTimer,
    remoteTaskReconcileTimer,
    remoteTaskContinuationReconcileTimer,
    remoteTaskCancellationReconcileTimer,
    businessRefreshTimer,
    remoteTaskWorker,
    remoteTaskContinuationWorker,
    remoteTaskCancellationWorker,
    worker,
  };
}
