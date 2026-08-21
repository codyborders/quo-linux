'use strict';

// These tests cover private recovery records and bounded log storage.
const test = require('node:test');
const assert = require('node:assert/strict');

const { createRecoveryLogger, createRecoveryRecord } = require('../lib/recovery-log');

test('recovery records omit URL paths, credentials, queries, and control characters', () => {
  const record = createRecoveryRecord(
    {
      attempt: 2,
      delayMs: 4000,
      errorCode: -105,
      event: 'did-fail-load\nforged',
      reason: 'crashed\rforged',
      url: 'https://user:secret@my.quo.com/private/5550100?token=top-secret#person@example.com',
    },
    () => new Date('2026-08-20T12:00:00.000Z')
  );

  assert.deepEqual(record, {
    attempt: 2,
    delayMs: 4000,
    errorCode: -105,
    event: 'unknown',
    host: 'my.quo.com',
    reason: 'unknown',
    timestamp: '2026-08-20T12:00:00.000Z',
  });
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, /top-secret|5550100|person@example|user|secret/);
});

test('recovery logger rotates before a private asynchronous append', async () => {
  const operations = [];
  const logger = createRecoveryLogger({
    filePath: '/config/recovery.log',
    fileSystem: {
      async appendFile(filePath, contents, options) {
        operations.push(['appendFile', filePath, contents, options]);
      },
      async chmod(filePath, mode) {
        operations.push(['chmod', filePath, mode]);
      },
      async rename(source, target) {
        operations.push(['rename', source, target]);
      },
      async rm(filePath, options) {
        operations.push(['rm', filePath, options]);
      },
      async stat(filePath) {
        operations.push(['stat', filePath]);
        return { size: 10 };
      },
    },
    maxBytes: 10,
    now: () => new Date('2026-08-20T12:00:00.000Z'),
    onError: assert.fail,
  });

  const pendingLog = logger.log({
    event: 'did-fail-load',
    errorCode: -105,
    url: 'https://my.quo.com/a?token=x',
  });
  assert.equal(typeof logger.flush, 'function');
  await logger.flush();
  await pendingLog;

  assert.deepEqual(operations.slice(0, 3), [
    ['stat', '/config/recovery.log'],
    ['rm', '/config/recovery.log.1', { force: true }],
    ['rename', '/config/recovery.log', '/config/recovery.log.1'],
  ]);
  assert.equal(operations[3][0], 'appendFile');
  assert.equal(operations[3][1], '/config/recovery.log');
  assert.deepEqual(operations[3][3], { encoding: 'utf8', flag: 'a', mode: 0o600 });
  assert.deepEqual(JSON.parse(operations[3][2]), {
    errorCode: -105,
    event: 'did-fail-load',
    host: 'my.quo.com',
    timestamp: '2026-08-20T12:00:00.000Z',
  });
  assert.deepEqual(operations[4], ['chmod', '/config/recovery.log', 0o600]);
});
