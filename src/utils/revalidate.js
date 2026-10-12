// On-demand purge of the frontend's Next.js cache: POST
// ${CLIENT_URL}/api/revalidate/ with the shared REVALIDATE_SECRET.
//
// Fire-and-forget by design: callers invoke these AFTER their DB write has
// succeeded and do NOT await them, so the API response never waits on the
// frontend. Nothing here ever throws. A failed purge is retried in the
// background (~5 s, 30 s, 2 min) and every failure is logged with the
// "[revalidate]" prefix and the tags it was carrying (never the secret); if
// all retries fail, the cached page self-corrects at its revalidate window.
// A 400/401 means misconfiguration (secret mismatch, wrong URL): no retries,
// one loud log line per process.
//
// Without REVALIDATE_SECRET or CLIENT_URL (local dev) every call is a no-op,
// with a single warning per process.

const Project = require('../models/Project.model');
const { normalizeClientUrl } = require('./siteUrl');
const { TAGS, vendorTag, vendorTags, projectTags, reviewTags } = require('./cacheTags');

const TIMEOUT_MS = 3000;  // per attempt
const MAX_TAGS = 20;      // per request — the frontend endpoint's limit
const MAX_PATHS = 10;
// Background retries after a failed first attempt. Read through
// module.exports at schedule time so tests can shorten them.
const RETRY_DELAYS_MS = [5000, 30000, 120000];

let warnedUnconfigured = false;
let warnedRejected = false;

function target() {
  const secret = process.env.REVALIDATE_SECRET;
  const rawUrl = process.env.CLIENT_URL;
  if (!secret || !rawUrl || !rawUrl.trim()) return null;
  // Trailing slash: the frontend uses trailingSlash, so /api/revalidate would 308 first.
  return { url: `${normalizeClientUrl(rawUrl)}/api/revalidate/`, secret };
}

const describe = (body) => `tags: ${body.tags.join(', ') || '-'}; paths: ${body.paths.join(', ') || '-'}`;
const seconds = (ms) => (ms >= 60000 ? `${ms / 60000} min` : `${ms / 1000} s`);

// One POST -> { ok } | { ok: false, rejected, reason }. Never throws.
async function attempt({ url, secret }, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    return { ok: false, rejected: res.status === 400 || res.status === 401, reason: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, rejected: false, reason: err.name === 'TimeoutError' ? `timeout after ${TIMEOUT_MS} ms` : err.message };
  }
}

function logRejected(reason, body) {
  if (warnedRejected) return;
  warnedRejected = true;
  console.error(`[revalidate] PURGE REJECTED BY THE FRONTEND (${reason}) — check that REVALIDATE_SECRET is identical on backend and frontend and CLIENT_URL points at the frontend. Not retrying; cached pages will only refresh at their revalidate window. (Logged once per process.) ${describe(body)}`);
}

// Retry number `retry` (1-based) after `lastReason`, in the background.
function scheduleRetry(t, body, retry, lastReason) {
  const delays = module.exports.RETRY_DELAYS_MS;
  if (retry > delays.length) {
    console.error(`[revalidate] purge gave up after ${delays.length + 1} attempts (${lastReason}); ${describe(body)}`);
    return;
  }
  console.error(`[revalidate] purge failed (${lastReason}); retry ${retry}/${delays.length} in ${seconds(delays[retry - 1])}; ${describe(body)}`);
  const timer = setTimeout(() => {
    attempt(t, body)
      .then((r) => {
        if (r.ok) console.log(`[revalidate] purge succeeded on retry ${retry}/${delays.length}; ${describe(body)}`);
        else if (r.rejected) logRejected(r.reason, body);
        else scheduleRetry(t, body, retry + 1, r.reason);
      })
      .catch((err) => console.error(`[revalidate] retry error: ${err.message}`));
  }, delays[retry - 1]);
  if (timer.unref) timer.unref(); // never keeps the process alive
}

// First attempt now; on failure, background retries. Resolves with the first
// attempt's outcome, so a caller that does await it waits at most TIMEOUT_MS.
async function send(t, body) {
  const first = await attempt(t, body);
  if (first.ok) return true;
  if (first.rejected) logRejected(first.reason, body);
  else scheduleRetry(t, body, 1, first.reason);
  return false;
}

// -> Promise<boolean> (true when every request succeeded first time). Never
// rejects. Tags are de-duplicated and sent in batches of MAX_TAGS.
async function purge({ tags = [], paths = [] } = {}) {
  try {
    const t = target();
    if (!t) {
      if (!warnedUnconfigured) {
        warnedUnconfigured = true;
        console.warn('[revalidate] REVALIDATE_SECRET or CLIENT_URL not set; frontend cache purges are disabled.');
      }
      return false;
    }
    const uniqueTags = [...new Set(tags.map(String))];
    const uniquePaths = [...new Set(paths.map(String))].slice(0, MAX_PATHS);
    const batches = [];
    for (let i = 0; i < uniqueTags.length; i += MAX_TAGS) batches.push(uniqueTags.slice(i, i + MAX_TAGS));
    if (batches.length === 0) batches.push([]);
    const results = await Promise.all(batches.map((batch, i) => send(t, { tags: batch, paths: i === 0 ? uniquePaths : [] })));
    return results.every(Boolean);
  } catch (err) {
    console.error(`[revalidate] purge error: ${err.message}`);
    return false;
  }
}

// Each helper below goes through module.exports.purge so tests can stub it.
// Promise.resolve().then(fn): even a synchronous throw inside fn becomes a
// logged rejection instead of escaping into the caller.
const safely = (label, fn) => Promise.resolve().then(fn).catch((err) => {
  console.error(`[revalidate] ${label} failed: ${err.message}`);
  return false;
});

// A vendor's visibility or content changed: its page, every list it can
// appear in, and each of its project pages (whose visibility follows the
// vendor's). One indexed read for the project ids.
const purgeVendor = (vendorId) => safely(`purgeVendor ${vendorId}`, async () => {
  const projects = await Project.find({ vendorId }).select('_id').lean();
  return module.exports.purge({ tags: vendorTags(vendorId, projects.map((p) => p._id)) });
});

// Only that vendor's own page (availability, project order).
const purgeVendorPage = (vendorId) => safely(`purgeVendorPage ${vendorId}`, () =>
  module.exports.purge({ tags: [vendorTag(vendorId)] }));

const purgeProject = (projectId, vendorId) => safely(`purgeProject ${projectId}`, () =>
  module.exports.purge({ tags: projectTags(projectId, vendorId) }));

const purgeReview = (vendorId) => safely(`purgeReview ${vendorId}`, () =>
  module.exports.purge({ tags: reviewTags(vendorId) }));

const purgeLanding = (paths = []) => safely('purgeLanding', () =>
  module.exports.purge({ tags: [TAGS.LANDING], paths: paths.filter(Boolean) }));

const purgeTaxonomy = () => safely('purgeTaxonomy', () => module.exports.purge({ tags: [TAGS.TAXONOMY] }));

const purgeHomepage = () => safely('purgeHomepage', () => module.exports.purge({ tags: [TAGS.HOMEPAGE] }));

// Plan prices live in code (config/plans.js), so they only change with a
// deploy: purge on boot, and again once the deploy has had time to take
// traffic, so a regeneration that hit the outgoing instance in between
// doesn't keep the old prices for a whole revalidate window.
const PLANS_REPURGE_MS = 120000;
const purgePlans = () => safely('purgePlans', () => module.exports.purge({ tags: [TAGS.PLANS] }));
const purgePlansOnBoot = () => {
  purgePlans();
  const timer = setTimeout(purgePlans, PLANS_REPURGE_MS);
  if (timer.unref) timer.unref();
};

module.exports = {
  purge, purgeVendor, purgeVendorPage, purgeProject, purgeReview, purgeLanding, purgeTaxonomy, purgeHomepage,
  purgePlans, purgePlansOnBoot,
  TIMEOUT_MS, MAX_TAGS, RETRY_DELAYS_MS,
};
