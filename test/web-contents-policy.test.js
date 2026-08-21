'use strict';

// These tests cover Electron window and frame controls through public event hooks.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  installPermissionPolicy,
  installWebContentsPolicy,
} = require('../lib/web-contents-policy');

class FakeWebContents extends EventEmitter {
  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }
}

function createNavigationEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

test('all web contents apply one fail-closed popup and navigation policy', async () => {
  const openedUrls = [];
  const webContents = new FakeWebContents();
  installWebContentsPolicy({
    onError: assert.fail,
    openExternal: async (url) => {
      openedUrls.push(url);
    },
    webContents,
  });

  const trustedPopup = webContents.windowOpenHandler({ url: 'https://signin.openphone.com/login' });
  assert.equal(trustedPopup.action, 'allow');
  assert.deepEqual(trustedPopup.overrideBrowserWindowOptions.webPreferences, {
    allowRunningInsecureContent: false,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  });

  const attackerPopup = webContents.windowOpenHandler({
    url: 'https://my.quo.com.attacker.invalid/capture',
  });
  assert.deepEqual(attackerPopup, { action: 'deny' });

  const externalPopup = webContents.windowOpenHandler({ url: 'https://example.com/help' });
  assert.deepEqual(externalPopup, { action: 'deny' });
  await Promise.resolve();
  assert.deepEqual(openedUrls, ['https://example.com/help']);

  const redirectEvent = createNavigationEvent();
  webContents.emit('will-redirect', redirectEvent, 'file:///etc/passwd');
  assert.equal(redirectEvent.defaultPrevented, true);

  const externalNavigationEvent = createNavigationEvent();
  webContents.emit('will-navigate', externalNavigationEvent, 'mailto:support@example.com');
  await Promise.resolve();
  assert.equal(externalNavigationEvent.defaultPrevented, true);
  assert.deepEqual(openedUrls, ['https://example.com/help', 'mailto:support@example.com']);

  const trustedNavigationEvent = createNavigationEvent();
  webContents.emit('will-navigate', trustedNavigationEvent, 'https://my.quo.com/inbox');
  assert.equal(trustedNavigationEvent.defaultPrevented, false);

  const webviewEvent = createNavigationEvent();
  webContents.emit('will-attach-webview', webviewEvent);
  assert.equal(webviewEvent.defaultPrevented, true);
});

test('session permission handlers use the requesting origin and media type', () => {
  const electronSession = {
    setPermissionCheckHandler(handler) {
      this.checkHandler = handler;
    },
    setPermissionRequestHandler(handler) {
      this.requestHandler = handler;
    },
  };
  installPermissionPolicy(electronSession);

  const trustedTopLevelPage = { getURL: () => 'https://my.quo.com/calls' };
  let requestResult = null;
  electronSession.requestHandler(
    trustedTopLevelPage,
    'media',
    (allowed) => {
      requestResult = allowed;
    },
    {
      mediaTypes: ['audio'],
      requestingUrl: 'https://my.quo.com.attacker.invalid/capture',
    }
  );
  assert.equal(requestResult, false);

  electronSession.requestHandler(
    trustedTopLevelPage,
    'media',
    (allowed) => {
      requestResult = allowed;
    },
    {
      mediaTypes: ['audio'],
      requestingUrl: 'https://my.quo.com/calls',
      securityOrigin: 'https://attacker.invalid',
    }
  );
  assert.equal(requestResult, false);

  electronSession.requestHandler(
    trustedTopLevelPage,
    'media',
    (allowed) => {
      requestResult = allowed;
    },
    {
      mediaTypes: ['audio'],
      requestingUrl: 'https://my.quo.com/calls',
      securityOrigin: 'https://my.quo.com',
    }
  );
  assert.equal(requestResult, true);

  assert.equal(
    electronSession.checkHandler(
      trustedTopLevelPage,
      'notifications',
      'https://my.quo.com',
      { embeddingOrigin: 'https://attacker.invalid' }
    ),
    false
  );
  assert.equal(
    electronSession.checkHandler(
      trustedTopLevelPage,
      'notifications',
      'https://my.quo.com',
      {}
    ),
    true
  );
  assert.equal(
    electronSession.checkHandler(
      trustedTopLevelPage,
      'notifications',
      'https://attacker.invalid',
      {}
    ),
    false
  );
});
