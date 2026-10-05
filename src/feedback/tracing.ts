/* eslint-disable @typescript-eslint/naming-convention */
export const FeedbackSpanName = {
  MANAGER_CREATE_FEEDBACK: 'feedback.manager.create_feedback',
  MANAGER_GET_GEOCODING_RESPONSE: 'feedback.manager.get_geocoding_response',
  MANAGER_SEND: 'feedback.manager.send',
} as const;

export type FeedbackSpanName = (typeof FeedbackSpanName)[keyof typeof FeedbackSpanName];

export const FeedbackAttributes = {
  REQUEST_ID: 'feedback.request_id',
  CHOSEN_RESULT_ID: 'feedback.chosen_result_id',
  NO_CHOSEN_RESULT: 'feedback.no_chosen_result',
  GEOCODING_SITE: 'feedback.geocoding.site',
  GEOCODING_WAS_USED: 'feedback.geocoding.was_used',
} as const;

export type FeedbackAttributes = (typeof FeedbackAttributes)[keyof typeof FeedbackAttributes];
