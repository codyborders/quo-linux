'use strict';

function createRetryController({
  clearTimer,
  delaysMs,
  onError = console.error,
  reload,
  setTimer,
  stableMs,
}) {
  let attemptCount = 0;
  let retryDelayMs = null;
  let retryTimer = null;
  let stableTimer = null;
  let stopped = false;

  function clearRetryTimer() {
    if (retryTimer === null) return;
    clearTimer(retryTimer);
    retryTimer = null;
    retryDelayMs = null;
  }

  function clearStableTimer() {
    if (stableTimer === null) return;
    clearTimer(stableTimer);
    stableTimer = null;
  }

  return {
    markLoaded() {
      if (stopped) return;
      clearRetryTimer();
      clearStableTimer();
      stableTimer = setTimer(() => {
        stableTimer = null;
        attemptCount = 0;
      }, stableMs);
    },
    scheduleRetry() {
      if (stopped) {
        return { attempt: attemptCount, delayMs: null, scheduled: false };
      }
      clearStableTimer();
      if (retryTimer !== null) {
        return { attempt: attemptCount, delayMs: retryDelayMs, scheduled: false };
      }
      if (attemptCount >= delaysMs.length) {
        return { attempt: attemptCount, delayMs: null, scheduled: false };
      }

      retryDelayMs = delaysMs[attemptCount];
      attemptCount += 1;
      retryTimer = setTimer(() => {
        retryTimer = null;
        retryDelayMs = null;
        try {
          Promise.resolve(reload()).catch(onError);
        } catch (error) {
          onError(error);
        }
      }, retryDelayMs);
      return { attempt: attemptCount, delayMs: retryDelayMs, scheduled: true };
    },
    stop() {
      stopped = true;
      clearRetryTimer();
      clearStableTimer();
    },
  };
}

module.exports = { createRetryController };
