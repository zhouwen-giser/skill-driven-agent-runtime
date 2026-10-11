import { describe, expect, it } from 'vitest';
import { FROZEN_TASK_BUSINESS_OPERATION_POLICY } from '../../../packages/application/src/task-business-operation-policy.js';
import { UGV_TASK_BUSINESS_OPERATION_POLICY } from '../../../packages/ugv-profile/src/index.js';

describe('TaskBusiness operation profile', () => {
  it.each(['vehicle_navigate', 'vehicle_area_recon', 'vehicle_fire_weapon', 'other_operation'])(
    'preserves frozen support and denies undeclared operations (%s)',
    (operation) => {
      expect(UGV_TASK_BUSINESS_OPERATION_POLICY.supportsMutation(operation)).toBe(
        FROZEN_TASK_BUSINESS_OPERATION_POLICY.supportsMutation(operation),
      );
      expect(UGV_TASK_BUSINESS_OPERATION_POLICY.supportsMutation(operation)).toBe(
        operation === 'vehicle_navigate' || operation === 'vehicle_area_recon',
      );
    },
  );
  it('retains the exact navigation adjustment scope without adding lifecycle writers', () => {
    expect(UGV_TASK_BUSINESS_OPERATION_POLICY.navigationAdjustmentOperationName).toBe(
      'vehicle_navigate',
    );
    expect(Object.keys(UGV_TASK_BUSINESS_OPERATION_POLICY).sort()).toEqual([
      'navigationAdjustmentOperationName',
      'supportsMutation',
    ]);
  });
});
