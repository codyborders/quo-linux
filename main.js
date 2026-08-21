const {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  session,
  shell,
  Tray,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { hasUnsafeSandboxFlag } = require('./lib/security-policy');
const {
  installPermissionPolicy,
  installWebContentsPolicy,
} = require('./lib/web-contents-policy');
const { createRetryController } = require('./lib/recovery-controller');
const { createRecoveryLogger } = require('./lib/recovery-log');
const {
  createDebouncedStateSaver,
  createWindowStateStore,
} = require('./lib/window-state');

const QUO_URL = 'https://my.quo.com';
const ICON_PATH = path.join(__dirname, 'build', 'icon.png');
const STATE_PATH = path.join(app.getPath('userData'), 'window-state.json');
const LOG_PATH = path.join(app.getPath('userData'), 'recovery.log');

let mainWindow;
let crashRecoveryController;
let networkRetryController;
let tray;
let windowStateSaver;
let isQuitting = false;
let shutdownInProgress = false;
let shutdownReady = false;

const recoveryLogger = createRecoveryLogger({
  filePath: LOG_PATH,
  fileSystem: fs.promises,
  maxBytes: 256 * 1024,
  now: () => new Date(),
  onError: (error) => console.error('Failed to write recovery log:', error),
});
const windowStateStore = createWindowStateStore({
  filePath: STATE_PATH,
  fileSystem: fs.promises,
  processId: process.pid,
});

app.on('web-contents-created', (event, webContents) => {
  installWebContentsPolicy({
    onError: (error) => console.error('Failed to open external URL:', error),
    openExternal: (url) => shell.openExternal(url),
    webContents,
  });
});

function logRecoveryEvent(details) {
  if (process.env.QUO_DEBUG) console.log('[recovery]', details.event);
  return recoveryLogger.log(details);
}

function loadQuo() {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve();
  return mainWindow.loadURL(QUO_URL).catch(() =>
    logRecoveryEvent({ event: 'load-url-failed', url: QUO_URL })
  );
}

async function createWindow() {
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const state = await windowStateStore.load(workAreas);

  mainWindow = new BrowserWindow({
    ...state,
    icon: ICON_PATH,
    title: 'Quo',
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  crashRecoveryController = createRetryController({
    clearTimer: clearTimeout,
    delaysMs: [1000, 2000, 5000],
    reload: loadQuo,
    setTimer: setTimeout,
    stableMs: 60000,
  });
  networkRetryController = createRetryController({
    clearTimer: clearTimeout,
    delaysMs: [2000, 4000, 8000, 16000, 30000],
    reload: loadQuo,
    setTimer: setTimeout,
    stableMs: 30000,
  });
  loadQuo();

  mainWindow.webContents.on('did-finish-load', () => {
    crashRecoveryController.markLoaded();
    networkRetryController.markLoaded();
  });
  mainWindow.webContents.on(
    'did-fail-load',
    (event, errorCode, errorDescription, url, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      networkRetryController.scheduleRetry();
      logRecoveryEvent({ errorCode, event: 'did-fail-load', url });
    }
  );

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    if (isQuitting || details.reason === 'clean-exit') return;
    const recovery = crashRecoveryController.scheduleRetry();
    logRecoveryEvent({
      attempt: recovery.attempt,
      delayMs: recovery.delayMs,
      event: 'render-process-gone',
      reason: details.reason,
      url: QUO_URL,
    });
  });

  if (process.env.QUO_DEBUG) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[renderer] ${message} (${sourceId}:${line})`);
    });
  }

  windowStateSaver = createDebouncedStateSaver({
    clearTimer: clearTimeout,
    delayMs: 300,
    getBounds: () => mainWindow.getBounds(),
    onError: (error) => console.error('Failed to save window state:', error),
    save: (bounds) => windowStateStore.save(bounds),
    setTimer: setTimeout,
  });
  mainWindow.on('resize', () => windowStateSaver.schedule());
  mainWindow.on('move', () => windowStateSaver.schedule());

  // Chromium's compositor can leave a stale/blank frame after the window sits
  // hidden (tray) or the system suspends; a forced repaint is cheap and fixes it
  // without a full reload.
  mainWindow.on('show', () => {
    logRecoveryEvent({ event: 'window-shown', url: QUO_URL });
    mainWindow.webContents.invalidate();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 32, height: 32 });
  tray = new Tray(icon);
  tray.setToolTip('Quo');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open Quo',
        click: () => {
          mainWindow.show();
          mainWindow.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

if (hasUnsafeSandboxFlag(process.argv)) {
  console.error('Quo refuses to start without the Chromium sandbox.');
  app.exit(1);
} else {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });

    app
      .whenReady()
      .then(async () => {
        installPermissionPolicy(session.defaultSession);

        await createWindow();
        createTray();

        powerMonitor.on('resume', () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          if (mainWindow.isVisible()) {
            logRecoveryEvent({ event: 'system-resumed', url: QUO_URL });
            mainWindow.webContents.invalidate();
          }
        });
      })
      .catch((error) => {
        console.error('Failed to start Quo:', error);
        app.quit();
      });

    app.on('before-quit', (event) => {
      isQuitting = true;
      crashRecoveryController?.stop();
      networkRetryController?.stop();
      if (shutdownReady) return;

      event.preventDefault();
      if (shutdownInProgress) return;
      shutdownInProgress = true;

      Promise.all([
        windowStateSaver?.flush() || Promise.resolve(),
        recoveryLogger.flush(),
      ])
        .catch((error) => console.error('Failed to flush application state:', error))
        .finally(() => {
          shutdownReady = true;
          app.quit();
        });
    });

    app.on('window-all-closed', () => {
      // Tray keeps the app alive; do nothing here.
    });
  }
}
