const LandingPageVersion = require('../models/LandingPageVersion.model');

// Landing page version history (Phase 4B). Versions are recorded AFTER a
// successful save, from the saved document, and recording is best-effort:
// recordVersion never throws, so history can't fail a page save.

const CONTENT_KEYS = ['banner', 'heading', 'intro', 'sections', 'vendorList', 'seo'];
const MAX_VERSIONS = 10;

// Drops _id / __v at every depth, so snapshots compare on content only
// (section and FAQ subdocument ids change on every copy/restore).
function stripIds(value) {
  if (Array.isArray(value)) return value.map(stripIds);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k !== '_id' && k !== '__v') out[k] = stripIds(v);
    }
    return out;
  }
  return value;
}

// The six content keys of a page, as a plain JSON-safe object.
function snapshotOf(page) {
  const obj = typeof page?.toObject === 'function' ? page.toObject({ depopulate: true }) : (page || {});
  const snap = {};
  for (const key of CONTENT_KEYS) snap[key] = obj[key] === undefined ? null : obj[key];
  return JSON.parse(JSON.stringify(stripIds(snap)));
}

// Key-order-independent JSON, for deep equality.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function isEmpty(value) {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.values(value).every(isEmpty);
  return false;
}

// Top-level content keys that differ. With no previous snapshot: every
// non-empty key (what the first version introduced).
function changedKeys(prev, next) {
  if (!prev) return CONTENT_KEYS.filter((k) => !isEmpty(next?.[k]));
  return CONTENT_KEYS.filter((k) => canonical(prev[k] ?? null) !== canonical(next?.[k] ?? null));
}

// Stores a version of the SAVED `page`. A 'save' identical to the latest
// version is skipped (no-op saves create nothing); every other kind is
// always recorded. Keeps the newest MAX_VERSIONS for the page. Returns the
// version, or null when skipped or on any failure (logged, never thrown).
async function recordVersion(page, { kind, adminId = null, restoredFrom = null } = {}) {
  try {
    const snapshot = snapshotOf(page);
    const latest = await LandingPageVersion.findOne({ page: page._id }).sort({ createdAt: -1, _id: -1 }).select('snapshot');
    const changedFields = changedKeys(latest?.snapshot || null, snapshot);
    if (kind === 'save' && latest && changedFields.length === 0) return null;

    const version = await LandingPageVersion.create({
      page: page._id, snapshot, kind, changedFields, restoredFrom: restoredFrom || null, savedBy: adminId,
    });

    const stale = await LandingPageVersion.find({ page: page._id })
      .sort({ createdAt: -1, _id: -1 })
      .skip(MAX_VERSIONS)
      .select('_id');
    if (stale.length) await LandingPageVersion.deleteMany({ _id: { $in: stale.map((v) => v._id) } });
    return version;
  } catch (err) {
    console.error('Landing page version not recorded:', err.message);
    return null;
  }
}

// All versions of a page (when the page is deleted). Best-effort too: an
// orphaned version is harmless, a failed delete request is not.
async function deleteVersionsFor(pageIds) {
  const ids = Array.isArray(pageIds) ? pageIds : [pageIds];
  try {
    await LandingPageVersion.deleteMany({ page: { $in: ids } });
  } catch (err) {
    console.error('Landing page versions not deleted:', err.message);
  }
}

module.exports = {
  CONTENT_KEYS, MAX_VERSIONS, snapshotOf, changedKeys, recordVersion, deleteVersionsFor,
};
