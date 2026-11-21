'use strict';
// Tests for B10. Run: npm test
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const zlib = require('zlib');
const { parseCsv, normaliseName, toIsoDate, normaliseBcaRecord, joinAwards, buildOutputRows, filterContractors, computeAnalytics } = require('../src/lib');

const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`ok - ${name}`); }

const raw = fx('raw_extract.json');
const awards = fx('awards_extract.json');
const bcaRows = raw.map(normaliseBcaRecord);
const { firmsByUen, stats } = joinAwards(bcaRows, awards);
const outRows = buildOutputRows(bcaRows, firmsByUen);

check('normalisation: field whitelist strips tel_no; na -> null; expiry dd/mm/yyyy -> ISO', () => {
  const r = bcaRows[0];
  assert.deepStrictEqual(Object.keys(r).sort(), ['additional_info', 'address', 'company_name', 'expiry_date', 'grade', 'uen', 'workhead'].sort());
  assert.ok(!('tel_no' in r) && !('tel' in r));
  assert.strictEqual(r.additional_info, null);
  assert.strictEqual(bcaRows[2].additional_info, 'Some info');
  assert.strictEqual(r.expiry_date, '2028-02-01');
  assert.strictEqual(toIsoDate('15/06/2026'), '2026-06-15');
  assert.strictEqual(toIsoDate('2026-06-15'), null);
  assert.strictEqual(toIsoDate(''), null);
});
check('normaliseName: punctuation, case and suffix variants collapse to one key', () => {
  assert.strictEqual(normaliseName('ACME BUILDERS PTE. LTD.'), normaliseName('Acme Builders Pte Ltd'));
  assert.strictEqual(normaliseName('ACME BUILDERS PTE. LTD.'), 'ACME BUILDERS PTE LTD');
  assert.strictEqual(normaliseName('A & B PRIVATE LIMITED'), 'A AND B PTE LTD');
  assert.strictEqual(normaliseName('X LIMITED'), 'X LTD');
});
check('join: normalised-name match aggregates awards per firm', () => {
  const acme = firmsByUen.get('200000001A').gebiz;
  assert.strictEqual(acme.has_awards, true);
  assert.strictEqual(acme.award_count, 2);
  assert.strictEqual(acme.total_awarded_sgd, 350000);
  assert.strictEqual(acme.agency_count, 2);
  assert.strictEqual(acme.first_award_date, '2023-01-15');
  assert.strictEqual(acme.last_award_date, '2024-03-01');
  assert.strictEqual(acme.match_basis, 'normalised_name');
  const beta = firmsByUen.get('200000002B').gebiz; // mixed-case supplier name in the awards fixture
  assert.strictEqual(beta.award_count, 1);
  assert.strictEqual(beta.total_awarded_sgd, 50000);
});
check('join: ambiguous normalised name (>1 UEN) is attributed to NEITHER firm', () => {
  assert.strictEqual(firmsByUen.get('200000003C').gebiz.has_awards, false);
  assert.strictEqual(firmsByUen.get('200000004D').gebiz.has_awards, false);
  assert.strictEqual(stats.ambiguous_name_matches, 1);
  assert.strictEqual(stats.ambiguous_award_rows, 1);
  assert.strictEqual(stats.matched_suppliers, 2);
  assert.strictEqual(stats.matched_award_rows, 3);
  assert.strictEqual(stats.bca_firms_with_awards, 2);
});
check('output rows: vintage label on every row; fixture phone numbers appear nowhere', () => {
  assert.strictEqual(outRows.length, 5);
  for (const r of outRows) assert.strictEqual(r.bca_snapshot_date, '2026-01-12');
  const blob = JSON.stringify(outRows);
  for (const tel of ['91234567', '68881234', '97778888']) assert.ok(!blob.includes(tel), `phone ${tel} leaked`);
  assert.ok(!/tel/i.test(blob.replace(/hotel/gi, '')), 'a tel-like key leaked');
});
check('filters compose: workhead + hasAwards + minTotalAwarded + expiry window', () => {
  assert.strictEqual(filterContractors(outRows, { workhead: 'cw01' }).length, 1);
  assert.strictEqual(filterContractors(outRows, { hasAwards: true }).length, 3);
  assert.strictEqual(filterContractors(outRows, { hasAwards: false }).length, 2);
  assert.strictEqual(filterContractors(outRows, { minTotalAwarded: 100000 }).length, 2);
  assert.strictEqual(filterContractors(outRows, { minAwardCount: 2 }).length, 2);
  assert.strictEqual(filterContractors(outRows, { expiryTo: '2026-12-31' }).length, 3);
  assert.strictEqual(filterContractors(outRows, { company: 'gamma' }).length, 2);
  assert.strictEqual(filterContractors(outRows, { postalCode: '123' }).length, 2);
});
check('analytics: workhead rollup and snapshot-relative expiry windows', () => {
  const an = computeAnalytics(outRows, stats);
  assert.strictEqual(an.rows_analysed, 5);
  assert.strictEqual(an.distinct_firms, 4);
  assert.strictEqual(an.firms_with_gebiz_awards, 2);
  const cr13 = an.by_workhead.find((w) => w.workhead === 'CR13');
  assert.strictEqual(cr13.registrations, 2);
  assert.strictEqual(cr13.firms, 2);
  // From snapshot 2026-01-12: BETA (2026-06-15, 154d) in 180/365; GAMMA x2 (2026-03-01, 48d) in 90/180/365; ACME (2028) in none.
  assert.strictEqual(an.expiry_windows_from_snapshot.within_90_days, 2);
  assert.strictEqual(an.expiry_windows_from_snapshot.within_180_days, 3);
  assert.strictEqual(an.expiry_windows_from_snapshot.within_365_days, 3);
  assert.strictEqual(an.top_firms_by_awarded_value[0].total_awarded_sgd, 350000);
});
check('parseCsv reads the real source header shape', () => {
  const recs = parseCsv('company_name,uen_no,workhead,grade,additional_info,expiry_date,building_no,street_name,unit_no,building_name,postal_code,tel_no\nX PTE LTD,200000009X,CW01,B1,na,01/01/2028,1,ST,,BLDG,999999,61234567\n');
  const r = normaliseBcaRecord(recs[0]);
  assert.strictEqual(r.uen, '200000009X');
  assert.ok(!JSON.stringify(r).includes('61234567'));
});
check('full bundled snapshot: counts, join stats, exact keys, NO source phone values anywhere', () => {
  const snap = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, '..', 'data', 'contractors.json.gz'))).toString('utf8'));
  assert.strictEqual(snap.rows.length, 24014);
  assert.strictEqual(snap.meta.join.bca_firms, 15864);
  assert.strictEqual(snap.meta.join.matched_suppliers, 1223); // distinct suppliers AFTER normalisation (1,224 of 6,152 raw published name strings — 7 raw strings collapse under normalisation; award rows and value agree exactly across both counting methods)
  assert.strictEqual(snap.meta.join.matched_award_rows, 4902);
  assert.strictEqual(snap.meta.join.bca_firms_with_awards, 1223);
  assert.strictEqual(snap.meta.join.ambiguous_name_matches, 0);
  const expectedKeys = ['company_name', 'uen', 'workhead', 'grade', 'additional_info', 'expiry_date', 'address', 'gebiz', 'bca_snapshot_date', 'source_dataset'].sort();
  assert.deepStrictEqual(Object.keys(snap.rows[0]).sort(), expectedKeys);
  // Exact-value check: no field of any row may equal a telephone value from the raw source.
  const csvPath = path.join(__dirname, '..', '..', 'data', 'raw', 'bca', 'bca_registered_contractors.csv');
  const tels = new Set(parseCsv(fs.readFileSync(csvPath, 'utf8')).map((r) => r.tel_no).filter(Boolean));
  assert.ok(tels.size > 10000, 'expected the source tel set to load');
  const fieldValues = new Set();
  for (const r of snap.rows) {
    for (const v of Object.values(r.address)) if (v) fieldValues.add(String(v));
    fieldValues.add(r.company_name); fieldValues.add(r.uen);
  }
  for (const t of tels) assert.ok(!fieldValues.has(t), `source telephone value present in snapshot: ${t}`);
});
console.log(`\n${passed} tests passed`);
