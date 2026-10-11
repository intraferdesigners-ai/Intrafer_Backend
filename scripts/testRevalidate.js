// utils/revalidate.js: the frontend cache purge never throws, never blocks
// its caller beyond one attempt, retries in the background with backoff,
// stops on 400/401 (logged loudly once), batches tags, logs failures with
// the tags (never the secret), and is a no-op without configuration.
//
// Uses a local fake frontend whose answers are scripted per request; no DB,
// no .env. Retry delays are shortened; Project.find is stubbed for
// purgeVendor.
//
//   node scripts/testRevalidate.js

const assert = require('assert');
const http = require('http');
const { execFileSync } = require('child_process');

const Project = require('../src/models/Project.model');
const cache = require('../src/utils/revalidate');
const { TAGS, TAG_PREFIXES, vendorTag, projectTag, vendorTags, projectTags, reviewTags } = require('../src/utils/cacheTags');

const SECRET = 'test-only-secret-not-real';
const REAL_DELAYS = [...cache.RETRY_DELAYS_MS];
cache.RETRY_DELAYS_MS = [30, 60, 90];

// Every [revalidate] line the module logs, in order.
const logs = [];
for (const level of ['log', 'warn', 'error']) {
  const orig = console[level];
  console[level] = (...a) => {
    const line = a.join(' ');
    if (line.startsWith('[revalidate]')) logs.push(line);
    else orig(...a);
  };
}
const out = (s) => process.stdout.write(`${s}\n`);

let passed = 0;
async function test(name, fn) {
  logs.length = 0;
  await fn();
  passed += 1;
  out(`ok - ${name}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await sleep(5);
  return pred();
}

(async () => {
  // Fake frontend: `script` is a queue of statuses ('hang' = never answer);
  // when empty it answers `fallback`.
  let script = [];
  let fallback = 200;
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      hits.push({ path: req.url, method: req.method, secret: req.headers['x-revalidate-secret'], body: JSON.parse(body || '{}') });
      const status = script.length ? script.shift() : fallback;
      if (status === 'hang') return;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end('{}');
    });
  }).listen(0);
  const URL_ = `http://127.0.0.1:${server.address().port}`;
  const reset = (s = [], f = 200) => { script = s; fallback = f; hits.length = 0; };

  try {
    await test('tag constants are exactly the agreed set', () => {
      assert.deepStrictEqual(Object.values(TAGS).sort(), ['homepage', 'landing', 'projects', 'reviews', 'stats', 'taxonomy', 'vendors']);
      assert.deepStrictEqual(TAG_PREFIXES, { VENDOR: 'vendor:', PROJECT: 'project:' });
      assert.strictEqual(vendorTag('abc'), 'vendor:abc');
      assert.strictEqual(projectTag('p1'), 'project:p1');
    });

    await test('event tag sets: vendor (+ each project), project, review', () => {
      assert.deepStrictEqual(vendorTags('v1', ['p1', 'p2']), ['vendors', 'vendor:v1', 'projects', 'stats', 'landing', 'project:p1', 'project:p2']);
      assert.deepStrictEqual(projectTags('p1', 'v1'), ['projects', 'project:p1', 'vendor:v1', 'stats']);
      assert.deepStrictEqual(reviewTags('v1'), ['reviews', 'vendor:v1', 'vendors', 'stats']);
    });

    await test('production retry schedule is ~5 s, 30 s, 2 min', () => {
      assert.deepStrictEqual(REAL_DELAYS, [5000, 30000, 120000]);
    });

    await test('no REVALIDATE_SECRET / CLIENT_URL: no request, false, one warning only', async () => {
      reset();
      delete process.env.REVALIDATE_SECRET;
      process.env.CLIENT_URL = URL_;
      const r = [await cache.purge({ tags: ['vendors'] }), await cache.purge({ tags: ['projects'] })];
      process.env.REVALIDATE_SECRET = SECRET;
      delete process.env.CLIENT_URL;
      r.push(await cache.purge({ tags: ['vendors'] }));
      assert.deepStrictEqual(r, [false, false, false]);
      assert.strictEqual(hits.length, 0);
      assert.strictEqual(logs.length, 1);
      assert.match(logs[0], /not set; frontend cache purges are disabled/);
    });

    process.env.REVALIDATE_SECRET = SECRET;
    process.env.CLIENT_URL = `${URL_}/`; // trailing slash normalised away

    await test('ok: one POST /api/revalidate/ with the secret header, de-duplicated tags, paths; no retries', async () => {
      reset();
      assert.strictEqual(await cache.purge({ tags: ['vendors', 'vendor:1', 'vendors'], paths: ['/a/'] }), true);
      await sleep(200);
      assert.deepStrictEqual(hits, [{ path: '/api/revalidate/', method: 'POST', secret: SECRET, body: { tags: ['vendors', 'vendor:1'], paths: ['/a/'] } }]);
      assert.deepStrictEqual(logs, []);
    });

    await test('more than 20 tags are sent in batches of 20', async () => {
      reset();
      const tags = Array.from({ length: 45 }, (_, i) => `project:${i}`);
      assert.strictEqual(await cache.purge({ tags, paths: ['/x/'] }), true);
      assert.deepStrictEqual(hits.map((h) => h.body.tags.length), [20, 20, 5]);
      assert.deepStrictEqual(hits.flatMap((h) => h.body.tags).sort(), [...tags].sort());
      assert.deepStrictEqual(hits.map((h) => h.body.paths), [['/x/'], [], []]);
    });

    await test('failing then recovering frontend: false at once, background retries, succeeds on retry 2, then stops', async () => {
      reset([500, 503], 200);
      const t = Date.now();
      assert.strictEqual(await cache.purge({ tags: ['vendor:42', 'projects'] }), false);
      assert.ok(Date.now() - t < 500, 'caller waited for the retries');
      assert.strictEqual(hits.length, 1);
      assert.ok(await until(() => logs.some((l) => l.includes('succeeded'))));
      await sleep(250); // no further retries after success
      assert.strictEqual(hits.length, 3);
      assert.ok(hits.every((h) => h.body.tags.join() === 'vendor:42,projects'));
      assert.deepStrictEqual(logs, [
        '[revalidate] purge failed (HTTP 500); retry 1/3 in 0.03 s; tags: vendor:42, projects; paths: -',
        '[revalidate] purge failed (HTTP 503); retry 2/3 in 0.06 s; tags: vendor:42, projects; paths: -',
        '[revalidate] purge succeeded on retry 2/3; tags: vendor:42, projects; paths: -',
      ]);
      assert.ok(!logs.join('').includes(SECRET));
    });

    await test('persistently failing frontend: 1 + 3 retries with growing delays, then gives up with the tags logged', async () => {
      reset([], 500);
      assert.strictEqual(await cache.purge({ tags: ['stats'] }), false);
      assert.ok(await until(() => logs.some((l) => l.includes('gave up')), 3000));
      await sleep(250);
      assert.strictEqual(hits.length, 4);
      assert.strictEqual(logs.length, 4);
      assert.match(logs[3], /^\[revalidate\] purge gave up after 4 attempts \(HTTP 500\); tags: stats; paths: -$/);
      assert.deepStrictEqual(logs.slice(0, 3).map((l) => l.match(/retry (\d)\/3 in ([\d.]+ s)/).slice(1).join(' ')), ['1 0.03 s', '2 0.06 s', '3 0.09 s']);
    });

    await test('frontend down (connection refused): false, retried in the background, logged, never throws', async () => {
      process.env.CLIENT_URL = 'http://127.0.0.1:1';
      assert.strictEqual(await cache.purge({ tags: ['vendors'] }), false);
      assert.ok(await until(() => logs.some((l) => l.includes('gave up')), 3000));
      process.env.CLIENT_URL = URL_;
      assert.strictEqual(logs.length, 4);
      assert.match(logs[0], /^\[revalidate\] purge failed \(fetch failed\); retry 1\/3 .*tags: vendors/);
    });

    await test('401 (secret mismatch): no retries; one loud log per process, even across purges', async () => {
      reset([401, 401], 200);
      assert.strictEqual(await cache.purge({ tags: ['vendors'] }), false);
      assert.strictEqual(await cache.purge({ tags: ['projects'] }), false);
      await sleep(300);
      assert.strictEqual(hits.length, 2); // no retries
      assert.strictEqual(logs.length, 1);
      assert.match(logs[0], /^\[revalidate\] PURGE REJECTED BY THE FRONTEND \(HTTP 401\) — check that REVALIDATE_SECRET is identical/);
      assert.ok(!logs[0].includes(SECRET));
    });

    await test('400 (bad request) is also final: no retries', async () => {
      reset([400], 200);
      assert.strictEqual(await cache.purge({ tags: ['vendors'] }), false);
      await sleep(300);
      assert.strictEqual(hits.length, 1);
      assert.strictEqual(logs.length, 0); // the loud line was already logged once
    });

    await test('a 400/401 on a retry stops the retries too', async () => {
      reset([500, 401], 200);
      await cache.purge({ tags: ['stats'] });
      await sleep(300);
      assert.strictEqual(hits.length, 2);
      assert.strictEqual(logs.length, 1);
      assert.match(logs[0], /retry 1\/3/);
    });

    await test('hang: the first attempt times out after 3 s, the caller gets false, a retry then succeeds', async () => {
      reset(['hang'], 200);
      const t = Date.now();
      assert.strictEqual(await cache.purge({ tags: ['stats'] }), false);
      const ms = Date.now() - t;
      assert.ok(ms >= cache.TIMEOUT_MS - 200 && ms < cache.TIMEOUT_MS + 1500, `${ms} ms`);
      assert.match(logs[0], /^\[revalidate\] purge failed \(timeout after 3000 ms\); retry 1\/3/);
      assert.ok(await until(() => logs.some((l) => l.includes('succeeded on retry 1/3'))));
    });

    await test('never blocks: a fire-and-forget call returns to the caller immediately even when the frontend hangs', async () => {
      reset(['hang'], 200);
      const t = Date.now();
      const pending = cache.purge({ tags: ['vendors'] }); // not awaited, like the controllers
      assert.ok(Date.now() - t < 20);
      await pending;
      await until(() => logs.some((l) => l.includes('succeeded')));
    });

    await test('pending retries never keep the process alive (timers are unref\'d)', () => {
      const t = Date.now();
      execFileSync(process.execPath, ['-e', `
        process.env.REVALIDATE_SECRET = 'x'; process.env.CLIENT_URL = 'http://127.0.0.1:1';
        console.error = () => {};
        require(${JSON.stringify(require.resolve('../src/utils/revalidate'))}).purge({ tags: ['vendors'] });
      `], { timeout: 4000 });
      assert.ok(Date.now() - t < 3000, 'process waited for the 5 s retry');
    });

    await test('bad input never throws (non-array tags, undefined)', async () => {
      reset();
      assert.strictEqual(typeof (await cache.purge({ tags: 'vendors' })), 'boolean');
      assert.strictEqual(typeof (await cache.purge()), 'boolean');
    });

    await test('helpers never throw synchronously into the caller (bad args become a logged false)', async () => {
      let promise;
      assert.doesNotThrow(() => { promise = cache.purgeLanding(123); });
      assert.strictEqual(await promise, false);
      assert.match(logs[0], /^\[revalidate\] purgeLanding failed/);
    });

    await test('purgeVendor: sends the vendor tags plus project:<id> for each of its projects', async () => {
      const sent = [];
      const realPurge = cache.purge;
      cache.purge = async (payload) => { sent.push(payload); return true; };
      const realFind = Project.find;
      Project.find = (filter) => ({ select: () => ({ lean: async () => (String(filter.vendorId) === 'v9' ? [{ _id: 'p1' }, { _id: 'p2' }] : []) }) });
      try {
        await cache.purgeVendor('v9');
      } finally {
        cache.purge = realPurge;
        Project.find = realFind;
      }
      assert.deepStrictEqual(sent, [{ tags: ['vendors', 'vendor:v9', 'projects', 'stats', 'landing', 'project:p1', 'project:p2'] }]);
    });

    await test('purgeVendor: a DB failure is logged, never thrown', async () => {
      const realFind = Project.find;
      Project.find = () => ({ select: () => ({ lean: async () => { throw new Error('db down'); } }) });
      try {
        assert.strictEqual(await cache.purgeVendor('v1'), false);
        assert.match(logs[0], /^\[revalidate\] purgeVendor v1 failed: db down/);
      } finally {
        Project.find = realFind;
      }
    });
  } finally {
    server.close();
  }
  out(`\n${passed} passed`);
  process.exit(0);
})().catch((err) => {
  process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
