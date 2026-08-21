'use strict';

// These tests cover URL trust decisions through the public policy functions.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyNavigation,
  getExternalOpenUrl,
  hasUnsafeSandboxFlag,
  isPermissionAllowed,
  isTrustedAppUrl,
} = require('../lib/security-policy');

test('trusted app URLs require HTTPS and a real Quo or OpenPhone hostname', () => {
  const trustedUrls = [
    'https://my.quo.com',
    'https://signin.openphone.com/login',
    'https://api.openphoneapi.com/v1',
    'https://QUO.COM/path',
  ];
  const untrustedUrls = [
    'http://my.quo.com',
    'https://my.quo.com:8443',
    'https://quo.com.attacker.invalid/capture',
    'https://my.quo.com@attacker.invalid/capture',
    'https://attacker.invalid/?next=quo.com',
    'javascript:location="https://quo.com"',
    'file:///tmp/quo.com',
    'not a URL',
    '',
  ];

  for (const url of trustedUrls) {
    assert.equal(isTrustedAppUrl(url), true, `expected trusted URL: ${url}`);
  }
  for (const url of untrustedUrls) {
    assert.equal(isTrustedAppUrl(url), false, `expected rejected URL: ${url}`);
  }
});

test('external URLs allow only safe web, email, and telephone links', () => {
  const acceptedUrls = new Map([
    ['https://example.com/help?q=quo', 'https://example.com/help?q=quo'],
    ['mailto:support@example.com?subject=Help', 'mailto:support@example.com?subject=Help'],
    ['tel:+1-555-0100', 'tel:+1-555-0100'],
  ]);
  const rejectedUrls = [
    'http://example.com',
    'https://user:password@example.com',
    'https://example.com:8443',
    'mailto:support@example.com?attach=/etc/passwd',
    'mailto:support@example.com?body=hello%0Aworld',
    'tel:*21*5550100#',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,hello',
    'vscode://file/etc/passwd',
    'not a URL',
  ];

  for (const [input, expected] of acceptedUrls) {
    assert.equal(getExternalOpenUrl(input), expected);
  }
  for (const input of rejectedUrls) {
    assert.equal(getExternalOpenUrl(input), null, `expected rejected URL: ${input}`);
  }
});

test('navigation policy keeps trusted pages inside and classifies other destinations', () => {
  assert.deepEqual(classifyNavigation('https://my.quo.com/inbox'), {
    action: 'internal',
    url: 'https://my.quo.com/inbox',
  });
  assert.deepEqual(classifyNavigation('https://example.com/help'), {
    action: 'external',
    url: 'https://example.com/help',
  });
  assert.deepEqual(classifyNavigation('javascript:alert(1)'), {
    action: 'deny',
    url: null,
  });
  assert.deepEqual(classifyNavigation('https://my.quo.com.attacker.invalid/capture'), {
    action: 'deny',
    url: null,
  });
});

test('sandbox-disabling command-line flags are rejected', () => {
  assert.equal(hasUnsafeSandboxFlag(['quo-linux']), false);
  assert.equal(hasUnsafeSandboxFlag(['quo-linux', '--ozone-platform=wayland']), false);
  assert.equal(hasUnsafeSandboxFlag(['quo-linux', '--no-sandbox']), true);
  assert.equal(hasUnsafeSandboxFlag(['quo-linux', '--no-sandbox=true']), true);
  assert.equal(hasUnsafeSandboxFlag(['quo-linux', '--no-sandbox=false']), true);
  assert.equal(hasUnsafeSandboxFlag(['quo-linux', '--disable-sandbox']), true);
  assert.equal(hasUnsafeSandboxFlag(['quo-linux', '--disable-sandbox=true']), true);
});

test('permissions require the exact app origin and an approved capability', () => {
  const allowedRequests = [
    ['media', 'https://my.quo.com/calls', { mediaTypes: ['audio'] }],
    ['media', 'https://my.quo.com/calls', { mediaTypes: ['audio', 'video'] }],
    ['notifications', 'https://my.quo.com/inbox', {}],
    ['clipboard-sanitized-write', 'https://my.quo.com/contacts', {}],
  ];
  const rejectedRequests = [
    ['media', 'https://my.quo.com.attacker.invalid', { mediaTypes: ['audio'] }],
    ['media', 'https://my.quo.com@attacker.invalid', { mediaTypes: ['audio'] }],
    ['media', 'https://my.quo.com/calls', { mediaTypes: [] }],
    ['media', 'https://my.quo.com/calls', { mediaTypes: ['screen'] }],
    ['display-capture', 'https://my.quo.com/calls', {}],
    ['geolocation', 'https://my.quo.com', {}],
    ['notifications', 'https://signin.openphone.com', {}],
    ['notifications', 'not a URL', {}],
  ];

  for (const [permission, requestingUrl, details] of allowedRequests) {
    assert.equal(isPermissionAllowed(permission, requestingUrl, details), true);
  }
  for (const [permission, requestingUrl, details] of rejectedRequests) {
    assert.equal(isPermissionAllowed(permission, requestingUrl, details), false);
  }
});
