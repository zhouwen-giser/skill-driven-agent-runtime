import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';
import { WorkflowPanel } from './WorkflowPanel.js';
import { TaskPanel } from './TaskPanel.js';
import { PromptPanel } from './PromptPanel.js';
import { MemoryPanel } from './MemoryPanel.js';
import { EvaluationPanel } from './EvaluationPanel.js';
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
    expect(markup).toContain('Automatic archive and delete remain disabled');
    expect(markup).toContain('SANITIZED MODEL INVOCATIONS');
    expect(markup).not.toContain('Bearer fixture');
  });
});
