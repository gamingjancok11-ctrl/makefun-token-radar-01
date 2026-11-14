// The token radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot can honestly call pre-token: the 40 on the
// watchlist (the floor, never a ceiling) plus every other protocol below the floor that records no
// token and is not a wrapped, staked or bridged product of one that trades. A protocol is pre-token
// when its record carries no market cap, no CoinGecko id and no symbol; wrapped and staked products,
// versioned pools, bridges, liquid staking and exchange products are set aside by the same rule the
// watchlist uses, so the board never ranks a token that already trades.
//
// Implied value follows only from the snapshot's own figures, and its base rate is calibrated from
// the snapshot's own live market instead of a hand-picked constant:
//
//   multiple   the category's market-cap-to-TVL multiple, from the live-token protocols in the
//              snapshot: the median ratio of the category's live protocols, winsorized at 5x and
//              shrunk toward the market-wide median with a prior weight of 4 protocols, clamped
//              to [0.05, 1.50]. A category with no live protocol takes the market-wide median.
//   growth     clamp(change_7d, -50, 100) per cent; growthMult = 1 + growth / 100 x 0.5
//   maturity   0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   breadth    1 + 0.02 x min(chains - 1, 4)
//   implied    max(1, round(tvl_usd x multiple x growthMult x maturity x breadth))
//
// The range a protocol's detail view shows comes from the same calibration: the category's 25th and
// 75th percentile live ratios, shrunk the same way, in place of the median. No protocol name is ever
// special-cased: the same function scores every row, and the dashboard recomputes it in the page.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  prior_n: number;
  ratio_cap: number;
  multiple_min: number;
  multiple_max: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
}

export const MODEL: ModelConstants = {
  prior_n: 4,
  ratio_cap: 5,
  multiple_min: 0.05,
  multiple_max: 1.5,
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.02,
  breadth_max_extra: 4,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 40;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  category_rank: number;
  category_size: number;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  model: {
    multiple: number;
    multiple_category: string;
    live_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the farm plan is derived in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  category_rank: number;
  category_size: number;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  multiple: number;
  multiple_category: string;
  live_n: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

/** One category's calibration: the live ratios behind its multiple. */
export interface CalibrationRow {
  category: string;
  live_n: number;
  median_ratio: number;
  multiple: number;
  low_multiple: number;
  high_multiple: number;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  calibration: { global_median: number; global_low: number; global_high: number; live_n: number; rows: CalibrationRow[] };
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted array, or `fallback` when it is empty. */
function medianOf(sorted: number[], fallback: number): number {
  if (sorted.length === 0) return fallback;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The p-th percentile of a sorted array (nearest-rank), or `fallback` when it is empty. */
function percentileOf(sorted: number[], p: number, fallback: number): number {
  if (sorted.length === 0) return fallback;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[at]!;
}

/** A category's multiple from its live ratios: shrink the median toward the global one, then clamp. */
function shrink(value: number, n: number, global: number, model: ModelConstants): number {
  const shrunk = (n * value + model.prior_n * global) / (n + model.prior_n);
  return Math.min(model.multiple_max, Math.max(model.multiple_min, shrunk));
}

/** The market's own pricing, read off the snapshot's live-token protocols. */
export interface Calibration {
  globalMedian: number;
  globalLow: number;
  globalHigh: number;
  liveN: number;
  byCategory: Map<string, { n: number; median: number; multiple: number; low: number; high: number }>;
}

export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    // A live token's market cap over its TVL, winsorized so one thin protocol cannot set a category.
    const ratio = Math.min(model.ratio_cap, Math.max(0.001, p.mcap_usd / p.tvl_usd));
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  all.sort((a, b) => a - b);
  const globalMedian = medianOf(all, 0.25);
  const globalLow = percentileOf(all, 25, globalMedian);
  const globalHigh = percentileOf(all, 75, globalMedian);
  const out = new Map<string, { n: number; median: number; multiple: number; low: number; high: number }>();
  for (const [key, list] of byCategory) {
    list.sort((a, b) => a - b);
    const median = medianOf(list, globalMedian);
    out.set(key, {
      n: list.length,
      median: round4(median),
      multiple: round4(shrink(median, list.length, globalMedian, model)),
      low: round4(shrink(percentileOf(list, 25, median), list.length, globalLow, model)),
      high: round4(shrink(percentileOf(list, 75, median), list.length, globalHigh, model)),
    });
  }
  return { globalMedian: round4(globalMedian), globalLow: round4(globalLow), globalHigh: round4(globalHigh), liveN: all.length, byCategory: out };
}

/** The multiple a protocol's category carries, or the market-wide median when it has no live peer. */
function multipleFor(p: SnapshotProtocol, calibration: Calibration, model: ModelConstants): { multiple: number; liveN: number; low: number; high: number } {
  const row = calibration.byCategory.get(p.category ?? 'Other');
  if (row === undefined) {
    const g = Math.min(model.multiple_max, Math.max(model.multiple_min, calibration.globalMedian));
    return { multiple: g, liveN: 0, low: Math.min(model.multiple_max, Math.max(model.multiple_min, calibration.globalLow)), high: Math.min(model.multiple_max, Math.max(model.multiple_min, calibration.globalHigh)) };
  }
  return { multiple: row.multiple, liveN: row.n, low: row.low, high: row.high };
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  model: ModelConstants = MODEL,
): { implied: number; low: number; high: number; multiple: number; liveN: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_extra);
  const { multiple, liveN, low, high } = multipleFor(protocol, calibration, model);
  const factors = growthMult * maturityMult * breadthMult;
  return {
    implied: Math.max(1, Math.round(protocol.tvl_usd * multiple * factors)),
    low: Math.max(1, Math.round(protocol.tvl_usd * low * factors)),
    high: Math.max(1, Math.round(protocol.tvl_usd * high * factors)),
    multiple,
    liveN,
    growthPct,
    growthMult: round4(growthMult),
    maturityMult: round4(maturityMult),
    breadthMult: round4(breadthMult),
    age,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** The watchlist's excluded categories: wrapped, staked and bridged products of trading tokens. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Exchange names a wrapped product's name begins with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a wrapped, staked or bridged product of a token that already trades. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x));
}

/** Whether a protocol is one the board may rank: pre-token and not a wrapped product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calibration = calibrate(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the floor, not just the largest.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, calibration, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  // A row's standing inside its own category, so the detail view can say "No. 1 of 34 Risk Curators".
  const categorySeen = new Map<string, number>();
  const categorySize = new Map<string, number>();
  for (const s of scored) {
    const key = s.p.category ?? 'Other';
    categorySize.set(key, (categorySize.get(key) ?? 0) + 1);
  }
  return scored.map((s, i) => {
    const key = s.p.category ?? 'Other';
    const categoryRank = (categorySeen.get(key) ?? 0) + 1;
    categorySeen.set(key, categoryRank);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      watchlist: snapshot.watchlist.includes(s.p.slug),
      age_days: s.age,
      category_rank: categoryRank,
      category_size: categorySize.get(key) ?? 1,
      implied_value_usd: s.implied,
      implied_low_usd: s.low,
      implied_high_usd: s.high,
      model: {
        multiple: s.multiple,
        multiple_category: key,
        live_n: s.liveN,
        growth_pct: s.growthPct,
        growth_multiplier: s.growthMult,
        maturity_multiplier: s.maturityMult,
        breadth_multiplier: s.breadthMult,
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What a transaction costs on a chain, in the words a farmer budgets by. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $6 to $12 of gas';
  if (c === 'solana') return 'a few cents of gas';
  if (c === 'binance') return 'about $0.20 of gas';
  if (c === 'tron') return 'about $1 of network fees';
  if (c === 'bitcoin') return 'a few dollars of network fees';
  return 'typically under $1 of gas';
}

/** The category's core action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('uncollateralized') || c.includes('lend') || c.includes('cdp')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield aggregator')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and hold the receipt token.`;
  if (c.includes('yield') || c.includes('farm')) return `Deposit $${capital} into ${name}'s main yield position on ${chain} and let it compound.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis strategy on ${chain} and hold the position through one funding cycle.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one position on a market that settles after the snapshot window.`;
  if (c.includes('stablecoin')) return `Mint or hold $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('payment')) return `Run $${capital} of payments through ${name} on ${chain} and keep the account funded.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index on ${chain} and hold it.`;
  if (c.includes('liquidity manager')) return `Deposit $${capital} into a ${name} managed position on ${chain} and let it rebalance.`;
  if (c.includes('chain')) return `Bridge $${capital} to the chain and use ${name}'s core app on it, so the wallet is active there.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name}'s incentive pool on ${chain} and vote once with the position.`;
  if (c.includes('otc') || c.includes('marketplace')) return `Complete one $${capital} trade through ${name} on ${chain} and keep the account in good standing.`;
  if (c.includes('card')) return `Fund the ${name} card with $${capital} and make one purchase through it.`;
  if (c.includes('collateral')) return `Post $${capital} of collateral with ${name} on ${chain} and keep the position healthy.`;
  if (c.includes('btc') || c.includes('bitcoin')) return `Deposit $${capital} of BTC-backed collateral through ${name} on ${chain} and hold the receipt.`;
  if (c.includes('cedefi')) return `Deposit $${capital} into ${name}'s managed account on ${chain} and keep it funded.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action: a different leg of the same protocol. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(10, Math.round(capital / 5));
  if (c.includes('curator') || c.includes('allocator')) return `Spread a second, smaller deposit across another ${name} vault, so more than one product sees your wallet.`;
  if (c.includes('uncollateralized') || c.includes('lend') || c.includes('cdp')) return `Borrow $${small} against your supply and repay it within the week, so both sides of the market record activity.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Swap $${small} through the pool once, so the wallet shows trading activity as well as liquidity.`;
  if (c.includes('yield')) return `Claim or restake one round of yield, so the wallet shows a harvest transaction.`;
  if (c.includes('basis')) return `Top the position up once after the first funding settlement, so the wallet shows repeat deposits.`;
  if (c.includes('bridge')) return `Bridge $${small} back the other way a week later, so the wallet shows two-way volume.`;
  if (c.includes('restak') || c.includes('staking')) return `Delegate or restake a small second amount, so the wallet shows more than one staking transaction.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Close the hedge and open a fresh one, so the wallet shows two round trips.`;
  if (c.includes('prediction')) return `Place a second position on a different market, so the wallet is not a one-trade account.`;
  if (c.includes('stablecoin') || c.includes('rwa')) return `Add a second, smaller mint a week later, so the wallet shows repeat activity.`;
  if (c.includes('insurance')) return `Renew or extend the cover once, so the wallet shows an ongoing policy.`;
  if (c.includes('payment')) return `Make a second payment a week later, so the wallet shows repeat usage.`;
  if (c.includes('index') || c.includes('liquidity manager')) return `Add a second, smaller deposit a week later, so the wallet shows repeat activity.`;
  if (c.includes('chain')) return `Use a second app on the chain, so the wallet is active in more than one place.`;
  if (c.includes('governance')) return `Vote a second time on a later proposal, so the wallet shows repeat governance.`;
  if (c.includes('otc') || c.includes('marketplace')) return `Complete a second trade a week later, so the wallet shows repeat volume.`;
  if (c.includes('card')) return `Make a second purchase a week later, so the card shows repeat spending.`;
  return `Return once and add a second, smaller deposit, so the position shows repeat activity rather than a single transaction.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper kept offline.`,
      cost: 'no cost to create; the first transaction costs gas',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: `about $${Math.max(10, Math.round(capital / 5))} of capital and ${gas}`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a swap, a borrow or a vote, so snapshots keep seeing the wallet.`,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity lands in more than one snapshot window.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link the protocol itself publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Size the position so a smart-contract failure would not hurt, and write the wallet, the dates and every transaction in a farm log.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan derived in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    category_rank: row.category_rank,
    category_size: row.category_size,
    implied_value_usd: row.implied_value_usd,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    multiple: row.model.multiple,
    multiple_category: row.model.multiple_category,
    live_n: row.model.live_n,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const calibration = calibrate(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const boardCategories = new Set(board.map((r) => r.category ?? 'Other'));
  const calibrationRows: CalibrationRow[] = [...calibration.byCategory.entries()]
    .filter(([key]) => boardCategories.has(key))
    .map(([key, v]) => ({ category: key, live_n: v.n, median_ratio: v.median, multiple: v.multiple, low_multiple: v.low, high_multiple: v.high }))
    .sort((a, b) => b.live_n - a.live_n || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    calibration: { global_median: calibration.globalMedian, global_low: calibration.globalLow, global_high: calibration.globalHigh, live_n: calibration.liveN, rows: calibrationRows },
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate needs`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
