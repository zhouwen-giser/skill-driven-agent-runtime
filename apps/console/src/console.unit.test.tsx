import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';
import {
  applyVisualWorkflowEdit,
  parseVisualWorkflowDefinition,
  WorkflowEventDuration,
  WorkflowPanel,
  WorkflowTaskLink,
  WorkflowToolSemanticsSummary,
  TaskReadinessPanel,
} from './WorkflowPanel.js';
import {
  GoalTaskNavigation,
  RemoteTaskLifecyclePanel,
  TaskEvidenceNavigation,
  TaskPanel,
  TaskRelatedNavigation,
} from './TaskPanel.js';
import { PromptPanel } from './PromptPanel.js';
import { MemoryPanel, MemorySourceNavigation } from './MemoryPanel.js';
import { McpPanel } from './McpPanel.js';
import { SystemPanel } from './SystemPanel.js';
import { EvaluationPanel, OperationsDashboard } from './EvaluationPanel.js';
import { SkillStudio } from './SkillStudio.js';
import {
  openRelatedSkillTasks,
  SkillTaskNavigation,
  SkillToolPolicySemantics,
} from './SkillsPanel.js';
import { TaskReferenceLinks } from './RelatedLinks.js';

describe('operational console static accessibility contract', () => {
  it('renders execution semantics in plan confirmation and Skill Tool Policy views', () => {
    const tool = {
      serverId: 'mcp.devices',
      toolName: 'device_status',
      executionSemantics: {
        effect: 'read_only',
        execution: 'synchronous',
        cancellation: 'cooperative',
        idempotency: 'client_request_key',
        replay: 'allowed',
        source: 'mcp_declared',
      },
    };
    const markup = renderToStaticMarkup(
      <>
        <WorkflowToolSemanticsSummary items={[tool]} />
        <SkillToolPolicySemantics
          policy={{
            required: [{ serverId: 'mcp.devices', toolName: 'device_status' }],
            optional: [],
            forbidden: [],
          }}
          tools={[tool]}
        />
      </>,
    );
    expect(markup).toContain('CONFIRMATION AUTHORITY');
    expect(markup).toContain('required: mcp.devices/device_status');
    expect(markup).toContain('source mcp_declared');
    expect(markup).toContain('replay allowed');
  });

  it('renders navigation and the persistent trusted-intranet warning without authentication', () => {
    const markup = renderToStaticMarkup(<App />);
    expect(markup).toContain('aria-label="主导航"');
    expect(markup).toContain('trusted-intranet-only-no-auth');
    expect(markup).toContain('Do not expose publicly');
    expect(markup).toContain('DATA RETENTION BASELINE');
    expect(markup).toContain('V1 runs no cleanup scheduler');
  });

  it('renders labeled real-record lookups without static Workflow records', () => {
    const markup = renderToStaticMarkup(<WorkflowPanel />);
    expect(markup).toContain('Plan ID');
    expect(markup).toContain('Instance ID');
    expect(markup).not.toContain('plan-1');
    expect(markup).not.toContain('instance-1');
  });

  it('renders Task forecast expiry, windows and best-effort semantics without claiming a lock', () => {
    const evidence: React.ComponentProps<typeof TaskReadinessPanel>['evidence'] = {
      warning: 'Provider forecast only; no resource lock.',
      items: [
        {
          readiness: {
            readinessId: 'readiness-1',
            checkPhase: 'planning',
            disposition: 'confirmation_required',
            guardAction: 'request_confirmation',
            confirmationRequired: true,
            createdAt: '2026-07-16T22:00:00.000Z',
          },
          snapshots: [
            {
              snapshotId: 'snapshot-1',
              nodeId: 'patrol',
              operationName: 'vehicle_patrol',
              argumentsHash: 'a'.repeat(64),
              availability: 'restricted',
              riskLevel: 'high',
              validUntil: '2026-07-16T22:10:00.000Z',
              earliestStartTime: '2026-07-16T22:02:00.000Z',
              nextAvailableWindows: [
                {
                  startTime: '2026-07-16T22:02:00.000Z',
                  endTime: '2026-07-16T22:12:00.000Z',
                },
              ],
              reservationMode: 'best_effort',
              checkedAt: '2026-07-16T22:00:00.000Z',
            },
          ],
        },
      ],
    };
    const markup = renderToStaticMarkup(<TaskReadinessPanel evidence={evidence} />);
    expect(markup).toContain('2026-07-16T22:10:00.000Z');
    expect(markup).toContain('best_effort');
    expect(markup).toContain('forecast only');
    expect(markup).not.toContain('Guaranteed reservation');
  });

  it('edits Workflow topology as restricted data while preserving node configuration', () => {
    const original = JSON.stringify({
      workflowDefinitionId: 'workflow.test',
      version: 1,
      goalId: 'goal.test',
      goalVersion: 1,
      entryNodeId: 'node.a',
      exitNodeIds: ['node.b'],
      nodes: [
        { nodeId: 'node.a', name: 'Start', type: 'llm', configuration: { prompt: 'safe' } },
        { nodeId: 'node.b', name: 'Finish', type: 'result' },
      ],
      edges: [{ sourceNodeId: 'node.a', targetNodeId: 'node.b' }],
    });
    const renamed = applyVisualWorkflowEdit(original, {
      kind: 'rename_node',
      nodeId: 'node.a',
      name: 'Reviewed start',
    });
    const withEdge = applyVisualWorkflowEdit(renamed, { kind: 'add_edge' });
    const edited = applyVisualWorkflowEdit(withEdge, {
      kind: 'update_edge',
      edgeIndex: 1,
      field: 'outcome',
      value: 'approved',
    });
    const parsed: unknown = JSON.parse(edited);
    expect(parsed).toMatchObject({
      nodes: [
        {
          name: 'Reviewed start',
          configuration: { prompt: 'safe' },
        },
        { name: 'Finish' },
      ],
      edges: [{}, { outcome: 'approved' }],
    });
    expect(parseVisualWorkflowDefinition(edited)?.edges).toHaveLength(2);
    expect(parseVisualWorkflowDefinition('{')).toBeUndefined();
  });

  it('renders the reverse Workflow-to-Task link from an authoritative lookup', () => {
    const markup = renderToStaticMarkup(
      <WorkflowTaskLink taskId="task.test" onOpenTask={() => undefined} />,
    );
    expect(markup).toContain('Open owning Task · task.test');
  });

  it('renders persisted Workflow node duration in the execution replay', () => {
    const markup = renderToStaticMarkup(<WorkflowEventDuration durationMs={125} />);
    expect(markup).toContain('Node duration · 125 ms');
  });

  it('renders a Task trace root without fabricated linked evidence', () => {
    const markup = renderToStaticMarkup(<TaskPanel />);
    expect(markup).toContain('Task ID');
    expect(markup).toContain('CORRELATED TRACE ROOT');
    expect(markup).toContain('POSTGRESQL TASK INVENTORY');
    expect(markup).toContain('Refresh inventory');
    expect(markup).toContain('Goal ID');
    expect(markup).not.toContain('task-1');
    expect(markup).not.toContain('goal-1');
  });

  it('renders Provider-authoritative remote lifecycle evidence and constrained operations', () => {
    const markup = renderToStaticMarkup(
      <RemoteTaskLifecyclePanel
        value={{
          warnings: [
            'Trusted-intranet V1 has no authentication.',
            'Cancellation acknowledgement is not Provider cancellation.',
          ],
          items: [
            {
              binding: {
                bindingId: 'binding-1',
                serverId: 'mcp.devices',
                operationName: 'device_patrol',
                remoteTaskId: 'provider-task-1',
                protocolStatus: 'input_required',
                providerSubstate: 'paused',
                localState: 'awaiting_input',
                requestedTiming: { start: { mode: 'immediate' }, maxElapsedMs: 60_000 },
                nextPollAt: '2026-07-17T00:00:05.000Z',
                pollAttempt: 2,
                providerFailureCount: 0,
                version: 3,
                workflowInstanceId: 'instance-1',
                workflowNodeRunId: 'patrol:1',
                mcpInvocationId: 'invocation-1',
              },
              capability: { status: 'registered', taskExecution: { revision: '1.0' } },
              availability: [{ availability: 'restricted', riskLevel: 'high' }],
              observations: [{ sequence: 1 }],
              controls: [{ type: 'task.input_required' }],
              protocolAttempts: [{ method: 'tasks/get' }],
              continuations: [{ lifecycle: 'active' }],
              inputRounds: [
                {
                  link: { inputRequestId: 'input-1', status: 'waiting' },
                  question: 'Approve patrol?',
                  requestStatus: 'waiting',
                  attempts: [],
                },
              ],
              cancellations: [
                {
                  request: {
                    requestId: 'cancel-1',
                    deliveryStatus: 'uncertain',
                    lastSafeErrorCode: 'MCP_TASK_CANCEL_PROVIDER_UNREACHABLE',
                  },
                  attempts: [{}],
                },
              ],
              finalOutcome: { providerStatus: 'input_required', authoritative: false },
            },
          ],
        }}
        onRefresh={() => undefined}
        onRefreshBinding={() => undefined}
        onCancelBinding={() => undefined}
      />,
    );
    expect(markup).toContain('POSTGRESQL REMOTE TASK AUTHORITY');
    expect(markup).toContain('Provider input_required / paused');
    expect(markup).toContain('Approve patrol?');
    expect(markup).toContain('delivery uncertain');
    expect(markup).toContain('not observed');
    expect(markup).toContain('Observe Provider once (version-CAS)');
    expect(markup).toContain('Request cooperative Provider cancellation');
    expect(markup).toContain('Trusted-intranet V1 has no authentication');
  });

  it('renders a Goal-to-Task-history entry from an authoritative Goal identity', () => {
    const markup = renderToStaticMarkup(
      <GoalTaskNavigation goalId="goal.test" onExploreGoal={() => undefined} />,
    );
    expect(markup).toContain('Explore Goal Tasks · goal.test');
  });

  it('renders one-click Task links to authoritative Workflow and Skill identities', () => {
    const markup = renderToStaticMarkup(
      <TaskRelatedNavigation
        task={{
          taskId: 'task.test',
          contextId: 'context.test',
          phase: 'planning',
          phaseMessage: 'Planned.',
          planId: 'plan.test',
          selectedSkillId: 'skill.test',
        }}
        onNavigate={() => undefined}
      />,
    );
    expect(markup).toContain('Open Workflow · plan.test');
    expect(markup).toContain('Open Skill · skill.test');
  });

  it('renders one-click Task evidence links to MCP, model, and filtered Evaluation', () => {
    const markup = renderToStaticMarkup(
      <TaskEvidenceNavigation
        task={{
          taskId: 'task.test',
          contextId: 'context.test',
          phase: 'completed',
          phaseMessage: 'Done.',
          selectedSkillId: 'skill.test',
        }}
        evidence={[
          {
            key: 'mcp',
            label: 'MCP',
            endpoint: '/mcp',
            value: { items: [{ serverId: 'mcp.test', toolName: 'read' }] },
          },
          {
            key: 'models',
            label: 'Models',
            endpoint: '/models',
            value: { items: [{ providerId: 'provider.test', model: 'model.test' }] },
          },
        ]}
        onNavigate={() => undefined}
      />,
    );
    expect(markup).toContain('Open MCP Tool · mcp.test / read');
    expect(markup).toContain('Open Model · provider.test / model.test');
    expect(markup).toContain('Open Evaluation · skill.test');
  });

  it('renders focused MCP/model/Evaluation destinations and Memory source Task links', () => {
    const markup = [
      <McpPanel key="mcp" focusServerId="mcp.test" focusToolName="read" />,
      <SystemPanel key="system" focusProviderId="provider.test" focusModel="model.test" />,
      <EvaluationPanel key="evaluation" initialSkillId="skill.test" />,
      <MemorySourceNavigation
        key="memory"
        value={{ sourceRefs: ['task:task.test', 'processed-result:result.test'] }}
        onOpenTask={() => undefined}
      />,
    ]
      .map((item) => renderToStaticMarkup(item))
      .join('');
    expect(markup).toContain('Linked MCP Tool: mcp.test / read');
    expect(markup).toContain('Linked model Provider: provider.test / model.test');
    expect(markup).toContain('value="skill.test"');
    expect(markup).toContain('Open source Task · task.test');
    expect(markup).not.toContain('Open source Task · result.test');
  });

  it('executes the one-click Skill-to-Task callback with the authoritative Skill identity', () => {
    const opened: string[] = [];
    const element = SkillTaskNavigation({
      skillId: 'skill.test',
      onExploreTasks: (skillId) => opened.push(skillId),
    });
    if (element === null) throw new Error('SKILL_TASK_NAVIGATION_MISSING');
    openRelatedSkillTasks('skill.test', (skillId) => opened.push(skillId));
    expect(opened).toEqual(['skill.test']);
    expect(renderToStaticMarkup(element)).toContain('Open related Tasks · skill.test');
  });

  it('renders Prompt, Memory, and Evaluation controls without operational fixtures', () => {
    const markup = [
      <PromptPanel key="prompt" />,
      <MemoryPanel key="memory" />,
      <EvaluationPanel key="evaluation" />,
    ]
      .map((panel) => renderToStaticMarkup(panel))
      .join('');
    expect(markup).toContain('Prompt Lifecycle');
    expect(markup).toContain('anonymous shared');
    expect(markup).toContain('Volatile device state and unknown durability are rejected');
    expect(markup).toContain('warning-only policy');
    expect(markup).toContain('FILTERED OPERATING METRICS');
    expect(markup).toContain('skill_input_resolution');
    expect(markup).not.toContain('66.67%');
    expect(markup).not.toContain('prompt-1');
    expect(markup).not.toContain('memory-1');
  });

  it('renders the complete Skill authoring, simulation, version, and graph control surface', () => {
    const markup = renderToStaticMarkup(<SkillStudio onRegistryChanged={() => undefined} />);
    expect(markup).toContain('Generate Schemas and validate');
    expect(markup).toContain('Simulation / Correction');
    expect(markup).toContain('Compare immutable versions');
    expect(markup).toContain('SKILL GRAPH');
  });

  it('renders credential-safe Provider, fixed-route, policy, and invocation operations', () => {
    const markup = renderToStaticMarkup(<SystemPanel />);
    expect(markup).toContain('Providers &amp; Stage Routes');
    expect(markup).toContain('write-only JSON');
    expect(markup).toContain('Update wait policy');
    expect(markup).toContain('Update retention values');
    expect(markup).toContain('Update evolution threshold');
    expect(markup).toContain('Automatic archive: OFF');
    expect(markup).toContain('Automatic archive and delete remain disabled');
    expect(markup).toContain('SANITIZED MODEL INVOCATIONS');
    expect(markup).toContain('skill_input_resolution');
    expect(markup).not.toContain('Bearer fixture');
  });

  it('renders operational evaluation KPIs, failure bars, stability, and quality trend', () => {
    const markup = renderToStaticMarkup(
      <OperationsDashboard
        onOpenTask={() => undefined}
        analytics={{
          sampleCount: 3,
          successCount: 2,
          successRate: 2 / 3,
          averageDurationMs: 200,
          totalCost: 9,
          averageCost: 3,
          failureTypes: [{ code: 'MCP_TIMEOUT', count: 1 }],
          mcpUsage: [
            {
              serverId: 'mcp.test',
              toolName: 'read',
              invocationCount: 2,
              successRate: 0.5,
              averageDurationMs: 40,
            },
          ],
          modelEffects: [
            {
              providerId: 'provider.test',
              model: 'model.test',
              invocationCount: 2,
              successRate: 0.5,
              averageDurationMs: 20,
              averageTokens: 30,
            },
          ],
          versionStability: [
            {
              skillId: 'skill.test',
              skillVersion: 2,
              sampleCount: 3,
              successRate: 2 / 3,
              averageQuality: 0.8,
              qualityDeviation: 0.1,
              stabilityScore: 0.6,
            },
          ],
          qualityTrend: [
            {
              reportId: 'report.test',
              taskId: 'task.test',
              instanceId: 'instance.test',
              score: 0.8,
              status: 'passed',
              createdAt: '2026-07-13T00:00:00.000Z',
            },
          ],
          capabilityGrowth: [
            {
              skillId: 'skill.test',
              observedVersions: 2,
              firstVersion: 1,
              latestVersion: 2,
              sampleCount: 3,
              successfulSamples: 2,
            },
          ],
          optimizationSuggestions: [
            {
              code: 'review_tool',
              severity: 'warning',
              target: 'mcp.test.read',
              summary: 'Review Tool reliability.',
              evidenceCount: 2,
            },
          ],
        }}
      />,
    );
    expect(markup).toContain('Success rate');
    expect(markup).toContain('FAILURE TYPES');
    expect(markup).toContain('MCP_TIMEOUT');
    expect(markup).toContain('VERSION STABILITY');
    expect(markup).toContain('QUALITY TREND');
    expect(markup).toContain('MCP USAGE');
    expect(markup).toContain('MODEL EFFECTS');
    expect(markup).toContain('CAPABILITY GROWTH');
    expect(markup).toContain('AUTOMATIC OPTIMIZATION SUGGESTIONS');
    expect(markup).toContain('Raw analytics evidence');
    expect(markup).toContain('Open Task');
  });

  it('renders reverse MCP/model invocation links from persisted taskId fields', () => {
    const markup = renderToStaticMarkup(
      <TaskReferenceLinks
        value={{ items: [{ taskId: 'task.two' }, { taskId: 'task.one' }] }}
        onOpenTask={() => undefined}
      />,
    );
    expect(markup).toContain('Open related Task · task.one');
    expect(markup).toContain('Open related Task · task.two');
  });
});
