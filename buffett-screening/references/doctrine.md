# The Doctrine And Its Sources

Every criterion in the screen belongs to one of three provenance
classes, and the constants module must label which:

- **Buffett-stated** — he wrote it, and the letter or annual report can
  be named.
- **Implied** — a direct consequence of something he wrote, with the
  inference stated.
- **Author's policy** — an implementation choice. Most numbers are
  here, and saying so is not a weakness of the screen. Pretending
  otherwise is.

A citation attached to a rule the model actually invented is the worst
failure this skill exists to prevent, because it is the one a reader
cannot detect. So the canon below was checked against the original
text at berkshirehathaway.com rather than recalled: every quoted phrase
appears verbatim in the letter named. Three attributions that felt
right did not survive that check and were corrected — they are recorded
under *Corrected Attributions* at the end, because the corrections are
themselves evidence about how this domain fails.

Hold anything added later to the same standard. Model recall of a
Buffett quotation is not evidence for it, and a second model agreeing
is not either: the same secondary sources trained both. The corpus is
checked in at `../sources/` precisely so this costs one `grep` — there
is no excuse for shipping an unverified citation.

## Primary-Source Canon

| Element | Position | Source |
|---|---|---|
| Fractional-business view | "We select our marketable equity securities in much the same way we would evaluate a business for acquisition in its entirety." | 1977 letter |
| The four-part formulation | The business should be "(1) one that we can understand, (2) with favorable long-term prospects, (3) operated by honest and competent people, and (4) available at a very attractive price". Restated in 2007 as "a business we understand; favorable long-term economics; able and trustworthy management; and a sensible price tag" — note *attractive* becoming *sensible* | 1977 letter; 2007 letter, p. 6 |
| Circle of competence | "You only have to be able to evaluate companies within your circle of competence. The size of that circle is not very important; knowing its boundaries, however, is vital." | 1996 letter |
| Economic franchise | Arises from a product or service that "(1) is needed or desired; (2) is thought by its customers to have no close substitute and; (3) is not subject to price regulation" — demonstrated by the ability to price aggressively and earn high returns on capital. A franchise "can tolerate mis-management"; a mere business earns exceptional profits "only if it is the low-cost operator or if supply of its product or service is tight" | 1991 letter |
| Economic goodwill | "What a business can be expected to earn on **unleveraged net tangible assets**, excluding any charges against earnings for amortization of Goodwill, is the best guide to the economic attractiveness of the operation." | 1983 letter, appendix *Goodwill and its Amortization: The Rules and The Realities* |
| Owner earnings | "(a) reported earnings plus (b) depreciation, depletion, amortization, and certain other non-cash charges … less (c) the average annual amount of capitalized expenditures for plant and equipment, etc. that the business requires to fully maintain its long-term competitive position and its unit volume", plus any additional working capital required for the same purpose. He adds that "(c) must be a guess — and one sometimes very difficult to make" | 1986 letter, appendix *Purchase-Price Accounting Adjustments and the "Cash Flow" Fallacy* |
| The one-dollar premise | "Unrestricted earnings should be retained only when there is a reasonable prospect — backed preferably by historical evidence or … by a thoughtful analysis of the future — that for every dollar retained by the corporation, at least one dollar of market value will be created for owners." | 1984 letter; Owner's Manual |
| Intrinsic value | "the discounted value of the cash that can be taken out of a business during its remaining life" — and an estimate rather than a precise figure, which two honest analysts looking at the same facts will compute differently | Owner's Manual |
| Risk factors | Predictability of economics, management's ability, management's owner-orientation, purchase price, and inflation and tax effects — and these cannot be extracted from a database | 1993 letter |
| The turn from cigar butts | "It's far better to buy a wonderful company at a fair price than a fair company at a wonderful price. Charlie understood this early; I was a slow learner." | 1989 letter, *Mistakes of the First Twenty-five Years (A Condensed Version)* |
| Durable moat | "A truly great business must have an enduring moat that protects excellent returns on invested capital." Capitalism guarantees that competitors "will repeatedly assault any business castle that is earning high returns", so a formidable barrier — low-cost production, or a powerful world-wide brand — is essential. "Business history is filled with Roman Candles, companies whose moats proved illusory and were soon crossed." | 2007 letter, p. 6 |
| Enduring rules out rapid change | "Our criterion of 'enduring' causes us to rule out companies in industries prone to rapid and continuous change… A moat that must be continuously rebuilt will eventually be no moat at all." | 2007 letter, p. 6 |
| No superstar dependency | "if a business requires a superstar to produce great results, the business itself cannot be deemed great." The premier brain surgeon's partnership loses its moat when the surgeon goes; the Mayo Clinic's endures "even though you can't name its CEO" | 2007 letter, p. 6 |
| Consistent earning power, no turnarounds | "Demonstrated consistent earning power (future projections are of no interest to us, nor are turnaround situations)" | Acquisition criteria, 2017 annual report p. 23 |
| Good returns on equity with little or no debt | "Businesses earning good returns on equity while employing little or no debt" | Acquisition criteria, 2017 annual report p. 23 |

## What Must Not Be Copied From The Acquisition Criteria

The same published list carries clauses that exist because Berkshire
buys and operates entire companies: "Large purchases (at least 75
million USD of pre-tax earnings unless the business will fit into one
of our existing units)", a stated deal-size range of 5 to 20 billion
USD, "Management in place (we can't supply it)", "An offering price",
a preference for cash and friendly transactions, and no auctions.

The document rules itself out of this application in one sentence:
*"We are not interested, however, in receiving suggestions about
purchases we might make in the general stock market."*

Copying these into a stock screen is a category error, and the
earnings floor is the damaging one: it silently deletes every small
company from the population while looking like a Buffett rule.
Berkshire's capital base, not the doctrine, is what rules out small
opportunities — and it is Berkshire's constraint, not the user's.

## Misattributed Thresholds

None of the following is a Buffett-authored universal rule. Each is a
secondary-book, screener, or Graham-derived convention. Any of them may
be a defensible author's policy; none may be presented as his criteria.

- Return on equity above 15%
- Debt-to-equity below 0.5, or debt repayable from three or four years
  of earnings
- Current ratio above 1.5 or 2
- Ten consecutive years of EPS growth
- Gross margin above 40%, net margin above 20%, or any fixed margin
- Capital expenditure below a fixed share of earnings
- P/E below 15, P/B below 1.5, PEG below 1, or a fixed earnings yield
- A universal 20%, 25% or 30% margin of safety
- Mandatory dividend growth

**The 15% deserves a specific warning.** The number appears in the 1993
letter as "our long-standing goal of increasing Berkshire's per-share
intrinsic value at an average annual rate of 15%" — Berkshire's
objective for itself, which the same paragraph calls "an ever-more
difficult target to hit" as its capital base grows. It is not a
minimum return on equity for an investee.
It is the single most widely repeated fabricated Buffett rule, it will
be in the model's training data attached to his name, and it will feel
correct. Do not let it into the screen unlabelled.

## Numbers That Are Real, And What They Mean

| Number | What it actually is |
|---|---|
| 75M USD pre-tax earnings; the stated deal-size range | Berkshire acquisition-scale constraints, not quality thresholds |
| One dollar of value per dollar retained | A capital-allocation principle, and in the Owner's Manual a test Berkshire applies **to itself**, "on a five-year rolling basis". Buffett states no window for judging an investee. Read as a principle backed by a capital-allocation review; a naive market-value ratio is contaminated by multiple expansion and cycles, so it belongs in the score, not in a gate |
| Five, ten, twenty years | The horizon over which earnings should be materially higher (1996 letter). A forecast horizon, not a required growth rate |
| Ten-year intended ownership | A behavioral underwriting horizon — unwilling to own for ten years, do not own for ten minutes. Not a minimum reporting history |
| 15% | Berkshire's own intrinsic-value growth objective, 1993. Not an investee ROE floor |
| More than a slight margin of safety | Buffett required materially more than a marginal discount but published no percentage. The required discount should rise with business and valuation uncertainty |

## Which Vintage To Encode

Encode the post-Munger, public-equity, quality-at-a-sensible-price
doctrine — roughly 1989 through the recent letters — with the 1977
four-part formulation as its invariant core, elaborated by 1983, 1986,
1989, 1991, 1993, 1996, 2007 and the Owner's Manual.

Four vintages must be kept out, each for a different reason:

**Early cigar-butt Buffett** selects statistically cheap, mediocre or
liquidating businesses and depends on realizing a temporary price
recovery. It contradicts durable compounding and he repudiated it in
the 1989 letter. A screen that mixes the two produces a population
where a failing business at half of book competes with a compounder on
the same score.

**The acquisition-criteria appendix**, as above.

**Berkshire's current scale.** He has said repeatedly that Berkshire's
capital base eliminates opportunities capable of moving its results.
That is a constraint on him. Applying it to an individual's screen
discards the part of the opportunity set most likely to contain what
the doctrine is looking for.

**A blanket technology exclusion.** The acquisition criteria ask for
"Simple businesses (if there's lots of technology, we won't understand
it)" — a statement about the buyer, not the industry, as the clause
itself says. The transferable rule is predictability within the
analyst's own circle, which is why the competence boundary belongs to
the user and is declared during the freeze. The 2007 letter states the
industry-level version precisely, and it is about change rather than
technology: the *enduring* criterion rules out "industries prone to
rapid and continuous change", because "a moat that must be
continuously rebuilt will eventually be no moat at all". Encode that
test. A permanent industry blacklist is a different rule, and
Berkshire's own later holdings contradict it.

**Quality regardless of price is also not the doctrine.** The later
turn relaxed *wonderful price* to *fair price* — 1977 asks for "a very
attractive price", 2007 for "a sensible price tag" — but it did not
remove the valuation discipline or the margin of safety. A screen that
drops the price gate has encoded a caricature.

## Corrected Attributions

Three attributions in an earlier draft of this file were wrong. Each
was produced by two models independently and each felt right; all three
died on contact with the source text. They are kept here because the
pattern is more useful than the corrections.

**Circle of competence was cited to the 1992 letter.** The phrase does
not occur there. It is in the 1996 letter, in the passage that also
supplies the load-bearing clause about knowing the circle's boundaries.

**The intrinsic-value definition was cited to the 1992 letter.** The
sentence beginning "the discounted value of the cash that can be taken
out of a business" is in the Owner's Manual. The 1992 letter discusses
intrinsic value, but does not define it in those words.

**The one-dollar test was said to have been "later corrected" because
market prices distort it.** No support was found. The Owner's Manual
still applies the test on a five-year rolling basis in its current
form. The claim was plausible, useful-sounding, and invented — the
exact failure this skill is built to catch, reached while writing the
document that warns about it.

The lesson for anyone extending this file: a citation that feels
obviously right is the one to check, and agreement between two models
is not a check. Open the letter.
