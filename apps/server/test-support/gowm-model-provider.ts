import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { z } from 'zod';

const record = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);
const records = (value: unknown) => z.array(z.record(z.string(), z.unknown())).parse(value);
const text = (value: unknown) => z.string().min(1).parse(value);

export interface GowmModelFixtureConfiguration {
  readonly expectedWorkflowStatus?: 'succeeded' | 'failed';
  readonly taskTypeId: string;
  readonly capabilityId: string;
  readonly skillId: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly deviceIds: readonly string[];
  readonly spatialTarget?: Readonly<{ x: number; y: number; frame: string }>;
}

/** Model protocol fixture only. Every unsupported stage fails; no live transport fallback. */
export async function startGowmModelProvider(configuration: GowmModelFixtureConfiguration) {
  const calls: string[] = [];
  const failures: string[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      try {
        assert.equal(request.method, 'POST');
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          const value: unknown = chunk;
          assert.ok(value instanceof Uint8Array);
          size += value.byteLength;
          assert.ok(size <= 2 * 1024 * 1024);
          chunks.push(Buffer.from(value));
        }
        const body = record(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
        let result: unknown;
        if (request.url === '/v1/embeddings') {
          calls.push('embedding');
          result = { data: [{ embedding: [1, 0, 0, 0] }], usage: { prompt_tokens: 1 } };
        } else {
          assert.equal(request.url, '/v1/chat/completions');
          const instruction = records(body['messages']).find(
            (message) => message['role'] === 'user',
          );
          const input = record(JSON.parse(text(instruction?.['content'])) as unknown);
          const decision = gowmModelDecision(configuration, input);
          calls.push(decision.stage);
          result = {
            choices: [{ message: { content: JSON.stringify(decision.value) } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          };
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(result));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'UNKNOWN_FIXTURE_FAILURE';
        failures.push(message);
        response.writeHead(422, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 'GOWM_MODEL_FIXTURE_REJECTED' } }));
      }
    })();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
    calls,
    failures,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
    },
  };
}

export function gowmModelDecision(
  config: GowmModelFixtureConfiguration,
  input: Readonly<Record<string, unknown>>,
): Readonly<{ stage: string; value: unknown }> {
  const operation = input['operation'];
  if (operation === 'decide_task_intent') {
    const request = text(input['requestText']);
    assert.ok(config.deviceIds.some((device) => request.includes(device)));
    return {
      stage: 'intent',
      value: { intent: 'execute', summary: 'Execute the explicit synthetic read request' },
    };
  }
  if (operation === 'formulate_goal') {
    const request = text(input['requestText']);
    return {
      stage: 'goal',
      value: {
        title: request,
        description: request,
        constraints: ['Read only'],
        successCriteria: ['Return observed state'],
        requiresInput: false,
      },
    };
  }
  if (input['untrustedUserRequest'] !== undefined) {
    const request = text(input['untrustedUserRequest']);
    const device = config.deviceIds.find((id) => request.includes(id));
    assert.ok(device, 'Fixture request must explicitly name an allowed synthetic device');
    assert.ok(
      records(input['taskTypeDefinitions']).some(
        (type) => type['taskTypeId'] === config.taskTypeId,
      ),
      'Configured Task Type must actually be recalled',
    );
    return {
      stage: 'task_understanding',
      value: {
        interpretedObjective: request,
        taskTypeCandidates: [
          {
            taskTypeId: config.taskTypeId,
            version: 1,
            confidence: 1,
            rationale: 'Exact isolated fixture',
          },
        ],
        capabilityRequirements: [
          {
            capabilityId: config.capabilityId,
            description: 'Read synthetic device state',
            required: true,
          },
        ],
        knownConstraints: ['Read only; one tool call after confirmation.'],
        knownDimensions: [
          { kind: 'target', value: device },
          { kind: 'criteria', value: 'Return observed state' },
        ],
        missingDimensions: [],
        assumptions: [],
        confidence: 1,
      },
    };
  }
  if (input['taskUnderstanding'] !== undefined) {
    const request = text(record(input['taskUnderstanding'])['originalRequest']);
    return {
      stage: 'goal_contract_generation',
      value: {
        title: request,
        description: request,
        constraints: ['Read only'],
        successCriteria: ['Return observed state'],
      },
    };
  }
  if (operation === 'plan_user_goal_skill_goal_dag') {
    const contract = record(input['contract']);
    return {
      stage: 'goal_planning',
      value: {
        skillGoals: [
          {
            skillGoalId: `sg-${createHash('sha256').update(text(contract['goalId'])).digest('hex').slice(0, 32)}`,
            requiredResult: 'Return observed state',
            capabilityNeeds: [config.capabilityId],
            coveredCriterionIds: records(contract['criteria']).map((criterion) =>
              text(criterion['criterionId']),
            ),
            requiredEffectRefs: ['effect.gowm.state_read'],
            evidenceRequirements: [],
            artifactRequirements: [],
            assumptions: [],
            constraints: ['Read only'],
          },
        ],
        dependencies: [],
      },
    };
  }
  if (operation === 'select_skill') {
    assert.ok(
      records(input['candidates']).some((candidate) => candidate['skillId'] === config.skillId),
    );
    return {
      stage: 'skill_selection',
      value: {
        selectedSkillId: config.skillId,
        decisionSummary: 'Exact fixture candidate from formal selection input',
      },
    };
  }
  if (operation === 'resolve_top_level_skill_input')
    return {
      stage: 'skill_input_resolution',
      value: {
        structuredInput: {},
        unresolvedFields: [],
        sourceRefs: [],
        decisionSummary: 'Use the explicit A2A structured input overlay',
      },
    };
  if (
    [
      'task_initial_plan',
      'plan_with_goal_execution_contract',
      'plan_with_preferred_workflow_template',
      'plan_with_stage_memory',
    ].includes(String(operation))
  ) {
    const identity = record(input['workflowIdentity']);
    return {
      stage: 'workflow_planning',
      value: {
        ...identity,
        executionSemanticsVersion: '2.0',
        entryNodeId: 'read',
        exitNodeIds: ['result'],
        nodes: [
          {
            nodeId: 'read',
            name: 'Read synthetic device',
            type: 'mcp_tool',
            tool: { serverId: config.serverId, toolName: config.toolName },
            arguments: {
              resourceId: { op: 'ref', path: ['input', 'resourceId'] },
              ...(config.spatialTarget === undefined ? {} : { target: config.spatialTarget }),
            },
          },
          {
            nodeId: 'result',
            name: 'Return observation',
            type: 'result',
            value: { op: 'ref', path: ['outputs', 'read', 'data', 'structuredContent'] },
          },
        ],
        edges: [{ sourceNodeId: 'read', targetNodeId: 'result' }],
      },
    };
  }
  if (operation === 'process_workflow_result') {
    const normalized = record(input['normalized']);
    assert.deepEqual(normalized['errors'], []);
    const value = record(normalized['data']);
    assert.ok(Object.keys(value).length > 0, 'Never fabricate a missing tool result');
    return {
      stage: 'result_processing',
      value: {
        text: 'Observed synthetic device state',
        structured: value,
        keyFacts: [],
        valueAssessment: { valuable: true, summary: 'Actual protocol fixture result' },
        memoryCandidates: [],
      },
    };
  }
  if (operation === 'evaluate_task_component') {
    const evidence = record(input['evidence']);
    const failed = config.expectedWorkflowStatus === 'failed';
    assert.equal(record(evidence['instance'])['status'], failed ? 'failed' : 'succeeded');
    if (failed) assert.ok(Object.keys(record(record(evidence['instance'])['errors'])).length > 0);
    return {
      stage: 'evaluation',
      value: {
        score: failed ? 0 : 1,
        summary: failed
          ? 'Synthetic read failed after provider cancellation'
          : 'Synthetic read completed through actual runtime',
        findings: [],
        evidenceRefs: [text(evidence['taskId'])],
      },
    };
  }
  if (operation === 'refine_memory') {
    const candidate = record(input['candidate']);
    return {
      stage: 'result_processing',
      value: {
        type: text(candidate['type']),
        content: record(candidate['content']),
        summary: text(candidate['summary']),
        confidence: candidate['confidence'],
        durability: 'volatile',
        authority: 'mcp',
        durabilityReason: 'Synthetic observation is not durable world truth',
      },
    };
  }
  if (input['extractor'] !== undefined)
    return {
      stage: 'experience_observation',
      value: {
        extractorKind: text(record(input['extractor'])['kind']),
        statements: [],
        changeSuggestions: [],
      },
    };
  if (input['observations'] !== undefined)
    return { stage: 'experience_reflection', value: { impacts: [], drafts: [] } };
  if (input['goal'] !== undefined && input['workflow'] !== undefined) {
    const workflow = record(input['workflow']);
    if (config.expectedWorkflowStatus === 'failed') {
      assert.equal(workflow['status'], 'failed');
      assert.match(JSON.stringify(workflow['errors']), /cancel/iu);
      return {
        stage: 'goal_evaluation',
        value: {
          decision: 'unachievable',
          summary: 'Provider cancelled the requested synthetic read; no result is claimed.',
        },
      };
    }
    assert.equal(workflow['status'], 'succeeded');
    assert.deepEqual(workflow['errors'], {});
    assert.ok(Object.keys(record(workflow['result'])).length > 0);
    return {
      stage: 'goal_evaluation',
      value: { decision: 'achieved', summary: 'Verified persisted workflow result' },
    };
  }
  throw new Error(
    `GOWM_MODEL_STAGE_NOT_IMPLEMENTED:${typeof operation === 'string' ? operation : Object.keys(input).join(',')}`,
  );
}
