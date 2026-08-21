'use strict';

const APP_ORIGIN = 'https://my.quo.com';
const TRUSTED_HOST_SUFFIXES = Object.freeze([
  'quo.com',
  'openphone.com',
  'openphoneapi.com',
]);

function parseUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isTrustedHostname(hostname) {
  if (typeof hostname !== 'string' || hostname.length === 0) return false;

  const normalizedHostname = hostname.toLowerCase();
  return TRUSTED_HOST_SUFFIXES.some(
    (suffix) => normalizedHostname === suffix || normalizedHostname.endsWith(`.${suffix}`)
  );
}

function isTrustedAppUrl(value) {
  const url = parseUrl(value);
  if (!url || url.protocol !== 'https:' || url.port !== '') return false;
  if (url.username !== '' || url.password !== '') return false;

  return isTrustedHostname(url.hostname);
}

function hasEncodedControlCharacters(value) {
  return /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value);
}

function isSafeMailUrl(url) {
  if (!url.pathname.includes('@') || /\s/.test(url.pathname)) return false;

  for (const key of url.searchParams.keys()) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === 'attach' || normalizedKey === 'attachment') return false;
  }

  return true;
}

function hasUnsafeSandboxFlag(argumentsList) {
  if (!Array.isArray(argumentsList)) return true;
  return argumentsList.some((argument) => {
    if (typeof argument !== 'string') return true;
    return (
      argument === '--no-sandbox' ||
      argument.startsWith('--no-sandbox=') ||
      argument === '--disable-sandbox' ||
      argument.startsWith('--disable-sandbox=')
    );
  });
}

function isPermissionAllowed(permission, requestingUrl, details = {}) {
  if (typeof permission !== 'string' || typeof details !== 'object' || details === null) {
    return false;
  }

  const url = parseUrl(requestingUrl);
  if (!url || url.origin !== APP_ORIGIN) return false;
  if (url.username !== '' || url.password !== '') return false;

  if (permission === 'notifications' || permission === 'clipboard-sanitized-write') {
    return true;
  }
  if (permission !== 'media') return false;

  const mediaTypes = Array.isArray(details.mediaTypes)
    ? details.mediaTypes
    : typeof details.mediaType === 'string'
      ? [details.mediaType]
      : [];

  return (
    mediaTypes.length > 0 &&
    mediaTypes.every((mediaType) => mediaType === 'audio' || mediaType === 'video')
  );
}

function classifyNavigation(value) {
  if (isTrustedAppUrl(value)) {
    return { action: 'internal', url: parseUrl(value).href };
  }

  const parsedUrl = parseUrl(value);
  const hostname = parsedUrl?.hostname.toLowerCase() || '';
  const resemblesTrustedHost = TRUSTED_HOST_SUFFIXES.some((suffix) => hostname.includes(suffix));
  if (resemblesTrustedHost) return { action: 'deny', url: null };

  const externalUrl = getExternalOpenUrl(value);
  if (externalUrl) return { action: 'external', url: externalUrl };

  return { action: 'deny', url: null };
}

function getExternalOpenUrl(value) {
  const url = parseUrl(value);
  if (!url || /[\u0000-\u001f\u007f]/.test(value)) return null;
  if (hasEncodedControlCharacters(value)) return null;
  if (url.username !== '' || url.password !== '') return null;

  if (url.protocol === 'https:' && url.port === '') return url.href;
  if (url.protocol === 'mailto:' && isSafeMailUrl(url)) return url.href;
  if (url.protocol === 'tel:' && /^\+?[0-9(). -]{3,32}$/.test(url.pathname)) return url.href;

  return null;
}

module.exports = {
  classifyNavigation,
  getExternalOpenUrl,
  hasUnsafeSandboxFlag,
  isPermissionAllowed,
  isTrustedAppUrl,
};
