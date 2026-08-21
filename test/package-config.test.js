'use strict';

// These tests keep runtime resources and Linux release targets in package metadata.
const test = require('node:test');
const assert = require('node:assert/strict');

const packageJson = require('../package.json');

test('package metadata pins maintained tooling and includes every runtime file', () => {
  assert.equal(packageJson.desktopName, 'quo-linux.desktop');
  assert.equal(packageJson.devDependencies.electron, '43.4.1');
  assert.equal(packageJson.devDependencies['electron-builder'], '26.15.3');
  assert.equal(packageJson.scripts.test, 'node --test');
  assert.deepEqual(packageJson.build.files, [
    'main.js',
    'lib/**/*.js',
    'build/icon.png',
    'LICENSE',
    'package.json',
  ]);
  assert.deepEqual(packageJson.build.linux.target, ['AppImage', 'deb', 'pacman']);
  assert.equal(packageJson.build.linux.syncDesktopName, true);
  assert.deepEqual(packageJson.build.pacman.depends, [
    'alsa-lib',
    'at-spi2-core',
    'gtk3',
    'libcups',
    'libnotify',
    'libpulse',
    'libsecret',
    'libxkbcommon',
    'libxss',
    'mesa',
    'nss',
    'xdg-utils',
  ]);
});
