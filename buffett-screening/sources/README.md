# Primary Sources

Berkshire Hathaway shareholder letters 1977 onward, the Owner's Manual,
and the acquisition criteria, extracted to plain text so they can be
searched. Produced by `../fetch-sources.mjs` from
`berkshirehathaway.com`; each file records its source URL on line 1.

**Copyright.** These are Warren E. Buffett's and Berkshire Hathaway's
copyrighted works, reproduced here for reference. The letters index at
berkshirehathaway.com states that all shareholder letters include
copyrighted material reproduced with permission, and the Owner's Manual
carries "Copyright © 1996 By Warren E. Buffett — All Rights Reserved".
Read them at the source: <https://www.berkshirehathaway.com/letters/letters.html>

## Why This Exists

`SKILL.md` and `references/` are a condensation. They state the
doctrine and the criteria, but they drop most of the reasoning, the
examples, and every topic Buffett wrote about that the screen does not
use. When a question cannot be answered from those files, the answer —
if it exists — is here, in his own words.

Use it for: what he actually said about a criterion the references only
summarise; whether a rule attributed to him appears anywhere; how a
position changed between the early and late letters; the worked
examples behind a definition.

## Searching

Files are one paragraph per line, deliberately. The letters are typeset
to a fixed column width, so in the original a sentence breaks across
several lines and a line-oriented tool can never match a quotation that
spans one. Paragraphs are rejoined; tables are left as they were.

```bash
# find a phrase across every year
grep -rn "owner earnings" .

# with surrounding context, since lines are long
grep -ro ".\{0,200\}circle of competence.\{0,200\}" .

# when did a phrase first appear
grep -rln "economic franchise" . | sort
```

Two traps:

- **Apostrophes and quotes are curly** (`can’t`, `“moat”`), faithful to
  the source. Searching for `can't` finds nothing. Match on a word that
  has no punctuation, or use `.` in place of the mark.
- **A negative is weak evidence.** These files cover the shareholder
  letters, not the annual reports around them, not the annual-meeting
  transcripts, and not anything he said elsewhere. "Not found here"
  means not found in this corpus — say it that way.

## Coverage

| Range | Origin | Note |
|---|---|---|
| 1977–1997 | HTML | Fixed-width plain text |
| 1998–2001 | HTML | Behind a landing page; the script follows to the HTML edition |
| 2002–2024 | PDF | Text extracted from the content streams |
| Owner's Manual | HTML | `owners-manual.txt` |
| Acquisition criteria | 2017 annual report PDF | `acquisition-criteria-2017.txt`, the criteria page only |

PDF extraction is best-effort: it recovers the text but not the page
layout, and a stray hyphenation or spacing artefact survives here and
there. If a passage looks garbled, check it against the source URL on
line 1 before quoting it.

## Updating

```bash
node ../fetch-sources.mjs            # fetch whatever is missing
node ../fetch-sources.mjs --force    # re-extract everything
node ../fetch-sources.mjs --list     # show targets without fetching
```

Targets come from the site's own letters index, so a newly published
letter is picked up with no code change.

After any refetch, re-run the citation check — a change in extraction
can silently break a quotation the doctrine file depends on:

```bash
node ../verify-citations.mjs
```
