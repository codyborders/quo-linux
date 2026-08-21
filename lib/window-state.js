'use strict';

const DEFAULT_HEIGHT = 860;
const DEFAULT_WIDTH = 1280;
const MIN_VISIBLE_PIXELS = 100;
const MIN_WINDOW_HEIGHT = 480;
const MIN_WINDOW_WIDTH = 640;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeWorkAreas(workAreas) {
  if (!Array.isArray(workAreas)) return [];

  return workAreas.filter(
    (area) =>
      area &&
      isFiniteNumber(area.x) &&
      isFiniteNumber(area.y) &&
      isFiniteNumber(area.width) &&
      isFiniteNumber(area.height) &&
      area.width > 0 &&
      area.height > 0
  );
}

function centerBounds(width, height, workArea) {
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  };
}

function hasVisibleArea(bounds, workArea) {
  const width = Math.max(
    0,
    Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
      Math.max(bounds.x, workArea.x)
  );
  const height = Math.max(
    0,
    Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
      Math.max(bounds.y, workArea.y)
  );

  return width >= MIN_VISIBLE_PIXELS && height >= MIN_VISIBLE_PIXELS;
}

function normalizeWindowBounds(candidate, workAreas) {
  const validWorkAreas = normalizeWorkAreas(workAreas);
  const primaryWorkArea = validWorkAreas[0] || {
    x: 0,
    y: 0,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };

  const candidateWidth = isFiniteNumber(candidate?.width) ? candidate.width : DEFAULT_WIDTH;
  const candidateHeight = isFiniteNumber(candidate?.height) ? candidate.height : DEFAULT_HEIGHT;
  const width = Math.round(
    Math.min(Math.max(candidateWidth, MIN_WINDOW_WIDTH), primaryWorkArea.width)
  );
  const height = Math.round(
    Math.min(Math.max(candidateHeight, MIN_WINDOW_HEIGHT), primaryWorkArea.height)
  );

  if (!isFiniteNumber(candidate?.x) || !isFiniteNumber(candidate?.y)) {
    return centerBounds(width, height, primaryWorkArea);
  }

  const bounds = {
    x: Math.round(candidate.x),
    y: Math.round(candidate.y),
    width,
    height,
  };
  if (validWorkAreas.some((workArea) => hasVisibleArea(bounds, workArea))) return bounds;

  return centerBounds(width, height, primaryWorkArea);
}

function createDebouncedStateSaver({
  clearTimer,
  delayMs,
  getBounds,
  onError,
  save,
  setTimer,
}) {
  let dirty = false;
  let pendingSave = Promise.resolve();
  let timer = null;

  function queueSave() {
    pendingSave = pendingSave
      .catch(() => {})
      .then(() => save(getBounds()))
      .catch(onError);
    return pendingSave;
  }

  return {
    flush() {
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      if (!dirty) return pendingSave;

      dirty = false;
      return queueSave();
    },
    schedule() {
      dirty = true;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        dirty = false;
        queueSave();
      }, delayMs);
    },
    whenIdle() {
      return pendingSave;
    },
  };
}

function createWindowStateStore({ filePath, fileSystem, processId }) {
  const temporaryPath = `${filePath}.${processId}.tmp`;

  return {
    async load(workAreas) {
      try {
        const contents = await fileSystem.readFile(filePath, 'utf8');
        return normalizeWindowBounds(JSON.parse(contents), workAreas);
      } catch {
        return normalizeWindowBounds(null, workAreas);
      }
    },
    async save(bounds) {
      const contents = JSON.stringify(bounds);
      try {
        await fileSystem.writeFile(temporaryPath, contents, {
          encoding: 'utf8',
          flag: 'w',
          mode: 0o600,
        });
        await fileSystem.rename(temporaryPath, filePath);
      } catch (error) {
        // Keep the original storage error while removing incomplete state.
        await fileSystem.rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
      }
    },
  };
}

module.exports = {
  createDebouncedStateSaver,
  createWindowStateStore,
  normalizeWindowBounds,
};
