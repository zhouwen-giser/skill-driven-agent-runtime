import { FROZEN_TASK_BUSINESS_OPERATION_CONTRACT } from '../../domain/src/task-business-operation-contract.js';

export interface TaskBusinessOperationPolicy {
  readonly navigationAdjustmentOperationName: string;
  supportsMutation(operationName: string): boolean;
}
const navigationOperation = Object.entries(FROZEN_TASK_BUSINESS_OPERATION_CONTRACT).find(
  ([, declaration]) => declaration.navigationAdjustment,
)?.[0];
if (navigationOperation === undefined)
  throw new Error('TASK_BUSINESS_NAVIGATION_CONTRACT_REQUIRED');
/** Compatibility default is frozen contract lookup; deployments inject their reviewed profile policy. */
export const FROZEN_TASK_BUSINESS_OPERATION_POLICY: TaskBusinessOperationPolicy = Object.freeze({
  navigationAdjustmentOperationName: navigationOperation,
  supportsMutation: (operationName: string) =>
    Object.hasOwn(FROZEN_TASK_BUSINESS_OPERATION_CONTRACT, operationName) &&
    FROZEN_TASK_BUSINESS_OPERATION_CONTRACT[operationName]?.mutation === true,
});
