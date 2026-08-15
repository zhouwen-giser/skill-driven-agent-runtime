import { describe, expect, it, vi } from 'vitest';

import {
  executeWithFinallyRestoration,
  releaseGovernedControlAtPausedBarrier,
  runHomeLabG09GovernedLight,
} from '../src/home-lab-g09-governed-light-driver.js';

describe('home-lab G09 governed-light driver', () => {
  it('holds plan confirmation open until zero-call checks, exact issuance and barrier resume', async () => {
    const order: string[] = [];
    let completePlan: ((value: string) => void) | undefined;
    let zeroChecks = 0;
    const result = releaseGovernedControlAtPausedBarrier({
      taskId: 'task-g09',
      planId: 'plan-g09',
      expectedPower: 'off',
      assertZeroMcpInvocations: () => {
        order.push(`zero-${String(++zeroChecks)}`);
        return Promise.resolve();
      },
      confirmPlan: () => {
        order.push('confirm-plan-started');
        return new Promise<string>((resolvePromise) => {
          completePlan = resolvePromise;
        });
      },
      waitForBarrier: () => {
        order.push('barrier-observed');
        return Promise.resolve({
          instance: {
            instanceId: 'instance-g09',
            planId: 'plan-g09',
            status: 'paused',
            pendingConfirmation: {
              nodeId: 'confirmControl',
              kind: 'human_confirmation',
              prompt:
                'Resume only after the exact task-scoped governed-control confirmation is issued.',
            },
          },
        });
      },
      issueConfirmation: () => {
        order.push('governed-confirmation-issued');
        return Promise.resolve({
          confirmation: { confirmationId: 'confirmation-g09' },
          authority: {
            taskId: 'task-g09',
            planId: 'plan-g09',
            capabilityBindingId: 'capability-binding-home.light.set-power-v2',
            capabilityId: 'home.light.set-power',
            capabilityVersion: 2,
            skillId: 'home.light.set-power',
            skillVersion: 2,
            providerBindingId: 'mcp-binding-ha-light-g09',
            serverId: 'home-lab-light-mcp-g09',
            toolName: 'light_set_power',
            arguments: { resourceId: 'living-room-main-light', power: 'off' },
          },
        });
      },
      resume: (instanceId) => {
        order.push(`resume:${instanceId}`);
        completePlan?.('confirmed-task');
        return Promise.resolve({ status: 'waiting_external' });
      },
    });

    await expect(result).resolves.toEqual({
      task: 'confirmed-task',
      instanceId: 'instance-g09',
      confirmationId: 'confirmation-g09',
    });
    expect(order).toEqual([
      'zero-1',
      'confirm-plan-started',
      'barrier-observed',
      'zero-2',
      'governed-confirmation-issued',
      'resume:instance-g09',
    ]);
  });

  it('runs restoration from finally after dispatch release even when the primary path fails', async () => {
    const order: string[] = [];
    await expect(
      executeWithFinallyRestoration({
        executeSet: async (release) => {
          order.push('set-start');
          release();
          order.push('dispatch-released');
          throw new Error('provider result processing failed');
        },
        executeRestore: () => {
          order.push('restore');
          return Promise.resolve('restored');
        },
      }),
    ).rejects.toThrow('provider result processing failed');
    expect(order).toEqual(['set-start', 'dispatch-released', 'restore']);
  });

  it('does not create a restoration Task when failure occurs before dispatch release', async () => {
    const restore = vi.fn(() => Promise.resolve('restored'));
    await expect(
      executeWithFinallyRestoration({
        executeSet: () => Promise.reject(new Error('plan rejected')),
        executeRestore: restore,
      }),
    ).rejects.toThrow('plan rejected');
    expect(restore).not.toHaveBeenCalled();
  });

  it('requires both write-gate variables closed before dry-run makes any HTTP request', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      runHomeLabG09GovernedLight(
        {
          mode: 'dry-run',
          a2aBaseUrl: 'http://127.0.0.1:29999',
          runtimeManagementBaseUrl: 'http://127.0.0.1:29998',
          nodeControlBaseUrl: 'http://127.0.0.1:20080',
          nodeControlBearerToken: 'node-control-token',
          runId: 'g09-unit-run-0001',
        },
        {
          fetch: request,
          environment: { ALLOW_REAL_DEVICE_SIDE_EFFECTS: 'YES' },
        },
      ),
    ).rejects.toMatchObject({ code: 'G09_DRY_RUN_WRITE_GATE_OPEN' });
    expect(request).not.toHaveBeenCalled();
  });
});
