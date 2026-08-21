'use strict';

// This test starts the public entrypoint with an Electron API fake and checks security wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

class FakeWebContents extends EventEmitter {
  getURL() {
    return 'https://my.quo.com/calls';
  }

  invalidate() {}

  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }
}

class FakeBrowserWindow extends EventEmitter {
  static instances = [];

  constructor(options) {
    super();
    this.bounds = { x: 0, y: 0, width: 1280, height: 860 };
    this.options = options;
    this.webContents = new FakeWebContents();
    FakeBrowserWindow.instances.push(this);
    FakeBrowserWindow.app.emit('web-contents-created', {}, this.webContents);
  }

  getBounds() {
    return this.bounds;
  }

  hide() {}

  isDestroyed() {
    return false;
  }

  isMinimized() {
    return false;
  }

  isVisible() {
    return true;
  }

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

async function waitFor(condition, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

function createElectronFake() {
  const app = new EventEmitter();
  const openedUrls = [];
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'quo-linux-test-'));
  app.getPath = () => userDataPath;
  app.quitRequests = 0;
  app.quit = () => {
    app.quitRequests += 1;
  };
  app.requestSingleInstanceLock = () => true;
  app.whenReady = () => Promise.resolve();

  FakeBrowserWindow.app = app;
  const defaultSession = {
    setPermissionCheckHandler(handler) {
      this.permissionCheckHandler = handler;
    },
    setPermissionRequestHandler(handler) {
      this.permissionRequestHandler = handler;
    },
  };

  return {
    app,
    BrowserWindow: FakeBrowserWindow,
    dialog: { showMessageBox: async () => ({ response: 1 }) },
    Menu: { buildFromTemplate: () => ({}) },
    nativeImage: {
      createFromPath: () => ({
        isEmpty: () => false,
        resize() {
          return this;
        },
      }),
    },
    powerMonitor: new EventEmitter(),
    screen: {
      getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
    },
    session: { defaultSession },
    openedUrls,
    userDataPath,
    shell: {
      openExternal: async (url) => {
        openedUrls.push(url);
      },
    },
    Tray: FakeTray,
  };
}

test('entrypoint denies media requested by an attacker frame', async () => {
  const electronFake = createElectronFake();
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronFake;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    require('../main');
    await waitFor(
      () => FakeBrowserWindow.instances.length === 1,
      'main window was not created'
    );

    assert.deepEqual(FakeBrowserWindow.instances[0].options.webPreferences, {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    });

    let permissionResult = null;
    electronFake.session.defaultSession.permissionRequestHandler(
      FakeBrowserWindow.instances[0].webContents,
      'media',
      (allowed) => {
        permissionResult = allowed;
      },
      {
        mediaTypes: ['audio'],
        requestingUrl: 'https://my.quo.com.attacker.invalid/capture',
      }
    );

    assert.equal(permissionResult, false);
    assert.equal(
      typeof electronFake.session.defaultSession.permissionCheckHandler,
      'function'
    );

    const mainWebContents = FakeBrowserWindow.instances[0].webContents;
    assert.deepEqual(
      mainWebContents.windowOpenHandler({
        url: 'https://my.quo.com.attacker.invalid/capture',
      }),
      { action: 'deny' }
    );
    await Promise.resolve();
    assert.deepEqual(electronFake.openedUrls, []);

    mainWebContents.emit(
      'did-fail-load',
      {},
      -105,
      'NAME_NOT_RESOLVED',
      'https://my.quo.com/private?token=top-secret',
      true
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const recoveryLog = fs.readFileSync(
      path.join(electronFake.userDataPath, 'recovery.log'),
      'utf8'
    );
    assert.doesNotMatch(recoveryLog, /top-secret|\/private/);

    assert.doesNotThrow(() => FakeBrowserWindow.instances[0].emit('move'));
    await new Promise((resolve) => setTimeout(resolve, 350));

    const initialLoadCount = FakeBrowserWindow.instances[0].loadCount;
    mainWebContents.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(FakeBrowserWindow.instances[0].loadCount, initialLoadCount);

    FakeBrowserWindow.instances[0].bounds = {
      x: 75,
      y: 50,
      width: 1200,
      height: 800,
    };
    FakeBrowserWindow.instances[0].emit('move');
    let quitWasPrevented = false;
    electronFake.app.emit('before-quit', {
      preventDefault() {
        quitWasPrevented = true;
      },
    });
    assert.equal(quitWasPrevented, true);
    await waitFor(() => {
      const statePath = path.join(electronFake.userDataPath, 'window-state.json');
      if (!fs.existsSync(statePath)) return false;
      return JSON.parse(fs.readFileSync(statePath, 'utf8')).x === 75;
    }, 'pending window state was not flushed during quit');
    await waitFor(
      () => electronFake.app.quitRequests === 1,
      'application did not resume quit after flushing state'
    );
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const finalRecoveryLog = fs.readFileSync(
      path.join(electronFake.userDataPath, 'recovery.log'),
      'utf8'
    );
    assert.match(finalRecoveryLog, /"event":"render-process-gone"/);
    assert.equal(FakeBrowserWindow.instances[0].loadCount, initialLoadCount);
  } finally {
    Module._load = originalLoad;
    fs.rmSync(electronFake.userDataPath, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 10,
    });
  }
});
