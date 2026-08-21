'use strict';

function safeToken(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(value)) {
    return 'unknown';
  }
  return value;
}

function safeHostname(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    return 'unknown';
  }

  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname.length > 0 && hostname.length <= 253 ? hostname : 'unknown';
  } catch {
    return 'unknown';
  }
}

function createRecoveryRecord(details, now = () => new Date()) {
  const record = {
    event: safeToken(details?.event),
    host: safeHostname(details?.url),
    timestamp: now().toISOString(),
  };

  if (Number.isInteger(details?.attempt) && details.attempt >= 0) {
    record.attempt = details.attempt;
  }
  if (Number.isFinite(details?.delayMs) && details.delayMs >= 0) {
    record.delayMs = details.delayMs;
  }
  if (Number.isInteger(details?.errorCode)) {
    record.errorCode = details.errorCode;
  }
  if (details?.reason !== undefined) {
    record.reason = safeToken(details.reason);
  }

  return record;
}

function createRecoveryLogger({ filePath, fileSystem, maxBytes, now, onError }) {
  const rotatedPath = `${filePath}.1`;
  let pendingWrite = Promise.resolve();

  async function rotateIfNeeded() {
    let fileSize = 0;
    try {
      fileSize = (await fileSystem.stat(filePath)).size;
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    if (fileSize < maxBytes) return;

    await fileSystem.rm(rotatedPath, { force: true });
    try {
      await fileSystem.rename(filePath, rotatedPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  return {
    flush() {
      return pendingWrite;
    },
    log(details) {
      const line = `${JSON.stringify(createRecoveryRecord(details, now))}\n`;
      pendingWrite = pendingWrite
        .then(async () => {
          await rotateIfNeeded();
          await fileSystem.appendFile(filePath, line, {
            encoding: 'utf8',
            flag: 'a',
            mode: 0o600,
          });
          await fileSystem.chmod(filePath, 0o600);
        })
        .catch(onError);
      return pendingWrite;
    },
  };
}

module.exports = { createRecoveryLogger, createRecoveryRecord };
