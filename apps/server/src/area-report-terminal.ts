import {
  isGovernedPatrol,
  ZMQ_PATROL_SKILL,
  ZMQ_PATROL_CAPABILITY,
} from '../../../packages/domain/src/zmq-area-patrol.js';
import process from 'node:process';
import { zmqToolForSkill, zmqCapabilityId } from '../../../packages/domain/src/zmq-capability.js';
import type {
  GoalEvaluator,
  JsonSchemaValidator,
  SkillRepository,
} from '../../../packages/application/src/ports.js';
import type { RuntimeTaskCapabilityService } from '../../../packages/application/src/task-capability.js';
import type { RuntimeTaskCapabilityTerminalProof } from '../../../packages/domain/src/index.js';
import type { ResultProcessor } from '../../../packages/application/src/result-processor.js';
import {
  normalizeResultEnvelope,
  type AgentTask,
  type SkillVersion,
  type WorkflowInstance,
  type ProcessedResultRecord,
  type SkillExecutionStatus,
} from '../../../packages/domain/src/index.js';

export function isAreaReportSkill(skillId: string, version: number): boolean {
  return (
    zmqToolForSkill(skillId) !== undefined ||
    (skillId === 'embodied.inspect_area' && version >= 1) ||
    isGovernedPatrol(skillId, version)
  );
}
function reportCapability(skillId: string): string {
  if (skillId === ZMQ_PATROL_SKILL) return ZMQ_PATROL_CAPABILITY;
  const name = zmqToolForSkill(skillId);
  return name === undefined ? skillId : zmqCapabilityId(name);
}

/** A validated reporting Workflow may finish with incomplete physical evidence. */
export function areaReportChildExecutionStatus(
  instance: Pick<WorkflowInstance, 'status' | 'result' | 'skillVersions'> | undefined,
  status: SkillExecutionStatus,
): SkillExecutionStatus {
  const selected = instance?.skillVersions[0];
  return status === 'completed' &&
    instance?.status === 'succeeded' &&
    selected !== undefined &&
    isAreaReportSkill(selected.skillId, selected.version) &&
    instance.result !== null &&
    typeof instance.result === 'object' &&
    !Array.isArray(instance.result) &&
    'status' in instance.result &&
    instance.result.status === 'degraded'
    ? 'degraded'
    : status;
}

/** A source-qualified complete or degraded report is a terminal reporting outcome, not fabricated coverage. */
export class AreaReportGoalEvaluator implements GoalEvaluator {
  constructor(
    readonly dependencies: Readonly<{
      fallback: GoalEvaluator;
      capabilities: Pick<RuntimeTaskCapabilityService, 'findBinding' | 'assertTerminalSuccess'>;
      schemas: JsonSchemaValidator;
      skills: Pick<SkillRepository, 'findVersion'>;
    }>,
  ) {}
  async evaluate(input: Parameters<GoalEvaluator['evaluate']>[0]) {
    const selected = input.instance.skillVersions[0];
    if (!selected || !isAreaReportSkill(selected.skillId, selected.version))
      return this.dependencies.fallback.evaluate(input);
    if (
      !input.taskId ||
      input.goal.status !== 'active' ||
      input.goal.goalId !== input.instance.goalId ||
      input.goal.version !== input.instance.goalVersion
    )
      throw Error('AREA_REPORT_TERMINAL_IDENTITY_INVALID');
    if (input.instance.status === 'failed')
      return {
        decision: 'unachievable' as const,
        summary:
          'Area reporting failed; retained source evidence does not authorize automatic physical replay.',
      };
    const binding = await this.dependencies.capabilities.findBinding(input.taskId);
    const skill = await this.dependencies.skills.findVersion(selected.skillId, selected.version);
    if (
      !binding ||
      skill?.status !== 'enabled' ||
      binding.requestedCapabilityId !== reportCapability(selected.skillId) ||
      input.instance.status !== 'succeeded' ||
      !areaReportErrorsAllowed(selected.skillId, input.instance) ||
      !input.instance.completedAt ||
      !this.dependencies.schemas.validate(skill.outputSchema, input.instance.result).valid
    )
      throw Error('AREA_REPORT_TERMINAL_AUTHORITY_INVALID');
    try {
      await this.dependencies.capabilities.assertTerminalSuccess(
        input.taskId,
        input.instance.result,
        { outputSchemaValid: true },
      );
    } catch (error) {
      process.stderr.write(
        JSON.stringify({
          event: 'area_report.terminal_denied',
          taskId: input.taskId,
          summary: error instanceof Error ? error.message : 'Unknown terminal guard failure',
        }) + '\n',
      );
      throw error;
    }
    return {
      decision: 'achieved' as const,
      summary:
        'The confirmed Task produced its source-qualified area report; incomplete evidence remains explicitly degraded.',
    };
  }
}

export function prepareAreaReportResult(
  task: AgentTask,
  skill: SkillVersion,
  instance: WorkflowInstance,
  processor: Pick<ResultProcessor, 'process'>,
): ProcessedResultRecord {
  if (
    !isAreaReportSkill(skill.skillId, skill.version) ||
    task.selectedSkillId !== skill.skillId ||
    task.selectedSkillVersion !== skill.version ||
    task.planId !== instance.planId ||
    task.goalId !== instance.goalId ||
    task.goalVersion !== instance.goalVersion ||
    instance.status !== 'succeeded' ||
    !instance.completedAt ||
    !areaReportErrorsAllowed(skill.skillId, instance)
  )
    throw Error('AREA_REPORT_RESULT_AUTHORITY_INVALID');
  const summary =
    'Returned the retained area report with explicit coverage, findings, source association and missing evidence.';
  return {
    resultId: `processed-result-terminal-${task.taskId}`,
    taskId: task.taskId,
    skillId: skill.skillId,
    skillVersion: skill.version,
    normalized: normalizeResultEnvelope(instance.result),
    output: processor.process({
      text: summary,
      structured: instance.result,
      outputSchema: skill.outputSchema,
    }),
    facts: [],
    valuable: true,
    valueSummary: summary,
    memoryCandidates: [],
    createdAt: instance.completedAt,
  };
}

/** Only declared child failures may reach the canonical patrol reporting node. */
function areaReportErrorsAllowed(skillId: string, instance: WorkflowInstance): boolean {
  const nodes = Object.keys(instance.errors);
  if (nodes.length === 0) return true;
  const result = instance.result;
  return (
    ['embodied.area_patrol', ZMQ_PATROL_SKILL].includes(skillId) &&
    result !== null &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    ['failed', 'degraded'].includes(String((result as Record<string, unknown>)['status'])) &&
    nodes.every((node) => /^usage_child_[01]$/.test(node))
  );
}

export function verifiedAreaReportOutcomeRefs(
  task: AgentTask,
  skill: SkillVersion,
  instance: WorkflowInstance,
  proof: RuntimeTaskCapabilityTerminalProof,
) {
  const outcome = skill.outcomeSpecification;
  const selected = instance.skillVersions[0];
  if (
    !outcome ||
    !isAreaReportSkill(skill.skillId, skill.version) ||
    proof.taskId !== task.taskId ||
    proof.requestedCapabilityId !== reportCapability(skill.skillId) ||
    selected?.skillId !== skill.skillId ||
    selected.version !== skill.version ||
    task.selectedSkillId !== skill.skillId ||
    task.selectedSkillVersion !== skill.version ||
    task.planId !== instance.planId
  )
    throw Error('AREA_REPORT_OUTCOME_AUTHORITY_INVALID');
  return {
    effectRefs: outcome.effects,
    evidenceRefs: outcome.evidence,
    artifactRefs: outcome.artifacts,
  };
}
