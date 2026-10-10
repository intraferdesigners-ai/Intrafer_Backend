const { slugify } = require('./slug');

// Copying one landing page's content onto a new city (duplicate and bulk
// create, Phase 4A). Pure — exercised by scripts/testLandingBulk.js.

const MAX_LOCATION_LENGTH = 80; // LandingPage state/city maxlength

// The fields a copy carries over. Never: _id, slugs (re-derived on
// validate), status/publishedAt (copies are always drafts),
// createdBy/updatedBy, timestamps.
function copyContent(source) {
  const s = typeof source?.toObject === 'function' ? source.toObject() : (source || {});
  const banner = s.banner || {};
  const seo = s.seo || {};
  return {
    level: s.level,
    banner: {
      imageUrl: banner.imageUrl, headline: banner.headline, subheadline: banner.subheadline,
      ctaLabel: banner.ctaLabel, ctaUrl: banner.ctaUrl,
    },
    heading: s.heading,
    intro: s.intro,
    // New plain objects without _id, so every section gets a fresh one.
    sections: (s.sections || []).map((sec) => ({
      type: sec.type,
      title: sec.title,
      body: sec.body,
      faqItems: (sec.faqItems || []).map((f) => ({ question: f.question, answer: f.answer })),
      localities: [...(sec.localities || [])],
      enabled: sec.enabled,
    })),
    vendorList: { sort: s.vendorList?.sort, limit: s.vendorList?.limit },
    seo: {
      metaTitle: seo.metaTitle, metaDescription: seo.metaDescription,
      ogImage: seo.ogImage, indexing: seo.indexing,
    },
  };
}

// Trims and collapses internal whitespace; non-strings become ''.
function normaliseLocation(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Case-insensitive whole-word match: the name may not touch another letter
// or digit on either side, so "Pune" matches "Pune's" and "(Pune)" but not
// "Punekar". Spaces inside a multi-word name match any whitespace.
function wordRegex(name) {
  const body = escapeRegex(name).replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'iu');
}

// Every text field (as [path, text]) a copy could carry the old city in.
function textFields(page) {
  const out = [];
  const add = (path, text) => { if (typeof text === 'string' && text) out.push([path, text]); };
  const banner = page.banner || {};
  add('banner.headline', banner.headline);
  add('banner.subheadline', banner.subheadline);
  add('banner.ctaLabel', banner.ctaLabel);
  add('heading', page.heading);
  add('intro', page.intro);
  (page.sections || []).forEach((sec, i) => {
    add(`sections.${i}.title`, sec.title);
    add(`sections.${i}.body`, sec.body);
    (sec.faqItems || []).forEach((f, j) => {
      add(`sections.${i}.faqItems.${j}.question`, f.question);
      add(`sections.${i}.faqItems.${j}.answer`, f.answer);
    });
  });
  add('seo.metaTitle', page.seo?.metaTitle);
  add('seo.metaDescription', page.seo?.metaDescription);
  return out;
}

const FIELD_LABELS = {
  'banner.headline': 'banner headline', 'banner.subheadline': 'banner subheadline', 'banner.ctaLabel': 'CTA label',
  heading: 'heading', intro: 'intro', 'seo.metaTitle': 'meta title', 'seo.metaDescription': 'meta description',
};

// 'sections.2.faqItems.0.answer' -> 'section 3 FAQ answer 1'.
function fieldLabel(field) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const m = field.match(/^sections\.(\d+)\.(?:faqItems\.(\d+)\.)?(\w+)$/);
  if (!m) return field;
  const [, i, j, key] = m;
  return j !== undefined ? `section ${+i + 1} FAQ ${key} ${+j + 1}` : `section ${+i + 1} ${key}`;
}

// Warnings for a copy of `source` made for `target` ({ state, city }):
// text that names the source's city or state as a whole word (it'll read
// wrong for the new city), and one warning per localities section that
// has entries (those are the source city's localities). A name the target
// shares (same state, same city) isn't flagged.
// Returns [{ field, match?, message }].
function findSourceMentions(source, target) {
  const s = typeof source?.toObject === 'function' ? source.toObject() : (source || {});
  const names = [];
  if (s.city && slugify(s.city) !== slugify(target.city || '')) names.push(s.city);
  if (s.state && slugify(s.state) !== slugify(target.state || '')) names.push(s.state);
  if (!names.length) return [];

  const warnings = [];
  const regexes = names.map((name) => [name, wordRegex(name)]);
  for (const [field, text] of textFields(s)) {
    for (const [name, re] of regexes) {
      if (re.test(text)) warnings.push({ field, match: name, message: `The ${fieldLabel(field)} mentions “${name}”` });
    }
  }
  if (slugify(s.city || '') !== slugify(target.city || '')) {
    (s.sections || []).forEach((sec, i) => {
      if ((sec.localities || []).some(Boolean)) {
        warnings.push({ field: `sections.${i}.localities`, message: `Localities were copied from ${s.city} — replace them (section ${i + 1})` });
      }
    });
  }
  return warnings;
}

module.exports = { copyContent, normaliseLocation, findSourceMentions, MAX_LOCATION_LENGTH };
