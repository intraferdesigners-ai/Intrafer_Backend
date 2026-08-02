// Downloads the Department of Posts' "All India Pincode Directory till last
// month" dataset from data.gov.in and caches it to scripts/data/pincode-directory-raw.json.
// Run this once (and re-run whenever you want fresher data) before
// scripts/seedLocalities.js, which reads from the cached file rather than
// hitting the API on every seed run.
//
// Source: https://www.data.gov.in/resource/all-india-pincode-directory-till-last-month
// (Department of Posts, Ministry of Communications). The resource id and
// api-key below were captured from that page's own live "Preview" request —
// data.gov.in's webservice API requires an api-key tied to a registered
// account for direct calls, but the key this page's preview widget uses is
// unauthenticated-accessible and works for this resource. If it stops
// working, open the resource page above, click the CSV "Preview" icon, and
// re-capture the request URL from the browser's network tab.
const fs = require('fs');
const path = require('path');

const RESOURCE_ID = '5c2f62fe-5afa-4119-a499-fec9d604d5bd';
const API_KEY = '579b464db66ec23bdd000001cdc3b564546246a772a26393094f5645';
const PAGE_SIZE = 10000;
const OUT_DIR = path.resolve(__dirname, 'data');
const OUT_FILE = path.join(OUT_DIR, 'pincode-directory-raw.json');

async function fetchPage(offset) {
  const url = `https://api.data.gov.in/resource/${RESOURCE_ID}?api-key=${API_KEY}&format=json&limit=${PAGE_SIZE}&offset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Page at offset ${offset} failed: HTTP ${res.status}`);
  const body = await res.json();
  return body;
}

async function main() {
  console.log('Fetching page 1 to discover total record count...');
  const first = await fetchPage(0);
  const total = first.total;
  console.log(`Total records available: ${total}`);

  const all = [...first.records];
  let offset = PAGE_SIZE;

  while (offset < total) {
    console.log(`Fetching offset ${offset}...`);
    const page = await fetchPage(offset);
    all.push(...page.records);
    offset += PAGE_SIZE;
    await new Promise((r) => setTimeout(r, 300)); // be polite to the API
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(all));
  console.log(`\nSaved ${all.length} records to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('Fetch failed:', err);
  process.exit(1);
});
