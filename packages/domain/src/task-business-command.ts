import { z } from 'zod';
import {
  TaskBusinessError,
  taskBusinessIdentitySchema,
  type TaskBusinessIdentity,
} from './task-business.js';
import { hashCanonicalEvidenceJson } from './evidence/canonical-evidence.js';

const text = z.string().min(1).max(512);
const scopeSchema = z
  .object({
    taskId: text,
    capabilityBindingId: text,
    capabilityId: text,
    capabilityVersion: z.number().int().positive(),
    capabilityAttemptId: text,
    planId: text,
    planHash: z.string().regex(/^[a-f0-9]{64}$/u),
    skillId: text,
    skillVersion: z.number().int().positive(),
    providerBindingId: text,
    serverId: text,
    toolName: text,
  })
  .strict();
export type TaskBusinessControlScope = z.infer<typeof scopeSchema>;
export const taskBusinessMutationRequestSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('input_response'),
      inputRequestId: text,
      inputLinkHash: text,
      requestId: text,
      requestKey: text,
      expectedRequestRevision: z.number().int().positive(),
      expectedSubjectBinding: z.record(z.string(), z.unknown()),
      response: z.discriminatedUnion('action', [
        z
          .object({
            action: z.literal('accept'),
            content: z.object({ decision: z.literal('continue_observation') }).strict(),
          })
          .strict(),
        z.object({ action: z.literal('decline') }).strict(),
        z.object({ action: z.literal('cancel') }).strict(),
      ]),
    })
    .strict(),
  z
    .object({
      operation: z.literal('navigation_adjust_plan'),
      interventionId: text,
      expectedInterventionRevision: z.number().int().positive(),
      expectedEffectivePlanRevision: z.number().int().nonnegative(),
      commandId: text,
      waypoints: z
        .array(
          z
            .object({
              longitude: z.number().min(-180).max(180),
              latitude: z.number().min(-90).max(90),
            })
            .strict(),
        )
        .min(1)
        .max(256),
      density: z.string().min(1).max(64),
    })
    .strict(),
]);
export type TaskBusinessMutationRequest = z.infer<typeof taskBusinessMutationRequestSchema>;
export const taskBusinessMutationPolicySchema = z
  .object({
    type: z.literal('task_business_mutation_policy'),
    profileVersion: z.literal('1.0-rc2'),
    allowedOperations: z
      .array(z.enum(['input_response', 'navigation_adjust_plan']))
      .min(1)
      .max(2),
    confirmation: z.literal('trusted_human_per_command'),
    dispatchPolicy: z.literal('single_sender_reconcile_never_redispatch'),
  })
  .strict();
export type TaskBusinessMutationPolicy = z.infer<typeof taskBusinessMutationPolicySchema>;

export interface TaskBusinessCommandIntent {
  readonly schemaVersion: 'sdar.task-business-command/v1';
  readonly intentId: string;
  readonly taskId: string;
  readonly bindingId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly identity: TaskBusinessIdentity;
  readonly frozenBindingHash: string;
  readonly authority: TaskBusinessControlScope;
  readonly request: TaskBusinessMutationRequest;
  readonly userRequestHash: string;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly validUntil: string;
  readonly reconcileUntil: string;
}
export interface TaskBusinessCommandRecord {
  readonly intent: TaskBusinessCommandIntent;
  readonly revision: number;
  readonly state:
    'prepared' | 'dispatching' | 'accepted' | 'confirmed' | 'rejected' | 'uncertain' | 'obsolete';
  readonly updatedAt: string;
  readonly confirmationId?: string;
  readonly confirmationFact?: Readonly<{
    confirmationId: string;
    contentHash: string;
    scopeHash: string;
    actorHash: string;
    confirmedAt: string;
    expiresAt: string;
  }>;
  readonly dispatchClaim?: Readonly<{
    confirmationId: string;
    invocationId: string;
    dispatchHash: string;
    consumedAt: string;
  }>;
  readonly dispatchToken?: string;
  readonly dispatchLeaseExpiresAt?: string;
  readonly receipt?: Readonly<Record<string, unknown>>;
  readonly errorCode?: string;
  readonly readAttempts: number;
  readonly readToken?: string;
  readonly readLeaseExpiresAt?: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
}
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const timestamp = z.iso.datetime({ offset: true });
const intentSchema = z
  .object({
    schemaVersion: z.literal('sdar.task-business-command/v1'),
    intentId: text,
    taskId: text,
    bindingId: text,
    goalId: text,
    goalVersion: z.number().int().positive(),
    identity: taskBusinessIdentitySchema,
    frozenBindingHash: hash,
    authority: scopeSchema,
    request: taskBusinessMutationRequestSchema,
    userRequestHash: hash,
    contentHash: hash,
    createdAt: timestamp,
    validUntil: timestamp,
    reconcileUntil: timestamp,
  })
  .strict();
const commandSchema = z
  .object({
    intent: intentSchema,
    revision: z.number().int().positive(),
    state: z.enum([
      'prepared',
      'dispatching',
      'accepted',
      'confirmed',
      'rejected',
      'uncertain',
      'obsolete',
    ]),
    updatedAt: timestamp,
    confirmationId: text.optional(),
    confirmationFact: z
      .object({
        confirmationId: text,
        contentHash: hash,
        scopeHash: hash,
        actorHash: hash,
        confirmedAt: timestamp,
        expiresAt: timestamp,
      })
      .strict()
      .optional(),
    dispatchClaim: z
      .object({
        confirmationId: text,
        invocationId: text,
        dispatchHash: hash,
        consumedAt: timestamp,
      })
      .strict()
      .optional(),
    dispatchToken: text.optional(),
    dispatchLeaseExpiresAt: timestamp.optional(),
    receipt: z.record(z.string(), z.unknown()).optional(),
    errorCode: text.optional(),
    readAttempts: z.number().int().nonnegative().max(5),
    readToken: text.optional(),
    readLeaseExpiresAt: timestamp.optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export function parseTaskBusinessCommandRecord(raw: unknown): TaskBusinessCommandRecord {
  const parsed = commandSchema.safeParse(raw);
  if (!parsed.success) throw new TaskBusinessError('TASK_BUSINESS_COMMAND_SCHEMA_INVALID');
  if (taskBusinessIntentContentHash(parsed.data.intent) !== parsed.data.intent.contentHash)
    throw new TaskBusinessError('TASK_BUSINESS_COMMAND_HASH_CONFLICT');
  // Zod optional values are absent in the persisted JSON representation.
  return JSON.parse(JSON.stringify(parsed.data)) as TaskBusinessCommandRecord;
}
export function taskBusinessIntentContentHash(
  intent: Omit<TaskBusinessCommandIntent, 'contentHash'>,
): string {
  // Wall clocks and reconciliation leases are not part of effect-bearing stable command content.
  return hashCanonicalEvidenceJson(taskBusinessIntentEffect(intent));
}
export function taskBusinessIntentEffect(intent: Omit<TaskBusinessCommandIntent, 'contentHash'>) {
  return {
    taskId: intent.taskId,
    bindingId: intent.bindingId,
    goalId: intent.goalId,
    goalVersion: intent.goalVersion,
    identity: intent.identity,
    frozenBindingHash: intent.frozenBindingHash,
    authority: intent.authority,
    request: intent.request,
  };
}
export function assertTaskBusinessCommandScope(
  actual: TaskBusinessControlScope,
  expected: TaskBusinessControlScope,
): void {
  if (
    hashCanonicalEvidenceJson(scopeSchema.parse(actual)) !==
    hashCanonicalEvidenceJson(scopeSchema.parse(expected))
  )
    throw new TaskBusinessError('TASK_BUSINESS_CONTROL_AUTHORITY_CHANGED');
}
export function parseTaskBusinessControlScope(raw: unknown): TaskBusinessControlScope {
  return scopeSchema.parse(raw);
}
