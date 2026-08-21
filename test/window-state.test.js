'use strict';

// These tests cover persisted window geometry and asynchronous storage behavior.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDebouncedStateSaver,
  createWindowStateStore,
  normalizeWindowBounds,
} = require('../lib/window-state');

const workAreas = [
  { x: 0, y: 0, width: 1920, height: 1080 },
  { x: -1280, y: 0, width: 1280, height: 1024 },
];

test('window bounds stay visible and use safe dimensions', () => {
  assert.deepEqual(
    normalizeWindowBounds({ x: 100, y: 80, width: 1000, height: 700 }, workAreas),
    { x: 100, y: 80, width: 1000, height: 700 }
  );
  assert.deepEqual(
    normalizeWindowBounds({ x: 5000, y: 5000, width: 1280, height: 860 }, workAreas),
    { x: 320, y: 110, width: 1280, height: 860 }
  );
  assert.deepEqual(
    normalizeWindowBounds({ x: 0, y: 0, width: 10000, height: 10000 }, workAreas),
    { x: 0, y: 0, width: 1920, height: 1080 }
  );
  assert.deepEqual(normalizeWindowBounds({ width: 'huge' }, workAreas), {
    x: 320,
    y: 110,
    width: 1280,
    height: 860,
  });
});

test('window state loads safely and saves through an atomic asynchronous write', async () => {
  const operations = [];
  const fileSystem = {
    async readFile(filePath, encoding) {
      operations.push(['readFile', filePath, encoding]);
      return '{"x":5000,"y":5000,"width":1280,"height":860}';
    },
    async rename(source, target) {
      operations.push(['rename', source, target]);
    },
    async rm(filePath, options) {
      operations.push(['rm', filePath, options]);
    },
    async writeFile(filePath, contents, options) {
      operations.push(['writeFile', filePath, contents, options]);
    },
  };
  const store = createWindowStateStore({
    filePath: '/config/window-state.json',
    fileSystem,
    processId: 42,
  });

  assert.deepEqual(await store.load(workAreas), {
    x: 320,
    y: 110,
    width: 1280,
    height: 860,
  });
  await store.save({ x: 100, y: 80, width: 1000, height: 700 });

  assert.deepEqual(operations, [
    ['readFile', '/config/window-state.json', 'utf8'],
    [
      'writeFile',
      '/config/window-state.json.42.tmp',
      '{"x":100,"y":80,"width":1000,"height":700}',
      { encoding: 'utf8', flag: 'w', mode: 0o600 },
    ],
    ['rename', '/config/window-state.json.42.tmp', '/config/window-state.json'],
  ]);
});

test('failed state replacement removes its temporary file', async () => {
  const removedPaths = [];
  const replacementError = new Error('rename failed');
  const store = createWindowStateStore({
    filePath: '/config/window-state.json',
    fileSystem: {
      async readFile() {
        throw new Error('unused');
      },
      async rename() {
        throw replacementError;
      },
      async rm(filePath, options) {
        removedPaths.push([filePath, options]);
      },
      async writeFile() {},
    },
    processId: 42,
  });

  await assert.rejects(
    store.save({ x: 100, y: 80, width: 1000, height: 700 }),
    replacementError
  );
  assert.deepEqual(removedPaths, [
    ['/config/window-state.json.42.tmp', { force: true }],
  ]);
});

test('window state changes debounce and flush without blocking callers', async () => {
  let activeTimer = null;
  let bounds = { x: 10, y: 20, width: 1000, height: 700 };
  const savedBounds = [];
  const saver = createDebouncedStateSaver({
    clearTimer: (timer) => {
      if (activeTimer === timer) activeTimer = null;
    },
    delayMs: 50,
    getBounds: () => bounds,
    onError: assert.fail,
    save: async (nextBounds) => {
      savedBounds.push(nextBounds);
    },
    setTimer: (callback, delayMs) => {
      activeTimer = { callback, delayMs };
      return activeTimer;
    },
  });

  saver.schedule();
  bounds = { x: 30, y: 40, width: 1000, height: 700 };
  saver.schedule();
  assert.equal(activeTimer.delayMs, 50);
  activeTimer.callback();
  await saver.whenIdle();
  assert.deepEqual(savedBounds, [{ x: 30, y: 40, width: 1000, height: 700 }]);

  bounds = { x: 50, y: 60, width: 1000, height: 700 };
  saver.schedule();
  await saver.flush();
  assert.equal(activeTimer, null);
  assert.deepEqual(savedBounds[1], bounds);
});

test('window state capture errors reach the non-fatal error handler', async () => {
  let timerCallback;
  const captureError = new Error('window was destroyed');
  const capturedErrors = [];
  const saver = createDebouncedStateSaver({
    clearTimer: () => {},
    delayMs: 50,
    getBounds: () => {
      throw captureError;
    },
    onError: (error) => capturedErrors.push(error),
    save: async () => {},
    setTimer: (callback) => {
      timerCallback = callback;
      return 1;
    },
  });

  saver.schedule();
  assert.doesNotThrow(() => timerCallback());
  await saver.whenIdle();
  assert.deepEqual(capturedErrors, [captureError]);
});
