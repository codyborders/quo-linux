'use strict';

// These tests drive retry and crash recovery through deterministic timer boundaries.
const test = require('node:test');
const assert = require('node:assert/strict');

const { createRetryController } = require('../lib/recovery-controller');

function createFakeTimers() {
  let nextId = 1;
  const timers = new Map();

  return {
    clearTimer(id) {
      timers.delete(id);
    },
    runTimerWithDelay(delayMs) {
      const match = [...timers].find(([, timer]) => timer.delayMs === delayMs);
      assert.ok(match, `missing timer with delay ${delayMs}`);
      const [id, timer] = match;
      timers.delete(id);
      timer.callback();
    },
    setTimer(callback, delayMs) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, delayMs });
      return id;
    },
    timerCount() {
      return timers.size;
    },
  };
}

test('network retry uses one bounded backoff and resets after a stable load', () => {
  const timers = createFakeTimers();
  let reloadCount = 0;
  const controller = createRetryController({
    clearTimer: timers.clearTimer,
    delaysMs: [20, 40],
    reload: () => {
      reloadCount += 1;
    },
    setTimer: timers.setTimer,
    stableMs: 100,
  });

  assert.deepEqual(controller.scheduleRetry(), { attempt: 1, delayMs: 20, scheduled: true });
  assert.deepEqual(controller.scheduleRetry(), { attempt: 1, delayMs: 20, scheduled: false });
  assert.equal(timers.timerCount(), 1);

  timers.runTimerWithDelay(20);
  assert.equal(reloadCount, 1);
  assert.deepEqual(controller.scheduleRetry(), { attempt: 2, delayMs: 40, scheduled: true });

  controller.markLoaded();
  assert.equal(timers.timerCount(), 1);
  timers.runTimerWithDelay(100);
  assert.deepEqual(controller.scheduleRetry(), { attempt: 1, delayMs: 20, scheduled: true });

  timers.runTimerWithDelay(20);
  assert.deepEqual(controller.scheduleRetry(), { attempt: 2, delayMs: 40, scheduled: true });
  timers.runTimerWithDelay(40);
  assert.deepEqual(controller.scheduleRetry(), { attempt: 2, delayMs: null, scheduled: false });
});

test('stopping retry recovery cancels every timer and blocks new work', () => {
  const timers = createFakeTimers();
  let reloadCount = 0;
  const controller = createRetryController({
    clearTimer: timers.clearTimer,
    delaysMs: [20],
    reload: () => {
      reloadCount += 1;
    },
    setTimer: timers.setTimer,
    stableMs: 100,
  });

  controller.scheduleRetry();
  controller.stop();

  assert.equal(timers.timerCount(), 0);
  assert.deepEqual(controller.scheduleRetry(), { attempt: 1, delayMs: null, scheduled: false });
  assert.equal(reloadCount, 0);
});

test('retry reload failures reach the non-fatal error handler', () => {
  const timers = createFakeTimers();
  const reloadError = new Error('reload failed');
  const capturedErrors = [];
  const controller = createRetryController({
    clearTimer: timers.clearTimer,
    delaysMs: [20],
    onError: (error) => capturedErrors.push(error),
    reload: () => {
      throw reloadError;
    },
    setTimer: timers.setTimer,
    stableMs: 100,
  });

  controller.scheduleRetry();
  assert.doesNotThrow(() => timers.runTimerWithDelay(20));
  assert.deepEqual(capturedErrors, [reloadError]);
});
