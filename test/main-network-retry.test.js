'use strict';

// This test starts the entrypoint and verifies that network recovery has a finite budget.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

class FakeWebContents extends EventEmitter {
  invalidate() {}
  setWindowOpenHandler() {}
}

class FakeWindow extends EventEmitter {
  constructor() {
    super();
    this.webContents = new FakeWebContents();
    FakeWindow.instance = this;
    FakeWindow.app.emit('web-contents-created', {}, this.webContents);
  }
  getBounds() { return { x: 0, y: 0, width: 1280, height: 860 }; }
  hide() {}
  isDestroyed() { return false; }
  isMinimized() { return false; }
  isVisible() { return true; }
  loadURL() {
    this.loadCount = (this.loadCount || 0) + 1;
    return Promise.resolve();
  }
  focus() {}
  show() {}
}

class FakeTray extends EventEmitter {
  setContextMenu() {}
  setToolTip() {}
}

function createFakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    clear(id) { timers.delete(id); },
    count() { return timers.size; },
    run(delayMs) {
      const match = [...timers].find(([, timer]) => timer.delayMs === delayMs);
      assert.ok(match, `missing timer with delay ${delayMs}`);
      const [id, timer] = match;
      timers.delete(id);
      timer.callback();
    },
    set(callback, delayMs) {
      const id = nextId++;
      timers.set(id, { callback, delayMs });
      return id;
    },
  };
}

async function waitFor(condition, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

function createElectron(userDataPath) {
  const app = new EventEmitter();
  const dialogCalls = [];
  app.getPath = () => userDataPath;
  app.quit = () => {};
  app.requestSingleInstanceLock = () => true;
  app.whenReady = () => Promise.resolve();
  FakeWindow.app = app;

  return {
    app,
    BrowserWindow: FakeWindow,
    dialog: {
      calls: dialogCalls,
      async showMessageBox(window, options) {
        dialogCalls.push([window, options]);
        return { response: 1 };
      },
    },
    Menu: { buildFromTemplate: () => ({}) },
    nativeImage: { createFromPath: () => ({ resize() { return this; } }) },
    powerMonitor: new EventEmitter(),
    screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] },
    session: {
      defaultSession: {
        setPermissionCheckHandler() {},
        setPermissionRequestHandler() {},
      },
    },
    shell: { openExternal: async () => {} },
    Tray: FakeTray,
  };
}

test('main-frame network retries stop after five attempts', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'quo-retry-test-'));
  const electron = createElectron(userDataPath);
  const timers = createFakeTimers();
  const originalClearTimeout = global.clearTimeout;
  const originalSetTimeout = global.setTimeout;
  const originalLoad = Module._load;
  global.clearTimeout = timers.clear;
  global.setTimeout = timers.set;
  Module._load = function load(request, parent, isMain) {
    return request === 'electron' ? electron : originalLoad.call(this, request, parent, isMain);
  };

  try {
    require('../main');
    await waitFor(() => Boolean(FakeWindow.instance), 'main window was not created');

    const emitFailure = () => FakeWindow.instance.webContents.emit(
      'did-fail-load',
      {},
      -105,
      'NAME_NOT_RESOLVED',
      'https://my.quo.com',
      true
    );
    emitFailure();
    for (const delayMs of [2000, 4000, 8000, 16000, 30000]) {
      timers.run(delayMs);
      emitFailure();
    }

    assert.equal(FakeWindow.instance.loadCount, 6);
    assert.equal(timers.count(), 0);
  } finally {
    electron.app.emit('before-quit', { preventDefault() {} });
    Module._load = originalLoad;
    global.clearTimeout = originalClearTimeout;
    global.setTimeout = originalSetTimeout;
    await new Promise((resolve) => originalSetTimeout(resolve, 50));
    fs.rmSync(userDataPath, { force: true, recursive: true });
  }
});
