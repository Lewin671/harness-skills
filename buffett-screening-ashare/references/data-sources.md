# Data Sources, Rate Limits, And Resumption

Two layers, per the doctrine contract: Eastmoney for the bulk
population and the derived statements, cninfo for raw filings and the
announcement record. Every endpoint below was exercised against live
data during the verification pass (2026-08-15); endpoints, field names
and market codes are recorded here so the mapping can be re-verified,
not recalled. Every response is stored raw with URL, fetch time, unit
and the mapping-version string; scripts checkpoint per
company-period, so a killed or rate-limited run resumes instead of
restarting.

## Eastmoney (bulk + statements)

Base: `https://datacenter-web.eastmoney.com/api/data/v1/get`.
Common parameters: `reportName`, `columns=ALL`, `filter=(...)`,
`pageNumber`, `pageSize=500`, `source=WEB&client=WEB` (or
`source=HSF10&client=PC` for the F10 tables). All requests need a
browser User-Agent.

### Population: 业绩报表 `RPT_LICO_FN_CPD`

- Filter per fiscal year: `(REPORTDATE='YYYY-12-31')(TRADE_MARKET_CODE="…")`,
  one request set per year per market, page size 500. Five years ×
  three markets ≈ 120 requests for the whole population.
- Market codes (verified): 上交所主板 `069001001001`, 上交所风险警示板
  `069001001003`, 深交所主板 `069001002001`, 深交所创业板
  `069001002002`, 深交所风险警示板 `069001002005`, 老三板
  `069001004002`, 北交所 `069001017`.
- **Universe = the three main-board/ChiNext codes above.** The
  risk-warning boards carry the ST population and are excluded as a
  universe cut; NEEQ/老三板/北交所 rows share the same table and pages
  and must be filtered, never silently counted. Belt-and-braces: also
  filter code prefix (60/00/30) and drop rows whose name contains ST.
- Rows are one per company per annual period; the table is a mix of
  raw and vendor-computed fields. Use only: `SECURITY_CODE`,
  `SECURITY_NAME_ABBR`, `TOTAL_OPERATE_INCOME`, `PARENT_NETPROFIT`,
  `DEDUCT_BASIC_EPS`, `BPS`, `MGJYXJJE`. Never `WEIGHTAVG_ROE`,
  `XSMLL`, `YSHZ`, `SJLHZ`, `YSTZ`, `SJLTZ`, `ZXGXL` — vendor-computed
  definitions that are not yours and not frozen.

### Full statements: `RPT_F10_FINANCE_GBALANCE`, `_GINCOME`, `_GCASHFLOW`

- Filter: `(SECURITY_CODE="600519")(REPORT_DATE='YYYY-12-31')`,
  `source=HSF10&client=PC`. One row per period; select the annual
  report-type row, never row order.
- These are the complete CAS statements — goodwill, parent equity,
  long-term borrowings, the operating-profit components, and the
  cash-flow supplementary add-backs are all present. Field mappings in
  cas-conventions.md. The summary tables (`RPT_DMSK_FN_*`) lack those
  fields; do not derive the exact stage from them.
- `OPINION_TYPE` rides on these rows — the per-period audit opinion.

### Company profile: `RPT_F10_BASIC_ORGINFO`

- Batchable without a filter (page through the whole table, ≈50 pages
  at 500/page). Fields used: `SECURITY_CODE`, `LISTING_DATE`,
  `FORMERNAME`, `SECURITY_TYPE`, `TATOLNUMBER`, `ACCOUNTFIRM_NAME`.

### Dividends: `RPT_SHAREBONUS_DET`

- Filter `(SECURITY_CODE="…")`, sort by `EX_DIVIDEND_DATE`. Fields:
  `PRETAX_BONUS_RMB` (per 10 shares, pre-tax), `EX_DIVIDEND_DATE`,
  `EQUITY_RECORD_DATE`, `PLAN_NOTICE_DATE`.

### Prices: `push2his.eastmoney.com`

- `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600519&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&beg=20210101&end=20260815`
- `secid` market prefix: `1.` Shanghai, `0.` Shenzhen. `fqt=1` 前复权,
  `2` 后复权, `0` 不复权. Daily bars, CSV lines
  `date,open,close,high,low,volume,amount`.
- **The realtime quote host (`push2.eastmoney.com`) returned empty
  replies from automation during verification** — treat it as
  unavailable. The history host above works and is the frozen price
  source. Fallback: 腾讯
  `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,2021-01-01,2026-08-15,500,qfq`
  (前复权 `qfq`, 后复权 `hfq`).
- 停牌 days are absent from the series, never zero. A price needed on
  a suspended day is `unknown`.

## cninfo (raw filings + announcement record)

cninfo (巨潮资讯网) is the designated disclosure platform. Verified
recipe, both exchanges:

- Query: `POST http://www.cninfo.com.cn/new/hisAnnouncement/query` with
  form fields `pageNum`, `pageSize`, `column=sse` (Shanghai) or
  `column=szse` (Shenzhen), `tabName=fulltext`, `searchkey=<code>`,
  `category=category_ndbg_szsh` (annual reports), `seDate=YYYY-MM-DD~YYYY-MM-DD`,
  `sortName=&sortType=&isHLtitle=true`. Headers: User-Agent,
  `Referer: http://www.cninfo.com.cn/`, `X-Requested-With:
  XMLHttpRequest`.
- **Use `searchkey=<code>` for both markets**; the Shenzhen `stock=`
  parameter returned empty results in verification.
- Annual-report PDF: `https://static.cninfo.com.cn/<adjunctUrl>`.
- Announcement record (governance): same query without the category
  filter over the window, filter titles locally for the governance
  keywords (governance.md). Full-text topical searches (e.g. 年报问询函)
  also work and are the audit trail for population-wide sweeps.

## Rate Limits And Resumption

Rate limiting is part of the environment, not an afterthought; the
scripts implement it and the freeze budget accounts for it.

- Concurrency ≤ 2 per host; minimum interval between requests 300 ms
  (default, adjustable in the freeze).
- On 429/5xx/timeout/empty body: exponential backoff with jitter,
  capped retries per key; a retry merges per company-period, never
  replaces a completed record.
- Checkpoint per (company × period × statement / query-page); resuming
  skips completed keys. Completeness is judged per required field, not
  per row (the doctrine layer's rule, restated for this data).
- The work budget is denominated in requests and wall-clock; budget
  exhaustion is the normal provisional terminator and says so.
- Burst testing in verification (12 rapid sequential requests) drew no
  throttle from the datacenter host; cninfo and the kline host were
  exercised at one-request pace. The 300 ms default is a floor, not a
  measured limit — raise spacing before raising concurrency.
