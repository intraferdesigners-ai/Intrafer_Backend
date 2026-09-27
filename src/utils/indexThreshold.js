// NOT wired into any live noindex decision yet. Every page in the
// category/state/city SEO chain still hardcodes noindex regardless of what
// this returns — this exists now so the explicit later go-live step
// (turning indexation on for interior-designers once the chain + real FAQ
// content is ready) has this decision already written and tested, rather
// than inventing it under pressure at cutover time.
const MIN_VENDORS_TO_INDEX = 3;

function meetsIndexThreshold(vendorCount) {
  return vendorCount >= MIN_VENDORS_TO_INDEX;
}

module.exports = { meetsIndexThreshold, MIN_VENDORS_TO_INDEX };
