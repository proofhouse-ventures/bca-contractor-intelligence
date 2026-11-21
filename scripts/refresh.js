'use strict';
// Refresh: re-download the BCA contractor listing from data.gov.sg (public
// poll-download API, no sign-in / no API key), re-ingest against the local
// B1 award dataset, report the delta. The source updates half-yearly, so
// this is a manual / scheduled-job step, not a per-run one. NOTE: if BCA
// republishes with a newer "last updated" date, update BCA_SNAPSHOT_DATE in
// src/lib.js to match before re-ingesting — the vintage label must stay true.
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DATASET_ID = 'd_dcda79be4aded5f9e769b8e23ff69b47';
function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) return download(res.headers.location, dest).then(resolve, reject);
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => ws.close(resolve));
      ws.on('error', reject);
    }).on('error', reject);
  });
}
(async () => {
  const rawDir = path.join(__dirname, '..', '..', 'data', 'raw', 'bca');
  fs.mkdirSync(rawDir, { recursive: true });
  const dest = path.join(rawDir, 'bca_registered_contractors.csv');
  const d = await getJson(`https://api-open.data.gov.sg/v1/public/api/datasets/${DATASET_ID}/poll-download`);
  if (!d.data || !d.data.url) throw new Error(`poll-download failed: ${JSON.stringify(d).slice(0, 200)}`);
  await download(d.data.url, dest);
  console.log(`downloaded ${dest}`);
  execFileSync('node', [path.join(__dirname, 'ingest.js'), dest], { stdio: 'inherit' });
})().catch((e) => { console.error(e); process.exit(1); });
