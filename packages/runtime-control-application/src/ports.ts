import type {
  ConfigurationRevision,
  ConfigurationTargetType,
  JsonObject,
  RuntimeRevisionAck,
} from '../../node-control-domain/src/index.js';

export interface RuntimeConfigurationTarget {
  readonly targetType: ConfigurationTargetType;
  readonly targetId: string;
}

export interface RuntimeConfigurationSource {
  latest(
    target: RuntimeConfigurationTarget,
    currentRevision?: number,
  ): Promise<ConfigurationRevision | undefined>;
  acknowledge(acknowledgement: RuntimeRevisionAck): Promise<void>;
}

export interface RuntimeConfigurationApplyResult {
  readonly status: 'applied' | 'partially_applied' | 'rejected';
  readonly reasonCode?: string;
  readonly detail?: JsonObject;
}

export interface RuntimeConfigurationApplier {
  apply(
    revision: ConfigurationRevision,
    previous: ConfigurationRevision | undefined,
  ): Promise<RuntimeConfigurationApplyResult>;
}

export interface RuntimeTaskConfigurationBinding {
  readonly taskId: string;
  readonly targetType: ConfigurationTargetType;
  readonly targetId: string;
  readonly configurationId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly boundAt: string;
}

export interface RuntimeConfigurationStore {
  findLkg(target: RuntimeConfigurationTarget): Promise<ConfigurationRevision | undefined>;
  recordOutcome(
    revision: ConfigurationRevision,
    acknowledgement: RuntimeRevisionAck,
    activate: boolean,
  ): Promise<void>;
  pinTask(
    taskId: string,
    target: RuntimeConfigurationTarget,
    boundAt: string,
  ): Promise<RuntimeTaskConfigurationBinding>;
  listPendingAcks(limit: number): Promise<readonly RuntimeRevisionAck[]>;
  markAckDelivered(acknowledgement: RuntimeRevisionAck, deliveredAt: string): Promise<void>;
  recordAckDeliveryFailure(acknowledgement: RuntimeRevisionAck, error: string): Promise<void>;
}

export interface RuntimeControlClock {
  now(): string;
}
