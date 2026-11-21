'use strict';
// Ingest: BCA "Listing of Registered Contractors" CSV (data.gov.sg) + the B1
// award dataset -> bundled joined snapshot (data/contractors.json.gz).
// PRIVACY: the source's tel_no column is dropped in lib.normaliseBcaRecord
// (field whitelist) and never enters this snapshot. Counts are reported at
// every stage so the build report can cite them verbatim.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parseCsv, normaliseBcaRecord, registrationKey, joinAwards, buildOutputRows, BCA_SNAPSHOT_DATE } = require('../src/lib');

const bcaCsv = process.argv[2] || path.join(__dirname, '..', '..', 'data', 'raw', 'bca', 'bca_registered_contractors.csv');
const awardsJson = process.argv[3] || path.join(__dirname, '..', '..', 'b2-sg-data-api', 'data', 'awards.json');
const outPath = path.join(__dirname, '..', 'data', 'contractors.json.gz');

const rawRecs = parseCsv(fs.readFileSync(bcaCsv, 'utf8'));
console.log(`BCA raw rows: ${rawRecs.length}`);
console.log(`BCA source columns: ${Object.keys(rawRecs[0]).join(', ')}`);
const withTel = rawRecs.filter((r) => r.tel_no && r.tel_no.trim()).length;
console.log(`BCA rows carrying tel_no (all stripped): ${withTel}`);

const seen = new Set();
const bcaRows = [];
let dupes = 0;
for (const rec of rawRecs) {
  const row = normaliseBcaRecord(rec);
  const key = registrationKey(row);
  if (seen.has(key)) { dupes++; continue; }
  seen.add(key);
  bcaRows.push(row);
}
console.log(`BCA normalised registrations: ${bcaRows.length} (exact duplicates removed: ${dupes})`);

const awards = JSON.parse(fs.readFileSync(awardsJson, 'utf8')).rows;
console.log(`B1 award rows: ${awards.length}`);

const { firmsByUen, stats } = joinAwards(bcaRows, awards);
console.log('join stats: ' + JSON.stringify(stats));

const rows = buildOutputRows(bcaRows, firmsByUen);
rows.sort((a, b) => (a.company_name + a.workhead + a.grade).localeCompare(b.company_name + b.workhead + b.grade));
const workheads = [...new Set(rows.map((r) => r.workhead))].sort();
const expiries = rows.map((r) => r.expiry_date).filter(Boolean).sort();
const meta = {
  dataset: 'Listing of Registered Contractors joined with Government Procurement via GeBIZ',
  publishers: 'Building and Construction Authority (BCA) and Government Procurement via GeBIZ, both via data.gov.sg',
  dataset_ids: ['d_dcda79be4aded5f9e769b8e23ff69b47', 'B1 GeBIZ awards dataset (data.gov.sg)'],
  licence: 'Singapore Open Data Licence v1.0 — https://data.gov.sg/open-data-licence',
  accessed: new Date().toISOString().slice(0, 10),
  bca_snapshot_date: BCA_SNAPSHOT_DATE,
  bca_file_coverage: 'Registrations as published in the data.gov.sg file last updated 12 Jan 2026 (file coverage Jul 2025-Jan 2026, stated half-yearly frequency). This is a snapshot, not the live register.',
  rows: rows.length,
  bca_raw_rows: rawRecs.length,
  exact_duplicates_removed: dupes,
  firms: stats.bca_firms,
  workheads: workheads.length,
  expiry_range: expiries.length ? `${expiries[0]} to ${expiries[expiries.length - 1]}` : null,
  join: stats,
  personal_data_handling: 'The BCA source publishes a tel_no (telephone) column on every row; it may contain personal mobiles at small firms. It was stripped at ingest by field whitelist (lib.normaliseBcaRecord) and appears nowhere in this snapshot or any output. No other person-level fields exist in either source: the BCA file carries company name, UEN, workhead, grade, expiry and business address only; the award file carries company names, agencies, dates and amounts only.',
};
fs.writeFileSync(outPath, zlib.gzipSync(JSON.stringify({ meta, rows }, null, 0)));
console.log(`ingested ${rows.length} joined rows -> ${outPath}`);
