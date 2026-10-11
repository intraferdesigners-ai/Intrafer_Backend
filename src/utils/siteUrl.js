// The frontend's public origin, for absolute links the backend puts in
// emails (password reset, review request, vendor dashboard). Mirrors the
// frontend's lib/siteUrl.js: CLIENT_URL is normalised to a bare origin (no
// trailing slash, no path), the apex intrafer.in is forced to
// https://www.intrafer.in — the live host; the apex only redirects there — and
// an empty/invalid value falls back to that too. Other hosts (e.g.
// http://localhost:3000 in local .env) pass through unchanged.

const DEFAULT_CLIENT_URL = 'https://www.intrafer.in';
const OWN_HOSTS = new Set(['intrafer.in', 'www.intrafer.in']);

function normalizeClientUrl(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return DEFAULT_CLIENT_URL;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return DEFAULT_CLIENT_URL;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return DEFAULT_CLIENT_URL;
  if (OWN_HOSTS.has(url.hostname)) return DEFAULT_CLIENT_URL;
  return url.origin;
}

// Read at call time, not import time, so it always reflects the loaded .env.
const clientUrl = () => normalizeClientUrl(process.env.CLIENT_URL);

module.exports = { DEFAULT_CLIENT_URL, normalizeClientUrl, clientUrl };
