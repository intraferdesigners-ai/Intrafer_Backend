// Frontend cache tags this API purges (see utils/revalidate.js). The names
// must match Intrafer_Frontend/lib/cacheTags.js exactly — the frontend's
// scripts/checkPurgeTags.mjs fails if either side has a tag the other lacks.

const TAGS = Object.freeze({
  VENDORS: 'vendors',     // vendor lists/cards: similar vendors, design-styles, cities, home, sitemap
  PROJECTS: 'projects',   // project lists: gallery, recent-projects, home featured, related, sitemap
  REVIEWS: 'reviews',     // site reviews: home, testimonials
  STATS: 'stats',         // /public/stats + style counts
  HOMEPAGE: 'homepage',   // CMS settings (hero subtitle)
  TAXONOMY: 'taxonomy',   // categories/places: category-cities links, sitemap
  LANDING: 'landing',     // admin landing pages: sitemap now, the pages themselves in batch 3
});

const TAG_PREFIXES = Object.freeze({
  VENDOR: 'vendor:',      // one vendor's profile page
  PROJECT: 'project:',    // one project's page
});

const vendorTag = (id) => `${TAG_PREFIXES.VENDOR}${id}`;
const projectTag = (id) => `${TAG_PREFIXES.PROJECT}${id}`;

// What each kind of change invalidates.
const vendorTags = (vendorId, projectIds = []) => [
  TAGS.VENDORS, vendorTag(vendorId), TAGS.PROJECTS, TAGS.STATS, TAGS.LANDING,
  ...projectIds.map(projectTag),
];
const projectTags = (projectId, vendorId) => [TAGS.PROJECTS, projectTag(projectId), vendorTag(vendorId), TAGS.STATS];
const reviewTags = (vendorId) => [TAGS.REVIEWS, vendorTag(vendorId), TAGS.VENDORS, TAGS.STATS];

module.exports = { TAGS, TAG_PREFIXES, vendorTag, projectTag, vendorTags, projectTags, reviewTags };
