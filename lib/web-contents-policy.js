'use strict';

const { classifyNavigation, isPermissionAllowed } = require('./security-policy');

const SECURE_WEB_PREFERENCES = Object.freeze({
  allowRunningInsecureContent: false,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
});

function installPermissionPolicy(electronSession) {
  electronSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const requestingUrlAllowed = isPermissionAllowed(
        permission,
        details?.requestingUrl,
        details
      );
      const securityOriginAllowed =
        details?.securityOrigin === undefined ||
        isPermissionAllowed(permission, details.securityOrigin, details);
      callback(requestingUrlAllowed && securityOriginAllowed);
    }
  );
  electronSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      const origins = [
        requestingOrigin,
        details?.embeddingOrigin,
        details?.requestingUrl,
        details?.securityOrigin,
      ].filter((origin) => origin !== undefined);
      return origins.every((origin) => isPermissionAllowed(permission, origin, details));
    }
  );
}

function installWebContentsPolicy({ onError, openExternal, webContents }) {
  function openApprovedExternalUrl(url) {
    try {
      Promise.resolve(openExternal(url)).catch(onError);
    } catch (error) {
      onError(error);
    }
  }

  function handleNavigation(event, url) {
    const decision = classifyNavigation(url);
    if (decision.action === 'internal') return;

    event.preventDefault();
    if (decision.action === 'external') openApprovedExternalUrl(decision.url);
  }

  webContents.setWindowOpenHandler(({ url }) => {
    const decision = classifyNavigation(url);
    if (decision.action === 'external') openApprovedExternalUrl(decision.url);
    if (decision.action !== 'internal') return { action: 'deny' };

    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: { ...SECURE_WEB_PREFERENCES },
      },
    };
  });
  webContents.on('will-attach-webview', (event) => event.preventDefault());
  webContents.on('will-navigate', handleNavigation);
  webContents.on('will-redirect', handleNavigation);
}

module.exports = { installPermissionPolicy, installWebContentsPolicy };
