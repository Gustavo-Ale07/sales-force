/** RT-1: the API process opens the event channel only when its entry point says so (tests and the worker leave it off). */
export const EVENT_STREAM_ENABLED = Symbol('EVENT_STREAM_ENABLED');
export const EVENT_STREAM_LIMITS = Symbol('EVENT_STREAM_LIMITS');

export interface EventStreamLimits {
  readonly perAccount: number;
  readonly total: number;
}
