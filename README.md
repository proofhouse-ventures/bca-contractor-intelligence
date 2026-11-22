# Singapore Contractor Intelligence — BCA Grades Joined to Government Contract Wins

Vet a Singapore construction partner before you sign. 24,014 records joining the BCA registered-contractor register (workhead, grade, registration status) to each contractor's actual GeBIZ government contract wins — so you see both the licence and the track record in one query. Built for partner diligence, bid-team research and supplier risk checks. Telephone numbers are stripped at source by design; snapshot-dated (register vintage stated on the listing), not a live feed.

## Coverage and data vintage — read this first

- **The BCA register in this product is a snapshot dated 12 January 2026** — the data.gov.sg file "Listing of Registered Contractors" was last updated on that date (file coverage Jul 2025–Jan 2026; BCA states a half-yearly update frequency). It is **not the live register**: a firm's registration may since have lapsed, been renewed or changed grade. Every output row carries `bca_snapshot_date: "2026-01-12"`, so the vintage travels with the data, and expiry windows are measured from the snapshot date. Confirm a firm's current status on BCA's e-Directory before acting on it.
- **24,014 registrations held by 15,864 firms across 71 workheads** (Contractors Registration System, Facilities Management and Supplier registries as published in the file). Expiry dates as published run from 2025-12-01 to 2029-02-01 (converted to ISO format); 161 registrations in the file already show an expiry before the snapshot date.
- **The award side is the complete GeBIZ award archive FY2021–FY2026** (18,464 awards, award dates 2021-04-01 to 2026-03-31) — the same dataset sold as the GeBIZ Award Intelligence archive.
- **How the join works — and its measured coverage.** The award dataset publishes supplier *names* but no UEN, so firms are matched on deterministic normalised company name (case, punctuation and company-suffix variants collapsed; no fuzzy matching). A normalised name that maps to more than one UEN is attributed to *neither* firm rather than guessed. Coverage: **1,223 of 15,864 registered firms (7.71%) have at least one GeBIZ award**; the join covers **4,902 of 18,464 award rows (26.55%)** and **S$99.41B of S$123.82B awarded value (80.28%)** — BCA-registered firms are the construction core of government contracting. Firms with no match are included as register rows with `gebiz.has_awards: false`; that absence is itself the signal (registered, but no GeBIZ wins in five financial years).

## What you get

- **Registration rows** matching your filters (workhead, grade, company name, postal code prefix, has-awards, minimum award count, minimum total awarded, expiry window), each with: company name, UEN, workhead, grade, additional info, expiry date (ISO), registered address (building number, street, unit, building name, postal code), the firm's GeBIZ overlay (`has_awards`, `award_count`, `total_awarded_sgd`, `first_award_date`, `last_award_date`, `agency_count`, `match_basis`), the snapshot date, and the source attribution.
- **Derived analytics** (key-value store record `ANALYTICS`): registrations and distinct firms by workhead and by grade; per workhead, the number of firms with GeBIZ awards and the total award value *of the firms registered in that workhead* (a firm in several workheads counts in each — it is not value won "under" the workhead); the top 25 matched firms by awarded value; registrations expiring within 90/180/365 days of the snapshot date; and the full join-coverage statement — all computed over the full filtered set, not a sample.

## Data sources, licence and attribution

Source datasets, both published on data.gov.sg and accessed 22 Nov 2026: **"Listing of Registered Contractors"**, Building and Construction Authority (dataset `d_dcda79be4aded5f9e769b8e23ff69b47`, file updated 12 Jan 2026), and the GeBIZ award archive also used by GeBIZ Award Intelligence (dataset `d_1b1f6c0bb2ca9db0ebf0a04a7e2d06a`, awards FY2021–FY2026). Both contain information from the Government of Singapore accessed via data.gov.sg, used under the **Singapore Open Data Licence v1.0** (https://data.gov.sg/open-data-licence).

**Independent tool; not affiliated with BCA, GovTech or GeBIZ, and not endorsed by them.**

Personal-data handling: the BCA source publishes a telephone column — at small firms these numbers may be personal. The telephone is **removed from every record at ingest** and is not present in any output field, so nothing in this product is a personal phone number.

## Pricing

**US$20 per 1,000 results** (US$0.020 per registration row returned to the dataset), with a free allowance of 250 results. Analytics are delivered to the key-value store and are not metered per row.

## Input

| Field | Meaning |
|---|---|
| `mode` | `rows`, `analytics`, or `both` (default) |
| `workhead` | exact BCA workhead code, case-insensitive (e.g. `CW02`, `CR08`, `ME05`) |
| `grade` | exact grade, case-insensitive (e.g. `B2`, `L1`, `Single Grade`) |
| `company` | case-insensitive substring match on company name |
| `postalCode` | postal code prefix (e.g. `73`) |
| `hasAwards` | `true` = only firms with ≥1 GeBIZ award; `false` = only firms with none |
| `minAwardCount` | minimum GeBIZ awards won, FY2021–FY2026 |
| `minTotalAwarded` | minimum total GeBIZ awarded value in SGD |
| `expiryFrom` / `expiryTo` | registration expiry window as `YYYY-MM-DD` (dates as published in the 12 Jan 2026 snapshot file) |
| `limit` | max rows returned (default: all matching) |

## Terms

Outputs are derived from the source datasets named above and are provided as-is for business intelligence. Registrations, statuses, grades and coverage are exactly as published by the sources, subject to the statements in the coverage section above; check it before relying on any aggregate.
