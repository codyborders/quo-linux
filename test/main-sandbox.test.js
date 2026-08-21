'use strict';

// This test checks that the public entrypoint refuses sandbox-disabling launches.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');

test('entrypoint exits before startup when Chromium sandboxing is disabled', () => {
  const app = new EventEmitter();
  const exitCodes = [];
  let lockRequests = 0;
  let quitRequests = 0;
  app.exit = (code) => {
    exitCodes.push(code);
  };
  app.getPath = () => '/tmp';
  app.quit = () => {
    quitRequests += 1;
  };
  app.requestSingleInstanceLock = () => {
    lockRequests += 1;
    return true;
  };
  app.whenReady = () => new Promise(() => {});
  const electron = {
    app,
    shell: { openExternal: async () => {} },
  };
  const originalArguments = process.argv;
  const originalExitCode = process.exitCode;
  const originalLoad = Module._load;
  process.argv = ['electron', 'main.js', '--no-sandbox'];
  Module._load = function load(request, parent, isMain) {
    return request === 'electron' ? electron : originalLoad.call(this, request, parent, isMain);
  };

  try {
    require('../main');
    assert.deepEqual(exitCodes, [1]);
    assert.equal(quitRequests, 0);
    assert.equal(lockRequests, 0);
  } finally {
    Module._load = originalLoad;
    process.argv = originalArguments;
    process.exitCode = originalExitCode;
  }
});
