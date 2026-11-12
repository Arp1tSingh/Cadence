/**
 * Queued TTS jobs are dropped whenever playback moves (seek, voice change,
 * pause). The rejection is an expected control-flow signal, not a failure, so
 * both the worker and the player session share this marker.
 */
export const JOB_CANCELLED = 'CadenceJobCancelled';

export function createJobCancelledError(): Error {
  const error = new Error('The narration job was cancelled.');
  error.name = JOB_CANCELLED;
  return error;
}

export function isJobCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === JOB_CANCELLED;
}
