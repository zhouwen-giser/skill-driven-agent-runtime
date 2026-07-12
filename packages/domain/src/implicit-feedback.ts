export type ImplicitFeedbackKind =
  | 'accepted_result'
  | 'continued_modification'
  | 'repeated_submission'
  | 'requested_redo'
  | 'switched_skill';

export interface ImplicitFeedbackRecord {
  readonly feedbackId: string;
  readonly kind: ImplicitFeedbackKind;
  readonly sourceTaskId: string;
  readonly triggerTaskId: string;
  readonly contextId: string;
  readonly confidence: number;
  readonly evidenceSummary: string;
  readonly createdAt: string;
}
