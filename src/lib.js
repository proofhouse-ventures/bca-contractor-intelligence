'use strict';
// B10 core logic — pure functions, no Apify dependency. Shared by ingest, main.js and tests.
// Scope: BCA "Listing of Registered Contractors" (data.gov.sg, Singapore Open Data
// Licence v1.0) joined with B1's GeBIZ award dataset (same licence).
// PRIVACY: the BCA source carries one person-level field, tel_no (telephone
// numbers, possibly personal mobiles at small firms). It is NEVER read into a
// normalised record — see normaliseBcaRecord, which whitelists fields.
// The B1 award side carries company names and amounts only (already scrubbed
// at B1's own ingest).

const BCA_SNAPSHOT_DATE = '2026-01-12'; // data.gov.sg "last updated" for the source file

// Parse one CSV line (RFC4180 quoting handled; the BCA file is simple).
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0]).map((h) => h.trim().replace(/^﻿/, ''));
  return lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const rec = {};
    header.forEach((h, i) => { rec[h] = vals[i] !== undefined ? vals[i].trim() : ''; });
    return rec;
  });
}

// Deterministic company-name normalisation — the join key (the B1 award
// dataset has no supplier UEN, so names are all there is). Identical rules
// were used by the independent verification probe; both must agree exactly.
function normaliseName(name) {
  let n = String(name || '').toUpperCase().trim();
  n = n.replace(/&/g, ' AND ');
  n = n.replace(/[.,'"()\-/]/g, ' ');
  n = n.replace(/\s+/g, ' ').trim();
  n = n.replace(/\bPRIVATE LIMITED\b/g, 'PTE LTD');
  n = n.replace(/\bPTE LIMITED\b/g, 'PTE LTD');
  n = n.replace(/\bLIMITED\b/g, 'LTD');
  return n;
}

// dd/mm/yyyy (as published by BCA) -> ISO yyyy-mm-dd; anything else -> null.
function toIsoDate(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v || '').trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// Normalise one raw BCA CSV record. FIELD WHITELIST: tel_no is deliberately
// absent — it is dropped here, at ingest, and never enters the snapshot.
// Raw fields: company_name, uen_no, workhead, grade, additional_info,
// expiry_date, building_no, street_name, unit_no, building_name, postal_code, tel_no.
function normaliseBcaRecord(r) {
  return {
    company_name: r.company_name,
    uen: r.uen_no,
    workhead: r.workhead,
    grade: r.grade,
    additional_info: r.additional_info && r.additional_info.toLowerCase() !== 'na' ? r.additional_info : null,
    expiry_date: toIsoDate(r.expiry_date),
    address: {
      building_no: r.building_no || null,
      street_name: r.street_name || null,
      unit_no: r.unit_no || null,
      building_name: r.building_name || null,
      postal_code: r.postal_code || null,
    },
  };
}

function registrationKey(r) {
  return [r.uen, r.workhead, r.grade].join('|');
}

// Join: group award rows by normalised supplier name; group BCA firms by
// normalised company name. A normalised name mapping to >1 UEN is AMBIGUOUS:
// its award aggregates are attributed to neither firm (counted in stats).
// Returns { firmsByUen: Map uen -> {company_name, uen, gebiz}, stats }.
function joinAwards(bcaRows, awardRows) {
  const firmNameByUen = new Map();
  for (const r of bcaRows) if (!firmNameByUen.has(r.uen)) firmNameByUen.set(r.uen, r.company_name);
  const uensByNormName = new Map();
  for (const [uen, name] of firmNameByUen) {
    const k = normaliseName(name);
    if (!uensByNormName.has(k)) uensByNormName.set(k, []);
    uensByNormName.get(k).push(uen);
  }
  const awardsByNormName = new Map();
  for (const a of awardRows) {
    const k = normaliseName(a.supplier_name);
    if (!awardsByNormName.has(k)) awardsByNormName.set(k, []);
    awardsByNormName.get(k).push(a);
  }
  const empty = () => ({ has_awards: false, award_count: 0, total_awarded_sgd: 0, first_award_date: null, last_award_date: null, agency_count: 0, match_basis: null });
  const firmsByUen = new Map();
  for (const [uen, name] of firmNameByUen) firmsByUen.set(uen, { company_name: name, uen, gebiz: empty() });
  let matchedSuppliers = 0;
  let matchedAwardRows = 0;
  let matchedAwardValue = 0;
  let ambiguousSuppliers = 0;
  let ambiguousAwardRows = 0;
  for (const [k, rows] of awardsByNormName) {
    const uens = uensByNormName.get(k);
    if (!uens) continue;
    if (uens.length > 1) { ambiguousSuppliers++; ambiguousAwardRows += rows.length; continue; }
    const g = firmsByUen.get(uens[0]).gebiz;
    const agencies = new Set(rows.map((a) => a.agency));
    g.has_awards = true;
    g.award_count = rows.length;
    g.total_awarded_sgd = Math.round(rows.reduce((s, a) => s + (a.awarded_amt || 0), 0) * 100) / 100;
    const dates = rows.map((a) => a.award_date).filter(Boolean).sort();
    g.first_award_date = dates.length ? dates[0] : null;
    g.last_award_date = dates.length ? dates[dates.length - 1] : null;
    g.agency_count = agencies.size;
    g.match_basis = 'normalised_name';
    matchedSuppliers++;
    matchedAwardRows += rows.length;
    matchedAwardValue += g.total_awarded_sgd;
  }
  const totalAwardValue = awardRows.reduce((s, a) => s + (a.awarded_amt || 0), 0);
  const stats = {
    bca_firms: firmNameByUen.size,
    bca_firms_with_awards: [...firmsByUen.values()].filter((f) => f.gebiz.has_awards).length,
    award_rows_total: awardRows.length,
    award_suppliers_total: awardsByNormName.size,
    matched_suppliers: matchedSuppliers,
    matched_award_rows: matchedAwardRows,
    matched_award_value_sgd: Math.round(matchedAwardValue * 100) / 100,
    total_award_value_sgd: Math.round(totalAwardValue * 100) / 100,
    ambiguous_name_matches: ambiguousSuppliers,
    ambiguous_award_rows: ambiguousAwardRows,
  };
  return { firmsByUen, stats };
}

// Attach each firm's award overlay to its registration rows.
function buildOutputRows(bcaRows, firmsByUen) {
  return bcaRows.map((r) => ({
    company_name: r.company_name,
    uen: r.uen,
    workhead: r.workhead,
    grade: r.grade,
    additional_info: r.additional_info,
    expiry_date: r.expiry_date,
    address: r.address,
    gebiz: firmsByUen.get(r.uen).gebiz,
    bca_snapshot_date: BCA_SNAPSHOT_DATE,
    source_dataset: 'Listing of Registered Contractors (data.gov.sg) joined with Government Procurement via GeBIZ (data.gov.sg)',
  }));
}

function filterContractors(rows, input) {
  const company = input.company ? input.company.toLowerCase() : null;
  const workhead = input.workhead ? input.workhead.toUpperCase() : null;
  const grade = input.grade ? input.grade.toLowerCase() : null;
  return rows.filter((r) => {
    if (company && !r.company_name.toLowerCase().includes(company)) return false;
    if (workhead && r.workhead.toUpperCase() !== workhead) return false;
    if (grade && r.grade.toLowerCase() !== grade) return false;
    if (input.postalCode && (!r.address.postal_code || !r.address.postal_code.startsWith(String(input.postalCode)))) return false;
    if (input.hasAwards === true && !r.gebiz.has_awards) return false;
    if (input.hasAwards === false && r.gebiz.has_awards) return false;
    if (input.minAwardCount != null && r.gebiz.award_count < input.minAwardCount) return false;
    if (input.minTotalAwarded != null && r.gebiz.total_awarded_sgd < input.minTotalAwarded) return false;
    if (input.expiryFrom && (!r.expiry_date || r.expiry_date < input.expiryFrom)) return false;
    if (input.expiryTo && (!r.expiry_date || r.expiry_date > input.expiryTo)) return false;
    return true;
  });
}

const round2 = (n) => Math.round(n * 100) / 100;

function computeAnalytics(rows, joinStats) {
  const byWorkheadMap = new Map();
  const byGradeMap = new Map();
  const firmSeen = new Map(); // uen -> gebiz (first occurrence)
  for (const r of rows) {
    if (!byWorkheadMap.has(r.workhead)) byWorkheadMap.set(r.workhead, { registrations: 0, firms: new Set(), matchedFirms: new Set(), matchedAwardValue: 0 });
    const w = byWorkheadMap.get(r.workhead);
    w.registrations++;
    w.firms.add(r.uen);
    if (r.gebiz.has_awards && !w.matchedFirms.has(r.uen)) { w.matchedFirms.add(r.uen); w.matchedAwardValue += r.gebiz.total_awarded_sgd; }
    if (!byGradeMap.has(r.grade)) byGradeMap.set(r.grade, { registrations: 0, firms: new Set() });
    byGradeMap.get(r.grade).registrations++;
    byGradeMap.get(r.grade).firms.add(r.uen);
    if (!firmSeen.has(r.uen)) firmSeen.set(r.uen, r.gebiz);
  }
  const byWorkhead = [...byWorkheadMap.entries()].map(([workhead, w]) => ({
    workhead,
    registrations: w.registrations,
    firms: w.firms.size,
    firms_with_gebiz_awards: w.matchedFirms.size,
    // A firm registered in several workheads counts in each: this is the
    // award value OF FIRMS REGISTERED IN the workhead, not value won under it.
    award_value_of_registered_firms_sgd: round2(w.matchedAwardValue),
  })).sort((a, b) => b.registrations - a.registrations);
  const byGrade = [...byGradeMap.entries()].map(([grade, g]) => ({ grade, registrations: g.registrations, firms: g.firms.size }))
    .sort((a, b) => b.registrations - a.registrations);
  const topFirms = [...firmSeen.entries()]
    .filter(([, g]) => g.has_awards)
    .map(([uen, g]) => ({ uen, award_count: g.award_count, total_awarded_sgd: g.total_awarded_sgd, last_award_date: g.last_award_date }))
    .sort((a, b) => b.total_awarded_sgd - a.total_awarded_sgd)
    .slice(0, 25);
  // Expiry windows measured from the SNAPSHOT date (the register's own
  // vintage), not from today — the file is a 12 Jan 2026 snapshot.
  const snap = new Date(BCA_SNAPSHOT_DATE + 'T00:00:00Z').getTime();
  const windows = { within_90_days: 0, within_180_days: 0, within_365_days: 0, already_expired_at_snapshot: 0 };
  for (const r of rows) {
    if (!r.expiry_date) continue;
    const days = (new Date(r.expiry_date + 'T00:00:00Z').getTime() - snap) / 86400000;
    if (days < 0) windows.already_expired_at_snapshot++;
    else {
      if (days <= 90) windows.within_90_days++;
      if (days <= 180) windows.within_180_days++;
      if (days <= 365) windows.within_365_days++;
    }
  }
  return {
    rows_analysed: rows.length,
    distinct_firms: firmSeen.size,
    firms_with_gebiz_awards: [...firmSeen.values()].filter((g) => g.has_awards).length,
    by_workhead: byWorkhead,
    by_grade: byGrade,
    top_firms_by_awarded_value: topFirms,
    expiry_windows_from_snapshot: windows,
    join_coverage: joinStats || null,
    coverage: `All 24,014 BCA contractor registrations in the data.gov.sg file last updated 12 Jan 2026 (15,864 firms, 71 workheads), joined to the complete GeBIZ award archive FY2021-FY2026 (18,464 awards, award dates 2021-04-01 to 2026-03-31) on normalised company name — the award dataset publishes no supplier UEN, so the join is name-based and deterministic; normalised names mapping to more than one UEN are attributed to neither firm. Join coverage: 1,223 of 6,145 distinct award suppliers after name normalisation (1,224 of 6,152 published supplier name strings), 4,902 of 18,464 award rows (26.55%), S$99.41B of S$123.82B awarded value (80.28%); 1,223 of 15,864 registered firms (7.71%) have at least one award. The BCA register is a 12 Jan 2026 snapshot (~10 months old at build): registrations may since have lapsed, been renewed or changed grade — confirm current status on BCA's e-Directory. Telephone numbers published in the source were stripped at ingest and appear nowhere in this product.`,
  };
}

module.exports = { BCA_SNAPSHOT_DATE, parseCsv, parseCsvLine, normaliseName, toIsoDate, normaliseBcaRecord, registrationKey, joinAwards, buildOutputRows, filterContractors, computeAnalytics };
