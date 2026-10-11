const mongoose = require('mongoose');
const { slugify } = require('../utils/slug');

// Admin-authored enrichment for one public page (the admin-managed landing
// pages feature): a city page /[category]/[state]/[city]/, or (Phase 4C) a
// state hub /[category]/[state]/ or category hub /[category]/. No record —
// or a draft one — means the page renders exactly as the automatic page
// does today.
//
// state/city are FREE TEXT by client decision: a record must work even
// when the city doesn't exist in the Place taxonomy (e.g. "Gaziabad"), so
// the record is keyed by its own derived slugs, never by a Place._id.
//
// `level` picks which of the three: 'category' pages have no state/city,
// 'state' pages no city (both stored as '' so the unique key below still
// works). Fixed at creation — the controller refuses to change it.
//
// Every Markdown/text field is stored as plain Markdown with ALL HTML tags
// stripped on save — Phase 2 renders it with HTML disabled, this is the
// server-side half of that. Placeholders like {{city}} {{state}}
// {{category}} {{vendorCount}} are stored raw and resolved at render time.

const MAX_SECTIONS = 12;
const CTA_PAIR_MESSAGE = 'Set both the CTA label and the CTA URL, or leave both empty.';

// Repeats until stable so nested/split tags (`<scr<script>ipt>`) can't
// reassemble into a tag after one pass. Only matches real tag syntax — a
// name followed by whitespace, `/` or `>` — so Markdown autolinks
// (`<https://...>`) and plain comparisons (`a < b`) survive.
function stripHtml(value) {
  if (typeof value !== 'string') return value;
  let out = value;
  let prev;
  do {
    prev = out;
    out = out
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<![a-z][^>]*>/gi, '')
      .replace(/<\/?[a-z][a-z0-9-]*(\s[^>]*)?\/?>/gi, '');
  } while (out !== prev);
  return out.trim();
}

function isHttpsUrl(value) {
  if (!value) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

// https://, or a site-relative path. `//host` and `/\host` are rejected —
// browsers treat both as protocol-relative, i.e. an external link.
function isCtaUrl(value) {
  if (!value) return true;
  if (value.startsWith('/')) return !/^\/[/\\]/.test(value);
  return isHttpsUrl(value);
}

const text = (maxlength, extra = {}) => ({ type: String, trim: true, default: '', maxlength, ...extra });

const faqItemSchema = new mongoose.Schema(
  {
    question: text(300, { required: true }),
    answer: text(2000, { required: true }),
  },
  { _id: false }
);

const sectionSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['text', 'faq', 'localities'], required: true },
    title: text(120),
    body: text(5000),
    faqItems: {
      type: [faqItemSchema],
      default: [],
      validate: { validator: (v) => v.length <= 30, message: 'A FAQ section can have at most 30 items.' },
    },
    localities: {
      type: [{ type: String, trim: true, maxlength: 80 }],
      default: [],
      validate: { validator: (v) => v.length <= 100, message: 'A localities section can have at most 100 entries.' },
    },
    enabled: { type: Boolean, default: true },
  },
  { _id: true }
);

const landingPageSchema = new mongoose.Schema(
  {
    level: { type: String, enum: ['category', 'state', 'city'], default: 'city' },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCategory', required: true },
    state: text(80),
    city: text(80),
    stateSlug: { type: String, default: '' },
    citySlug: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    publishedAt: { type: Date, default: null },
    banner: {
      imageUrl: text(2048, { validate: { validator: isHttpsUrl, message: 'banner.imageUrl must be an https:// URL.' } }),
      headline: text(120),
      subheadline: text(250),
      ctaLabel: text(40),
      ctaUrl: text(2048, { validate: { validator: isCtaUrl, message: 'banner.ctaUrl must be an https:// URL or a relative path starting with "/".' } }),
    },
    heading: text(120),
    intro: text(5000),
    sections: {
      type: [sectionSchema],
      default: [],
      validate: { validator: (v) => v.length <= MAX_SECTIONS, message: `A page can have at most ${MAX_SECTIONS} sections.` },
    },
    vendorList: {
      // Hubs only: whether the page shows a "Top vendors" block (hubs are
      // created with false). City pages always show their vendors and
      // ignore this.
      enabled: { type: Boolean, default: true },
      sort: { type: String, enum: ['featured', 'rating', 'newest'], default: 'featured' },
      limit: { type: Number, min: 1, max: 50, default: 12 },
    },
    seo: {
      metaTitle: text(70),
      metaDescription: text(170),
      ogImage: text(2048, { validate: { validator: isHttpsUrl, message: 'seo.ogImage must be an https:// URL.' } }),
      indexing: { type: String, enum: ['auto', 'index', 'noindex'], default: 'auto' },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

landingPageSchema.index({ category: 1, stateSlug: 1, citySlug: 1 }, { unique: true });
landingPageSchema.index({ status: 1 });

// pre('validate'), not pre('save'), so maxlength/required run against the
// stripped values and the derived slugs.
landingPageSchema.pre('validate', function () {
  // A hub has no city (and a category page no state) whatever was sent.
  if (this.level === 'category') this.state = '';
  if (this.level !== 'city') this.city = '';
  this.state = stripHtml(this.state);
  this.city = stripHtml(this.city);
  for (const key of ['headline', 'subheadline', 'ctaLabel']) {
    this.banner[key] = stripHtml(this.banner[key]);
  }
  this.heading = stripHtml(this.heading);
  this.intro = stripHtml(this.intro);
  this.seo.metaTitle = stripHtml(this.seo.metaTitle);
  this.seo.metaDescription = stripHtml(this.seo.metaDescription);
  for (const section of this.sections) {
    section.title = stripHtml(section.title);
    section.body = stripHtml(section.body);
    for (const item of section.faqItems) {
      item.question = stripHtml(item.question);
      item.answer = stripHtml(item.answer);
    }
    section.localities = section.localities.map(stripHtml).filter(Boolean);
  }

  // The CTA button needs both a label and a target — one without the
  // other renders a dead or unlabelled button. Both empty means no CTA.
  // Runs on updates too: the controller assigns onto the loaded doc and
  // calls validate().
  const hasCtaLabel = Boolean(this.banner.ctaLabel);
  const hasCtaUrl = Boolean(this.banner.ctaUrl);
  if (hasCtaLabel !== hasCtaUrl) {
    this.invalidate(hasCtaLabel ? 'banner.ctaUrl' : 'banner.ctaLabel', CTA_PAIR_MESSAGE);
  }

  this.stateSlug = this.state ? slugify(this.state) : '';
  this.citySlug = this.city ? slugify(this.city) : '';

  if (this.level !== 'category' && !this.stateSlug) {
    this.invalidate('state', 'state is required.');
  }
  if (this.level === 'city' && !this.citySlug) {
    this.invalidate('city', 'city is required when level is "city".');
  }

  if (this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
  }
});

module.exports = mongoose.model('LandingPage', landingPageSchema);
module.exports.stripHtml = stripHtml;
module.exports.MAX_SECTIONS = MAX_SECTIONS;
module.exports.CTA_PAIR_MESSAGE = CTA_PAIR_MESSAGE;
