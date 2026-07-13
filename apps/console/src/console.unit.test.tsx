import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';
import { WorkflowPanel } from './WorkflowPanel.js';
import { TaskPanel } from './TaskPanel.js';
import { PromptPanel } from './PromptPanel.js';
import { MemoryPanel } from './MemoryPanel.js';
import { EvaluationPanel, OperationsDashboard } from './EvaluationPanel.js';
import { SkillStudio } from './SkillStudio.js';
import { SystemPanel } from './SystemPanel.js';

describe('operational console static accessibility contract', () => {
  it('renders navigation and the persistent trusted-intranet warning without authentication', () => {
    const markup = renderToStaticMarkup(<App />);
    expect(markup).toContain('aria-label="主导航"');
    expect(markup).toContain('trusted-intranet-only-no-auth');
    expect(markup).toContain('Do not expose publicly');
  });

  it('renders labeled real-record lookups without static Workflow records', () => {
    const markup = renderToStaticMarkup(<WorkflowPanel />);
    expect(markup).toContain('Plan ID');
    expect(markup).toContain('Instance ID');
    expect(markup).not.toContain('plan-1');
    expect(markup).not.toContain('instance-1');
  });

  it('renders a Task trace root without fabricated linked evidence', () => {
    const markup = renderToStaticMarkup(<TaskPanel />);
    expect(markup).toContain('Task ID');
    expect(markup).toContain('CORRELATED TRACE ROOT');
    expect(markup).toContain('POSTGRESQL TASK INVENTORY');
    expect(markup).toContain('Refresh inventory');
    expect(markup).not.toContain('task-1');
    expect(markup).not.toContain('goal-1');
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
    expect(markup).toContain('warning-only policy');
    expect(markup).toContain('FILTERED OPERATING METRICS');
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
    expect(markup).not.toContain('Bearer fixture');
  });

  it('renders operational evaluation KPIs, failure bars, stability, and quality trend', () => {
    const markup = renderToStaticMarkup(
      <OperationsDashboard
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
  });
});
