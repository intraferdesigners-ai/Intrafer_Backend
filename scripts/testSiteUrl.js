// Absolute frontend links in emails: CLIENT_URL normalisation (apex → www,
// trailing slash, whitespace, empty) and the links the email service
// actually renders.
//
// The mailer and the EmailTemplate lookup are stubbed, so this never
// connects to Mongo or sends mail — and it deliberately does NOT load .env
// (which points at production).
//
//   node scripts/testSiteUrl.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizeClientUrl, clientUrl, DEFAULT_CLIENT_URL } = require('../src/utils/siteUrl');

const transporter = require('../src/config/mailer');
const EmailTemplate = require('../src/models/EmailTemplate.model');
const emailService = require('../src/services/email.service');

const WWW = 'https://www.intrafer.in';
const sent = [];
transporter.sendMail = async (mail) => { sent.push(mail); };
EmailTemplate.findOne = async () => null; // no seeded template → hardcoded fallback html

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !h.startsWith('mailto:'));

(async () => {
  await test('default is https://www.intrafer.in', () => {
    assert.strictEqual(DEFAULT_CLIENT_URL, WWW);
  });

  await test('apex → www, trailing slash / whitespace / path stripped', () => {
    for (const raw of ['https://intrafer.in', 'https://intrafer.in/', 'http://intrafer.in', 'intrafer.in',
      ' https://intrafer.in// ', 'https://www.intrafer.in/', 'www.intrafer.in']) {
      assert.strictEqual(normalizeClientUrl(raw), WWW, raw);
    }
  });

  await test('empty / garbage → default; other hosts (local dev) pass through as a bare origin', () => {
    for (const raw of [undefined, null, '', '   ', 'https://', 'ftp://intrafer.in']) {
      assert.strictEqual(normalizeClientUrl(raw), WWW, String(raw));
    }
    assert.strictEqual(normalizeClientUrl('http://localhost:3000/'), 'http://localhost:3000');
  });

  await test('clientUrl() reads CLIENT_URL at call time', () => {
    process.env.CLIENT_URL = 'https://intrafer.in/';
    assert.strictEqual(clientUrl(), WWW);
    delete process.env.CLIENT_URL;
    assert.strictEqual(clientUrl(), WWW);
  });

  await test('every link in every email is on www.intrafer.in when CLIENT_URL is the stale apex', async () => {
    process.env.CLIENT_URL = 'https://intrafer.in';
    const base = { to: 'v@example.com', name: 'N', vendorName: 'V', businessName: 'B' };
    await emailService.sendLeadAssignedEmail({ ...base, enquiryId: 'E1', leadId: 'L1' });
    await emailService.sendSubscriptionExpiringEmail({ ...base, planName: 'P', formattedDate: 'D' });
    await emailService.sendVendorWelcomeEmail(base);
    await emailService.sendOnboardingNudgeEmail(base);
    await emailService.sendVendorApprovedEmail(base);
    const links = sent.flatMap((m) => hrefs(m.html));
    assert.deepStrictEqual(links.sort(), [
      `${WWW}/vendor/dashboard`,
      `${WWW}/vendor/dashboard/leads/L1`,
      `${WWW}/vendor/dashboard/subscription`,
      `${WWW}/vendor/dashboard/subscription`,
      `${WWW}/vendor/dashboard/subscription`,
    ]);
    delete process.env.CLIENT_URL;
  });

  await test('no hardcoded https://intrafer.in link left in src/ or the email seed', () => {
    const files = [];
    const walk = (dir) => fs.readdirSync(dir).forEach((n) => {
      const p = path.join(dir, n);
      if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
    });
    walk(path.join(__dirname, '../src'));
    files.push(path.join(__dirname, 'seedEmailTemplates.js'));
    // app.js's CORS allow-list legitimately names the apex as an origin.
    const hits = files
      .filter((f) => !f.endsWith(path.join('src', 'app.js')))
      .filter((f) => /https?:\/\/intrafer\.in/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(path.join(__dirname, '..'), f));
    assert.deepStrictEqual(hits, []);
  });

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
