import type { Clock, McpRegistryService } from '../../../packages/application/src/index.js';
import {
  hashCanonicalEvidenceJson,
  type McpInvocation,
} from '../../../packages/domain/src/index.js';

import type { UgvMoveTaskBindingResolver } from './ugv-move-binding.js';
import {
  ugvSimulationQualificationStateReadArguments,
  UgvMoveSkillUsageError,
  validateUgvSimulationQualificationReceipt,
} from './ugv-move-skill-usage.js';

const STATE_OPERATION = 'vehicle_get_state';
const UGV_RESOURCE_ID = 'vehicle:ugv1';
export const UGV_SIMULATION_QUALIFICATION_ID = /^uap-p3-b02-[a-z0-9][a-z0-9._-]{7,127}$/u;

export interface UgvSimulationQualificationReceipt {
  readonly simulationId: string;
  readonly invocationId: string;
  readonly resultHash: `sha256:${string}`;
  readonly completedAt: string;
  readonly observedAt: string;
  readonly revision: string;
  readonly mqttIngressSequence: number;
  readonly serverId: string;
  readonly providerBindingId: string;
  readonly providerId: string;
  readonly operationName: typeof STATE_OPERATION;
  readonly resourceId: typeof UGV_RESOURCE_ID;
  readonly sourcePosition: Readonly<{ longitude: number; latitude: number }>;
}

type QualificationRegistry = Pick<McpRegistryService, 'callDetailed' | 'listInvocations'>;
type QualificationAuthority = Pick<UgvMoveTaskBindingResolver, 'resolveQualificationAuthority'>;

/**
 * Profile-only taskless qualification. PostgreSQL MCP invocations are the sole receipt authority;
 * the in-process serial chain is concurrency coordination only and never supplies recovered state.
 */
export class UgvSimulationQualificationService {
  readonly #registry: QualificationRegistry;
  readonly #authority: QualificationAuthority;
  readonly #clock: Pick<Clock, 'now'>;
  readonly #resolvedDispatches = new Set<string>();
  #serial: Promise<void> = Promise.resolve();

  constructor(
    dependencies: Readonly<{
      registry: QualificationRegistry;
      authority: QualificationAuthority;
      clock: Pick<Clock, 'now'>;
    }>,
  ) {
    this.#registry = dependencies.registry;
    this.#authority = dependencies.authority;
    this.#clock = dependencies.clock;
  }

  capture(input: Readonly<{ simulationId: string }>): Promise<UgvSimulationQualificationReceipt> {
    const operation = this.#serial.then(() => this.#capture(input));
    this.#serial = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async #capture(
    input: Readonly<{ simulationId: string }>,
  ): Promise<UgvSimulationQualificationReceipt> {
    const simulationId = input.simulationId;
    if (!UGV_SIMULATION_QUALIFICATION_ID.test(simulationId))
      fail(
        'UGV_SIMULATION_QUALIFICATION_ID_INVALID',
        400,
        'The simulation qualification identity is invalid.',
      );
    const authority = await this.#authority.resolveQualificationAuthority();
    const existing = await this.#matchingReceipts(authority.serverId, simulationId);
    if (existing.length > 1)
      fail(
        'UGV_SIMULATION_QUALIFICATION_RECEIPT_CONFLICT',
        409,
        'The simulation run already has more than one qualification receipt.',
      );
    const prior = existing[0];
    if (prior !== undefined) return this.#project(prior, authority, simulationId, true);
    const dispatchKey = `${authority.serverId}\u0000${simulationId}`;
    if (this.#resolvedDispatches.has(dispatchKey))
      fail(
        'UGV_SIMULATION_QUALIFICATION_RECEIPT_CONFLICT',
        409,
        'A resolved qualification dispatch has no one exact durable receipt.',
      );

    const admitted = await this.#registry.callDetailed(
      authority.serverId,
      STATE_OPERATION,
      ugvSimulationQualificationStateReadArguments(),
      undefined,
      {
        providerBindingId: authority.providerBindingId,
        providerId: authority.providerId,
        executionContext: { mode: 'simulation', simulationId },
      },
    );
    // This is a fail-closed no-redispatch fence only. It never substitutes for the PostgreSQL
    // receipt and is consulted solely when the required post-call receipt cannot be proven.
    this.#resolvedDispatches.add(dispatchKey);
    if (admitted.outcome.kind !== 'immediate')
      fail(
        'UGV_SIMULATION_QUALIFICATION_OUTCOME_INVALID',
        502,
        'The fixed qualification state read did not complete synchronously.',
      );

    const persisted = await this.#matchingReceipts(authority.serverId, simulationId);
    const receipt = persisted[0];
    if (persisted.length !== 1 || receipt?.invocationId !== admitted.invocationId)
      fail(
        'UGV_SIMULATION_QUALIFICATION_RECEIPT_CONFLICT',
        409,
        'The durable qualification receipt is missing, duplicated, or uncorrelated.',
      );
    return this.#project(receipt, authority, simulationId, false);
  }

  async #matchingReceipts(serverId: string, simulationId: string) {
    const invocations = await this.#registry.listInvocations(serverId);
    return invocations.filter(
      (invocation) =>
        invocation.serverId === serverId &&
        invocation.toolName === STATE_OPERATION &&
        invocation.executionMode === 'simulation' &&
        invocation.simulationId === simulationId,
    );
  }

  #project(
    receipt: McpInvocation,
    authority: Awaited<ReturnType<QualificationAuthority['resolveQualificationAuthority']>>,
    simulationId: string,
    prior: boolean,
  ): UgvSimulationQualificationReceipt {
    const now = this.#clock.now();
    let validated: ReturnType<typeof validateUgvSimulationQualificationReceipt>;
    try {
      validated = validateUgvSimulationQualificationReceipt(
        receipt,
        authority.serverId,
        simulationId,
        now,
        now,
      );
    } catch (error: unknown) {
      if (error instanceof UgvMoveSkillUsageError) {
        fail(
          error.code === 'UGV_MOVE_SKILL_USAGE_QUALIFICATION_STALE'
            ? 'UGV_SIMULATION_QUALIFICATION_RECEIPT_STALE'
            : 'UGV_SIMULATION_QUALIFICATION_RECEIPT_INVALID',
          prior ? 409 : 502,
          prior
            ? 'The simulation run already has an unusable qualification receipt.'
            : 'The newly persisted qualification receipt is invalid.',
        );
      }
      throw error;
    }
    return Object.freeze({
      simulationId,
      invocationId: receipt.invocationId,
      resultHash: hashCanonicalEvidenceJson(receipt.result),
      completedAt: receipt.completedAt,
      observedAt: validated.observedAt,
      revision: validated.revision,
      mqttIngressSequence: validated.mqttIngressSequence,
      serverId: authority.serverId,
      providerBindingId: authority.providerBindingId,
      providerId: authority.providerId,
      operationName: STATE_OPERATION,
      resourceId: UGV_RESOURCE_ID,
      sourcePosition: validated.position,
    });
  }
}

export type UgvSimulationQualificationErrorCode =
  | 'UGV_SIMULATION_QUALIFICATION_ID_INVALID'
  | 'UGV_SIMULATION_QUALIFICATION_RECEIPT_CONFLICT'
  | 'UGV_SIMULATION_QUALIFICATION_RECEIPT_STALE'
  | 'UGV_SIMULATION_QUALIFICATION_RECEIPT_INVALID'
  | 'UGV_SIMULATION_QUALIFICATION_OUTCOME_INVALID';

export class UgvSimulationQualificationError extends Error {
  constructor(
    readonly code: UgvSimulationQualificationErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'UgvSimulationQualificationError';
  }
}

function fail(code: UgvSimulationQualificationErrorCode, status: number, message: string): never {
  throw new UgvSimulationQualificationError(code, status, message);
}
