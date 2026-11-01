// Duplicate-text detection for landing pages (warn only — never changes
// indexing, never blocks saving or publishing). Pure: exercised by
// scripts/testLandingFingerprint.js.
//
// A page's fingerprint covers what visitors read below the banner: the
// intro and every enabled section (type, title, body, FAQ questions and
// answers, localities). Before hashing, the page's own location and
// category are replaced by neutral tokens — both where they come from a
// placeholder ({{city}} {{state}} {{category}} {{vendorCount}}) and where
// the admin typed the name literally ("Pune") — then case and whitespace
// are normalised. Two pages whose text differs only in their own city /
// state / category name / vendor count therefore get the same hash.
// vendorCount is tokenised only through its placeholder: a literal number
// is left alone, so "3 BHK" never collapses into a count.
//
// A second hash covers the FAQ set alone (items sorted), so pages that
// share every FAQ are flagged even when their intro differs. Pages with
// no text (or no FAQ) get no hash: empty drafts never "match".
const crypto = require('crypto');

const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;
const NEUTRAL = { city: '⟦city⟧', state: '⟦state⟧', category: '⟦category⟧', vendorCount: '⟦count⟧' };

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Placeholders -> neutral tokens (unknown ones -> '', as the renderer
// strips them), then the page's own literal names -> tokens.
function neutralize(text, names) {
  if (typeof text !== 'string' || !text) return '';
  let out = text.replace(TOKEN, (_, name) => NEUTRAL[name] ?? '');
  // Longest first, so "Navi Mumbai" is replaced before "Mumbai".
  const literal = Object.entries(names)
    .filter(([, value]) => typeof value === 'string' && value.trim().length >= 2)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [key, value] of literal) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(value.trim())}(?=$|[^\\p{L}\\p{N}])`, 'giu');
    out = out.replace(re, (_, before) => `${before}${NEUTRAL[key]}`);
  }
  return out;
}

const normalize = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');

// { full, faq } hashes (either null when there is nothing to compare).
// `names`: the page's own { city, state, category } display names.
function pageFingerprints(page, names) {
  const n = (text) => normalize(neutralize(text, names));
  const sections = (page.sections || []).filter((s) => s && s.enabled !== false);
  const faqs = sections.filter((s) => s.type === 'faq')
    .flatMap((s) => (s.faqItems || []).map((f) => `${n(f.question)}\u0001${n(f.answer)}`))
    .filter((f) => f !== '\u0001')
    .sort();
  const parts = [
    `intro:${n(page.intro)}`,
    ...sections.map((s) => [
      s.type, n(s.title), n(s.body),
      ...(s.faqItems || []).map((f) => `${n(f.question)}\u0001${n(f.answer)}`),
      ...(s.localities || []).map(n),
    ].join('\u0002')),
  ];
  const hasText = Boolean(n(page.intro)) || sections.some((s) => n(s.title) || n(s.body) || (s.faqItems || []).length || (s.localities || []).length);
  return { full: hasText ? hash(parts.join('\u0003')) : null, faq: faqs.length ? hash(faqs.join('\u0003')) : null };
}

const levelOfPage = (p) => p.level || 'city';
const idOf = (p) => String(p._id);
const categoryIdOf = (p) => String(p.category?._id || p.category || '');
const namesOf = (p) => ({ city: p.city || '', state: p.state || '', category: p.category?.name || p.categoryName || '' });

// pages: every page to compare (same shape as LandingPage, category
// populated with name, or `categoryName` set). Only pages of the same level
// and category are compared. Returns Map id -> { sameText: [page], sameFaq: [page] }
// where sameFaq excludes pages already in sameText (it's the FAQ-only line).
function findDuplicates(pages) {
  const prints = pages.map((p) => ({ page: p, ...pageFingerprints(p, namesOf(p)) }));
  const groups = new Map();
  const add = (key, entry) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(entry); };
  for (const e of prints) {
    const scope = `${levelOfPage(e.page)}|${categoryIdOf(e.page)}`;
    if (e.full) add(`${scope}|full|${e.full}`, e);
    if (e.faq) add(`${scope}|faq|${e.faq}`, e);
  }
  const result = new Map();
  for (const e of prints) {
    const scope = `${levelOfPage(e.page)}|${categoryIdOf(e.page)}`;
    const others = (key) => (key ? (groups.get(key) || []).filter((o) => o !== e).map((o) => o.page) : []);
    const sameText = others(e.full && `${scope}|full|${e.full}`);
    const textIds = new Set(sameText.map(idOf));
    const sameFaq = others(e.faq && `${scope}|faq|${e.faq}`).filter((p) => !textIds.has(idOf(p)));
    result.set(idOf(e.page), { sameText, sameFaq });
  }
  return result;
}

// Compact form for API responses.
const summarize = (p) => ({ _id: p._id, city: p.city || '', state: p.state || '', status: p.status || 'draft' });

module.exports = { neutralize, pageFingerprints, findDuplicates, summarize, NEUTRAL };
