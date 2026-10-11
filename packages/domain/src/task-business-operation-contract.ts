/** Frozen compatibility declarations; feature support never grants execution or confirmation authority. */
export const FROZEN_TASK_BUSINESS_OPERATION_CONTRACT: Readonly<
  Record<string, Readonly<{ mutation: boolean; navigationAdjustment: boolean }>>
> = Object.freeze({
  vehicle_navigate: Object.freeze({ mutation: true, navigationAdjustment: true }),
  vehicle_area_recon: Object.freeze({ mutation: true, navigationAdjustment: false }),
});
