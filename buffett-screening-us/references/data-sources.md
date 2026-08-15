# Data Sources, Rate Limits, And Resumption

Two layers, per the doctrine contract: SEC EDGAR for the population
mapping and the raw XBRL facts, Yahoo's chart API for prices. Every
endpoint below was exercised against live data during the verification
run (2026-08-15, S&P 500); endpoints and quirks are recorded here so the
mapping can be re-verified, not recalled. Every response is stored raw
with URL, fetch time and the mapping-version string; scripts checkpoint
per key, so a killed or rate-limited run resumes instead of restarting.

## Run Storage

Runs land under `~/.buffett-screening/us/<runId>/` by default — outside
the skill tree, so checkpoints survive skill re-links and are shared
across harness installs. Override the family root with the
`BUFFETT_RUNS_DIR` environment variable; this adapter appends its own
name (`us`, while the A-share adapter uses `ashare`). `<runId>` defaults
to the as-of date; pass `--run <id>` to name a run explicitly.
Structure: `<runId>/raw/` holds the checkpointed raw bodies (facts per
CIK, price series), `<runId>/derived/<cik>.json` the derived stages, and
the run's report sits beside them.

## SEC EDGAR (population mapping + raw facts + filings)

Base: `https://data.sec.gov` and `https://www.sec.gov/Archives`.
**User-Agent must declare contact information** per SEC fair-access
policy — see `lib/http.mjs` `SEC_UA` and replace the placeholder address
with a real one in your own runs.

### Ticker → CIK map

- `https://www.sec.gov/files/company_tickers.json` — one flat array of
  `{cik_str, ticker, title}`; ~10k tickers. Tickers use dashes, not
  dots (`BRK-B`, `BF-B`); normalize dots to dashes before joining.

### Population: S&P 500 constituent list

- Wikipedia "List of S&P 500 companies", the table with
  `id="constituents"`. Eight columns: Symbol, Security, GICS Sector,
  GICS Sub-Industry, HQ, Date added, CIK, Founded. Parsed with a
  rowspan guard (a row without 8 cells is a layout change — warn, do not
  silently misparse). This is a convenience mirror: the authoritative
  membership list is S&P's own; record the fetch URL and time.
- Dual-class pairs share one CIK (GOOGL/GOOG, FOXA/FOX, NWSA/NWS):
  deduplicate on CIK, keep both tickers for display, fetch once.
- Prefer the SEC ticker map for the CIK; fall back to the Wikipedia CIK
  column only where the map lacks the ticker (observed once: AEP).

### Per-entity: submissions + companyfacts

- `https://data.sec.gov/submissions/CIK##########.json` — name, SIC,
  fiscal year end, former names, and the recent filing index (form,
  accession number, primary document, dates).
- `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` —
  every XBRL fact, in namespaces `us-gaap`, `dei`, and IFRS (`ifrs-full`)
  for foreign private issuers. Annual facts carry `form` (`10-K`,
  `20-F`, `40-F`, `10-K/A`, …) and `fp=FY`; balance-sheet facts are
  **instant** (`start` absent or equal to `end`) while income and
  cash-flow facts are duration facts. The derive layer's fact selection
  is in us-gaap-conventions.md.
- Companyfacts holds ~10+ years of history. `dei:EntityCommonStockSharesOutstanding`
  is the cover-page share count — the us-gaap tag is often absent.

### Filings (for qualitative work and valuation inputs)

- The latest 10-K per entity: take the first `10-K`/`10-K/A` in
  `submissions.json` recent filings, then
  `https://www.sec.gov/Archives/edgar/data/<cik-numeric>/<accession-without-dashes>/<primaryDocument>`.
  `fetch-10k-list.mjs` does this.

### Known structural quirks (all observed 2026-08-15)

- **CIK re-registration**: a company can re-register under a new CIK
  (Exxon: 34088 → 2115436); the new CIK carries only recent quarters
  and the annual history stays on the old CIK. `lib/frozen.mjs`
  `ALT_CIKS` merges old-CIK series as a secondary source.
- **20-F IFRS filers** tag under `ifrs-full`, not `us-gaap`; the derive
  layer reads `us-gaap` only, so they classify `unknown` — honest, not
  evaluated. Do not map IFRS tags by best effort.
- **Post-spinoff entities** file stub periods (shorter than a fiscal
  year); the annual filter (340–380 days) rejects them and they
  classify `unknown` — honest, not evaluated.

## Yahoo Finance chart API (prices)

- `https://query1.finance.yahoo.com/v8/finance/chart/<TICKER>?period1=<unix>&period2=<unix>&interval=1d`
  — no key, browser User-Agent. Ticker format uses dashes (`BRK-B`).
  Response JSON: `chart.result[0].timestamp[]` +
  `indicators.quote[0].close[]`. Closes are unadjusted; pair them with
  contemporaneous share counts (the one-dollar test uses shares × price
  at the same date, so splits cancel).
- Price needed on a date: the last close on or before that date;
  no trade → `unknown`, never zero.
- **stooq is dead for automation** (2026-08): it serves a JavaScript
  proof-of-work wall to non-browser clients. Do not add it back as a
  dependency; Yahoo is the frozen source.

## Rate Limits And Resumption

Rate limiting is part of the environment, not an afterthought.

- SEC asks for no more than 10 requests/second; the default spacing is
  260 ms (~4/s) per host, adjustable with `--min-ms`. The verification
  run's 1,000-request facts stage completed with zero failures at that
  spacing.
- On 429/5xx/timeout/empty body: exponential backoff with jitter,
  capped retries per key; a retry merges per key, never replaces a
  completed record.
- Checkpoint per (CIK × file) and per (ticker × price series); resuming
  skips completed keys. Completeness is judged per required field, not
  per row (the doctrine layer's rule, restated for this data).
- The work budget is denominated in requests and wall-clock; budget
  exhaustion is the normal provisional terminator and says so.
- Yahoo tolerated ~2/s with retry; keep spacing ≥ 450 ms there.
