# A-Share Governance Evidence

The doctrine layer's management gate usually rests at `unknown` after
an automated pass. A-shares offer a richer public record, so the gate
can be better evidenced — but the doctrine's rules still bind: absence
never admits, keyword hits are material not verdicts, and the verdict
is worded as *no disqualifying evidence detected in the named sources,
as of this date*. This file maps each signal to its source and its
verdict class; none of it converts `unknown` into `pass` by itself.

## Signals And Sources

| Signal | Source | Verdict class |
|---|---|---|
| Audit-opinion type per period | `OPINION_TYPE` on the full-statement rows (Eastmoney G-tables) | Standard unqualified: pass-side fact for the survivability gate. Qualified / disclaimer / adverse / emphasis-of-matter: `fail`-class at the survivability gate and management-gate evidence. Missing: `unknown` |
| Exchange inquiry letters (问询函/关注函) | cninfo announcement titles over the window | Unresolved inquiry: management gate stays `unknown` (blocks, does not fail). A resolved inquiry with no finding: noted, not scored |
| Regulator investigation (立案调查) | cninfo announcement titles | Unresolved: `unknown`. Concluded penalty (行政处罚/纪律处分/公开谴责): `fail`-class evidence |
| Controlling-shareholder pledging | cninfo 质押公告 titles; ratio aggregated from the announcement record | > 50% of the controlling stake pledged: management-gate evidence. Threshold is author's policy; pledging alone is never an automatic verdict |
| 资金占用 / 违规担保 | cninfo announcements; annual-report related-party sections | Confirmed by regulator or restatement: `fail`-class. Rumored or alleged: `unknown` |
| Pre-announcement vs reported earnings (业绩变脸) | 业绩预告/快报 announcements versus reported `PARENT_NETPROFIT` | A systematic, repeated gap outside the announced range is the strongest A-share honesty signal; one miss is noise. Feed the management gate; direction and persistence both count |
| Goodwill impairment history | `ASSET_IMPAIRMENT_LOSS`, `GOODWILL` changes on the G-tables | Acquisitions later written off: management-gate (capital-allocation) evidence, per the doctrine layer |
| Auditor changes | `ACCOUNTFIRM_NAME` history; cninfo 更换会计师事务所公告 | A change following a qualified opinion is evidence; a change alone is not |
| 借壳 / control change | `FORMERNAME`, restructuring announcements | Not a governance verdict — it restarts the history window (cas-conventions.md) |

## Application Rules

- **Aggregate, do not search-match.** Query the announcement record
  for the code over the window and classify titles locally; the
  full-text topical search is for population-wide sweeps, not
  per-company verdicts.
- **The one-direction rule.** These sources can push a gate from
  `unknown` to `fail` or keep it `unknown`; they cannot push it to
  `pass`. An honest automated run ends with the management gate named
  and unresolved on most survivors, exactly as the doctrine layer
  predicts.
- **Peer comparison inherits the frozen peer set.** Where the gate
  compares returns or margins against sector peers, the peer set is a
  frozen constant, not whatever looks informative after the shortlist
  is visible.
- **Persistence of the record.** Each stored announcement body carries
  URL, fetch time and title; a verdict cites the record, not a memory
  of it.
