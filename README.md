# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)

A radar over the DefiLlama protocol index: every protocol that records no token
yet, ranked by what its launch would be worth, each with a farm plan. Built by
an AI agent for make.fun's "Build the best token launch radar" bounty.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot, writes the
ranked board to `out/board.json` and the dashboard's data to `out/data.js`,
copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json`
with the vendored make.fun library. Open `out/dashboard/index.html` in a
browser; the page renders with no network. The run is deterministic: the same
snapshot writes the same bytes.

## The board

198 rows on this snapshot: all 40 watchlist protocols plus every other
rankable pre-token protocol below the floor. A protocol is pre-token when its
record carries no market cap, no CoinGecko id and no symbol; wrapped, staked
and bridged products of tokens that already trade, versioned pools, bridges,
liquid staking and exchange products are set aside by the same rule the
watchlist uses, so the board never ranks a token that already trades. The
40 live-token protocols with the largest market caps are shown apart, with
their market caps, never mixed into the ranking.

## Ranking methodology (model radar-2)

Implied value follows only from the snapshot's own figures, and its base rate
is calibrated from the snapshot's own live market instead of a hand-picked
constant:

```
multiple   = shrink(median live mcap/TVL of the category, toward the
             market-wide median, prior 4), clamped to [0.05, 1.50]
implied    = round(tvl_usd x multiple
             x (1 + clamp(change_7d, -50, 100) / 100 x 0.5)
             x (0.6 + min(age_days, 1095) / 1095 x 0.4)
             x (1 + 0.02 x min(chains - 1, 4)))
```

- **The multiple is the market talking.** The snapshot holds 128 live-token
  protocols with a positive market cap and a TVL; their median
  market-cap-to-TVL ratio is 0.21x. Each category takes its own live median,
  shrunk toward that market median with a prior weight of 4 protocols so a
  thin category cannot set an extreme rate, and clamped to 0.05x–1.50x.
  Live ratios are winsorized at 5x before the median. A category with no live
  protocol takes the market median.
- **Growth, clamped.** Seven-day TVL change moves the value by half its
  weight, clamped to −50%/+100% so one wild week cannot decide a rank.
  A protocol with no reported change is scored as flat.
- **Maturity is time with no token.** Age is the time since the protocol was
  first listed. The factor rises from 0.6 to 1.0 over three years; an
  unlisted age uses 365 days.
- **Breadth.** Each extra chain adds 2%, up to 4 extra chains: more chains
  reach more farmers.
- **The range.** Each detail view shows a low–high range from the category's
  25th–75th percentile live ratios, shrunk the same way.

No protocol name is special-cased: the same function scores every row, and the
dashboard recomputes it in the page (the model sandbox re-runs the ranking
with the reader's own constants). A protocol on the board records no token in
the snapshot; that is the record, never proof it has none. Implied value is
this entry's own model claim, never a price or a prediction of a launch.

## Farm plans

Each row carries seven steps, derived from the protocol's own record — its
category, its chains, its TVL and its age — never from a hand-written list of
names: a fresh wallet, the category's core action with capital sized by TVL
($50–$250) and chain-specific gas, a second qualifying action, a weekly
cadence, an age-based hold (30–60 days), a points-and-claims check, and a
sizing-and-log step. Every step states what it costs and how long it takes.

## Layout

- `main.ts` — the entrypoint: snapshot in, board + data + dashboard + dossier out
- `lib/model.ts` — the model: calibration, ranking, farm plans, board checks
- `vendor/makefun-board.ts` — make.fun's dossier library, as the kit ships it
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`
- `screenshots/` — the board, a protocol's detail view, a filtered view
