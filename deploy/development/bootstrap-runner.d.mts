export interface BootstrapResult {
  status: 'failed' | 'disabled' | 'registered';
  reasonCode?: string;
  failedStage?: string;
  completedStages: string[];
  blocked: readonly unknown[];
  deviceCalls: number;
}
export function runGovernanceBootstrap(
  configuration: Record<string, string>,
  stages: Record<string, () => Promise<unknown>>,
): Promise<BootstrapResult>;
