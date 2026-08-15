# Freeze Template

Start every run from this template. Each entry carries a provenance
label — *Buffett-stated* (canon in the doctrine layer's
references/doctrine.md), *implied*, or *author's policy*. Most numbers
are author's policy, and saying so is not a weakness. Copy this file
into the run directory, fill it in, and record its hash in the run
manifest before any candidate data is fetched; an edit after that is a
freeze violation under the doctrine contract. Where the template says
*to declare*, there is no default — the run cannot start without it.

## Run Identity

| Item | Value | Provenance |
|---|---|---|
| As-of instant | *to declare* (CST date + time, one timestamp for the whole run) | Author's policy |
| Universe | 沪主板/深主板/创业板, market codes and prefix rules per data-sources.md; ST/风险警示板 excluded as a universe cut | User scope |
| Listing-age floor | 5 full calendar years before as-of | Author's policy |
| History window | 5 most recent complete fiscal years + 1 prior year for opening balances | Author's policy |
| Shortlist size N | 20 | Author's policy |
| Competence allow-list | *to declare* (industry or business-model list, or explicitly unenforced — the report must say which) | User-declared |
| Tie-break | `lo` desc, `hi` desc, 5y median RONTOA desc, 5y median ROE desc, ticker asc | Author's policy |

## Work Budget

| Item | Value | Provenance |
|---|---|---|
| Bulk stage | population + org-info + dividends, 112 requests measured 2026-08-15 (60 业绩报表 pages + 50 概况 pages + 2 风险警示板 samples), no manual work | Author's policy |
| Statement stage | full statements for candidates that pass the cheap gates, up to the request cap | Author's policy |
| cninfo stage | annual-report PDFs + announcement record for survivors only | Author's policy |
| Valuation | low/base/high for up to 20 candidates in `lo` order | Author's policy |
| Manual adjudication | none in the default run — moat causal half and management gate stay `unknown`, the run is provisional and says so | Author's policy |
| Request cap / wall-clock cap | *to declare*; exhaustion is the normal terminator and the result is provisional | Author's policy |

## Frozen Conventions

| Item | Value | Provenance |
|---|---|---|
| EBIT | 营业利润 − 其他收益 − 投资收益 − 公允价值变动收益 − 资产处置收益 + 利息支出总额 (cas-conventions.md) | Author's policy; operating-profit discipline is Buffett-stated (1986/2000 letters via doctrine canon) |
| Tax rate | 25% flat | Author's policy |
| Profit scope | 归母 for equity returns; consolidated for cash metrics | Author's policy |
| NTOA | per cas-conventions.md, cash and non-operating investments excluded | Implied from the doctrine's tangible-capital idea (1983 letter) |
| ROE | 归母净利润 / average 归母权益; `na` on non-positive average equity | Implied |
| OEP | 经营现金流净额 − 购建长期资产现金; never called owner earnings | Author's policy; the name discipline is Buffett-stated (1986 letter) |
| Add-backs | the five D&A lines; impairment provisions not added back | Author's policy |
| Gross debt | 短借 + 一年内到期非流动负债 + 长借 + 应付债券 + 租赁负债 | Author's policy |
| Survivability | EBIT / 利息支出总额 ≥ 3× each of 5 years; gross debt ≤ 3× 3y median OEP; zero-debt year passes; non-positive denominators branch to `fail` | Author's policy (doctrine layer defaults) |
| Goodwill | deducted from NTOA; goodwill/parent-equity scored | Implied |
| Prices | 前复权 close for the price gate; 后复权 for the one-dollar test (dividends reinvested); suspended day = `unknown` | Author's policy |
| Units | yuan in Eastmoney bodies, 万元 in cninfo PDFs, recorded per body | Author's policy |
| Listing-age / restructuring | window restarts at restructuring completion year | Author's policy |

## Valuation

| Item | Value | Provenance |
|---|---|---|
| Horizon / terminal growth / required return | 10y / 2.5% / 10% | Author's policy |
| Maintenance-vs-growth capex | *to declare per candidate*; unreconciled → price gate `unknown` | Author's policy |
| Margin of safety | price ≤ low case × (1 − 20%); discount rises to 30% when the low-to-high range width exceeds 50% | Author's policy; the requirement itself is Buffett-stated (1992 letter) |
| Output | low / base / high; the low case decides the gate; a point estimate alone is the fabricated-valuation signature | Author's policy |

## Accounting-Model Classification (Gate 1)

The doctrine layer implements only the ordinary non-financial model;
the A-share adapter inherits that and fixes its classification rule.
Default, author's policy unless noted:

- CSRC industry (`INDUSTRYCSRC1`, org-info table) in 金融业-货币金融服务
  (banks and deposit-takers), 金融业-资本市场服务 (brokers), 金融业-保险业,
  金融业-其他金融业 → `na`, out of scope.
- 电力、热力、燃气及水生产和供应业 (rate-regulated utilities) → `na`,
  out of scope, per the doctrine layer's default.
- Belt-and-braces: a candidate whose full-statement fetch returns no
  rows in the industrial G-tables is a classification `unknown`
  (blocks) — never evaluated from empty data. Verified: banks have no
  rows in `RPT_F10_FINANCE_G*`, because Eastmoney serves financial
  filers a different statement model.
- 房地产业 → `ordinary_nonfinancial`, with the separate subgroup
  reporting in cas-conventions.md.
- Everything else → `ordinary_nonfinancial`.

## Thresholds Never Imported

No ROE floor, no debt-to-equity ceiling, no P/E or P/B cutoff, no
fixed margin-of-safety percentage attributed to Buffett, no 15%
investee ROE floor — the doctrine layer's misattribution list applies
verbatim to this template.
