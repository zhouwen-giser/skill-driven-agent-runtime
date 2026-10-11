import type { TaskBusinessOperationPolicy } from '../../application/src/task-business-operation-policy.js';

/** Profile support only. The original TaskBusiness command service retains all authorization checks. */
export const UGV_TASK_BUSINESS_OPERATION_POLICY: TaskBusinessOperationPolicy = Object.freeze({
  navigationAdjustmentOperationName: 'vehicle_navigate',
  supportsMutation: (operationName: string) =>
    operationName === 'vehicle_navigate' || operationName === 'vehicle_area_recon',
});
