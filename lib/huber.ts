// Fjord Index | Huber-MAD Robust Peer Calibration — Median Absolute Deviation Dispersion & Watchlist Focus
// Model ID: huber-mad-v1. Deterministic snapshot-only pre-token scorer and farm playbook engine.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface CategoryPrior {
  category: string;
  peer_count: number;
  raw_median_multiple: number;
  prior_multiple: number;
  p25_multiple: number;
  p75_multiple: number;
  iqr_spread: number;
}

export interface ModelConfig {
  formula_kind: string;
  shrinkage_k: number;
  win_low: number;
  win_high: number;
  prior_floor: number;
  prior_cap: number;
  scale_anchor_usd: number;
  scale_exponent: number;
  growth_weight: number;
  growth_scale_pct: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
  include_cohort: boolean;
  cohort_sleeve_factor: number;
  airdrop_base_share: number;
  ols_beta: number;
}

export const MODEL: ModelConfig = {
  formula_kind: 'huber',
  shrinkage_k: 4,
  win_low: 0.04,
  win_high: 3.0,
  prior_floor: 0.14,
  prior_cap: 1.35,
  scale_anchor_usd: 100_000_000,
  scale_exponent: 0.12,
  growth_weight: 0.29,
  growth_scale_pct: 35,
  maturity_floor: 0.70,
  maturity_range: 0.42,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.025,
  chain_cap: 0.125,
  include_cohort: false,
  cohort_sleeve_factor: 1,
  airdrop_base_share: 0.06,
  ols_beta: 0.91,
};

export const MODEL_VERSION = 'huber-mad-v1';
export const EARLY_LIMIT = 152;
export const LIVE_LIMIT = 120;
export const EXCLUDED_LIMIT = 100;

export type TierKind = 'watchlist' | 'cohort' | 'early';

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

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
  tier: TierKind;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  low_value_usd: number;
  high_value_usd: number;
  airdrop_pool_usd: number;
  airdrop_per_1k_usd: number;
  model: {
    category_multiple: number;
    peer_count: number;
    scale_multiplier: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    sleeve_factor: number;
    airdrop_share: number;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  tier: TierKind;
  age_days: number | null;
  implied_value_usd: number;
  low_value_usd: number;
  high_value_usd: number;
  airdrop_pool_usd: number;
  airdrop_per_1k_usd: number;
  category_multiple: number;
  peer_count: number;
  scale_multiplier: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  sleeve_factor: number;
  airdrop_share: number;
  steps: FarmStep[];
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const finite = (v: unknown, fb: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb);

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const DERIVATIVE_CATS = new Set([
  'CEX', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge',
  'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Anchor BTC',
  'Decentralized BTC', 'Stablecoin Wrapper',
]);
const DERIVATIVE_WORDS = /\b(wrapped|staked|staking|bridged|bridge|restaked|lsd|lst)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini|Bitstamp|HTX|KuCoin|Robinhood|HashKey|Poloniex|BingX|Indodax|Korbit|Bitvavo|Bitunix|CoinDCX|Pionex|Bitrue|Gate|Crypto-com|OSL)\b/i;
const GENERIC_WORDS = new Set([
  'defi', 'protocol', 'finance', 'network', 'swap', 'dex', 'bridge', 'chain', 'labs',
  'capital', 'vault', 'vaults', 'yield', 'money', 'market', 'markets', 'staking',
  'liquid', 'crypto', 'token', 'coin', 'usd', 'eth', 'btc', 'sol', 'base', 'prime',
  'core', 'plus', 'omni', 'open', 'meta', 'hyper', 'super', 'zero', 'one', 'v1', 'v2', 'v3',
]);

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function buildLiveBrandIndex(protocols: SnapshotProtocol[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const p of protocols) {
    if (isPreToken(p)) continue;
    const label = p.symbol ?? p.name;
    const fw = p.name.split(/\s+/)[0]?.toLowerCase() ?? '';
    const sh = p.slug.split('-')[0]?.toLowerCase() ?? '';
    for (const k of [p.name.toLowerCase(), fw, sh]) {
      if (k.length >= 3 && !GENERIC_WORDS.has(k) && !index.has(k)) index.set(k, label);
    }
  }
  return index;
}

export function exclusionReason(p: SnapshotProtocol, brandIndex: Map<string, string>): string | null {
  if (!isPreToken(p)) return 'Live token recorded';
  if (p.category !== null && DERIVATIVE_CATS.has(p.category)) return `Derivative or custody category (${p.category})`;
  if (VERSIONED.test(p.name)) return 'Versioned release of parent protocol';
  if (EXCHANGE_PREFIX.test(p.name)) return 'Exchange-operated product';
  if (DERIVATIVE_WORDS.test(p.name)) return 'Wrapped, staked, or bridged derivative';
  const words = p.name.toLowerCase().split(/[\s\-_.:]+/).filter(Boolean);
  const hit = brandIndex.get(words[0] ?? '') ?? brandIndex.get(p.slug.split('-')[0]?.toLowerCase() ?? '');
  if (hit !== undefined) return `Sub-product matching live token (${hit})`;
  return null;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function trimmedMean(sorted: number[], trim = 0.2): number {
  if (sorted.length < 3) return percentile(sorted, 0.5);
  const drop = Math.floor(sorted.length * trim);
  const slice = sorted.slice(drop, sorted.length - drop);
  return slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length);
}

export function computeCategoryPriors(protocols: SnapshotProtocol[], cfg: ModelConfig): {
  priors: Record<string, CategoryPrior>;
  olsBeta: number;
} {
  const byCat = new Map<string, { ratio: number; tvl: number; mcap: number }[]>();
  const allRatios: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];

  for (const p of protocols) {
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd >= 100_000 && p.category !== 'CEX') {
      const ratio = clamp(p.mcap_usd / p.tvl_usd, cfg.win_low, cfg.win_high);
      const cat = p.category ?? 'Other';
      const arr = byCat.get(cat) ?? [];
      arr.push({ ratio, tvl: p.tvl_usd, mcap: p.mcap_usd });
      byCat.set(cat, arr);
      allRatios.push(ratio);
      xs.push(Math.log(p.tvl_usd));
      ys.push(Math.log(p.tvl_usd * ratio));
    }
  }

  let olsBeta = cfg.ols_beta;
  if (xs.length >= 10) {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i]! - mx) * (ys[i]! - my);
      den += (xs[i]! - mx) * (xs[i]! - mx);
    }
    if (den > 0) olsBeta = round4(clamp(num / den, 0.78, 0.98));
  }

  allRatios.sort((a, b) => a - b);
  const globalMed = allRatios.length > 0 ? percentile(allRatios, 0.5) : 0.246;
  const priors: Record<string, CategoryPrior> = {
    __global__: {
      category: 'Global Live Median',
      peer_count: allRatios.length,
      raw_median_multiple: round4(globalMed),
      prior_multiple: round4(clamp(globalMed, cfg.prior_floor, cfg.prior_cap)),
      p25_multiple: round4(clamp(percentile(allRatios, 0.25), 0.08, cfg.prior_cap)),
      p75_multiple: round4(clamp(percentile(allRatios, 0.75), cfg.prior_floor, 2.4)),
      iqr_spread: round4(percentile(allRatios, 0.75) - percentile(allRatios, 0.25)),
    },
  };

  for (const [cat, items] of byCat.entries()) {
    const vals = items.map((x) => x.ratio).sort((a, b) => a - b);
    const n = vals.length;
    const med = percentile(vals, 0.5);
    const q25 = percentile(vals, 0.25);
    const q75 = percentile(vals, 0.75);
    const iqr = Math.max(0.05, q75 - q25);

    let loc = med;
    if (cfg.formula_kind === 'atan') loc = trimmedMean(vals, 0.2);
    else if (cfg.formula_kind === 'logmed') loc = Math.exp(vals.map((v) => Math.log(v)).sort((a, b) => a - b)[Math.floor(n / 2)]!);
    else if (cfg.formula_kind === 'blend') {
      const capW = clamp(items.reduce((s, x) => s + x.mcap, 0) / Math.max(1, items.reduce((s, x) => s + x.tvl, 0)), cfg.win_low, cfg.win_high);
      loc = 0.4 * capW + 0.6 * med;
    } else if (cfg.formula_kind === 'huber') {
      const absDevs = vals.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
      const mad = Math.max(0.03, percentile(absDevs, 0.5) * 1.4826);
      const clipped = vals.map((v) => clamp(v, med - 1.5 * mad, med + 1.5 * mad));
      loc = clipped.reduce((a, b) => a + b, 0) / n;
    }

    const effK = cfg.formula_kind === 'asinh' ? cfg.shrinkage_k * (1 + iqr) : cfg.shrinkage_k;
    const shrunk = (n * loc + effK * globalMed) / (n + effK);
    const prior = clamp(shrunk, cfg.prior_floor, cfg.prior_cap);
    const p25 = clamp((n * q25 + effK * (globalMed * 0.55)) / (n + effK), 0.06, prior * 0.85);
    const p75 = clamp((n * q75 + effK * (globalMed * 1.65)) / (n + effK), prior * 1.25, 2.4);

    priors[cat] = {
      category: cat,
      peer_count: n,
      raw_median_multiple: round4(loc),
      prior_multiple: round4(prior),
      p25_multiple: round4(p25),
      p75_multiple: round4(p75),
      iqr_spread: round4(iqr),
    };
  }

  return { priors, olsBeta };
}

export function evaluateProtocol(
  p: SnapshotProtocol,
  tier: TierKind,
  asOf: string,
  cfg: ModelConfig,
  priors: Record<string, CategoryPrior>,
) {
  const age = ageDays(asOf, p.listed_at);
  const prior = priors[p.category ?? 'Other'] ?? priors.__global__!;
  const catMult = prior.prior_multiple;
  const tvlM = Math.max(p.tvl_usd, 1_000_000);

  let scaleMult = clamp(Math.pow(cfg.scale_anchor_usd / tvlM, cfg.scale_exponent), 0.56, 1.35);
  if (cfg.formula_kind === 'ols') {
    scaleMult = clamp(Math.pow(tvlM / cfg.scale_anchor_usd, cfg.ols_beta - 1), 0.58, 1.35);
  } else if (cfg.formula_kind === 'mm') {
    scaleMult = clamp(1.18 - 0.56 * (tvlM / (tvlM + 350_000_000)), 0.58, 1.25);
  } else if (cfg.formula_kind === 'logtvl') {
    scaleMult = clamp(1 / (1 + 0.085 * Math.log(Math.max(tvlM / 50_000_000, 0.25))), 0.60, 1.25);
  }

  const rawGrowth = finite(p.change_7d, 0);
  let growthMult = 1 + cfg.growth_weight * Math.tanh(rawGrowth / cfg.growth_scale_pct);
  if (cfg.formula_kind === 'asinh') {
    growthMult = clamp(1 + cfg.growth_weight * Math.asinh(rawGrowth / cfg.growth_scale_pct) * 0.45, 0.65, 1.35);
  } else if (cfg.formula_kind === 'atan') {
    growthMult = 1 + cfg.growth_weight * (2 / Math.PI) * Math.atan(rawGrowth / cfg.growth_scale_pct);
  } else if (cfg.formula_kind === 'asym') {
    growthMult = rawGrowth < 0
      ? 1 + (cfg.growth_weight * 1.15) * Math.tanh(rawGrowth / 22)
      : 1 + (cfg.growth_weight * 0.72) * Math.tanh(rawGrowth / 42);
  } else if (cfg.formula_kind === 'sigmoid') {
    const sig = 1 / (1 + Math.exp(-rawGrowth / cfg.growth_scale_pct));
    growthMult = 1 + cfg.growth_weight * (2 * sig - 1);
  }

  const ageModel = age ?? cfg.unknown_age_days;
  let maturityMult = cfg.maturity_floor + (clamp(ageModel, 0, cfg.maturity_days) / cfg.maturity_days) * cfg.maturity_range;
  if (cfg.formula_kind === 'mm') {
    maturityMult = 0.70 + 0.44 * (ageModel / (ageModel + 300));
  } else if (cfg.formula_kind === 'gauss') {
    const peak = Math.exp(-Math.pow((ageModel - 680) / 520, 2));
    maturityMult = 0.74 + 0.36 * peak;
  }

  const chainMult = 1 + Math.min(Math.max(p.chains.length - 1, 0) * cfg.chain_step, cfg.chain_cap);
  const sleeveFactor = tier === 'cohort' ? cfg.cohort_sleeve_factor : 1.0;

  const combined = scaleMult * growthMult * maturityMult * chainMult * sleeveFactor;
  const implied = Math.max(1, Math.round(p.tvl_usd * catMult * combined));
  const low = Math.max(1, Math.round(p.tvl_usd * prior.p25_multiple * combined));
  const high = Math.max(implied, Math.round(p.tvl_usd * prior.p75_multiple * combined));
  const airdropShare = round4(clamp(cfg.airdrop_base_share + (ageModel >= 365 ? 0.02 : 0) + (rawGrowth > 5 ? 0.01 : 0), 0.04, 0.10));
  const airdropPool = Math.max(1, Math.round(implied * airdropShare));
  const airdropPer1k = Math.max(1, Math.round((airdropPool / Math.max(p.tvl_usd, 1)) * 1000));

  return {
    age,
    catMult,
    peerCount: prior.peer_count,
    scaleMult: round4(scaleMult),
    growthMult: round4(growthMult),
    maturityMult: round4(maturityMult),
    chainMult: round4(chainMult),
    sleeveFactor,
    airdropShare,
    implied,
    low,
    high,
    airdropPool,
    airdropPer1k,
  };
}

const LOW_FEE_CHAINS = [
  'Solana', 'Base', 'Arbitrum', 'Optimism', 'Monad', 'Sui', 'Hyperliquid', 'Hyperliquid L1',
  'Polygon', 'Avalanche', 'BSC', 'Binance', 'Flare', 'Stellar', 'Plume Mainnet', 'Ink', 'Tron',
];

function chooseChain(chains: string[]): { chain: string; lowGas: boolean } {
  if (chains.length === 0) return { chain: 'primary network', lowGas: false };
  for (const c of LOW_FEE_CHAINS) {
    const hit = chains.find((x) => x.toLowerCase() === c.toLowerCase());
    if (hit) return { chain: hit, lowGas: true };
  }
  const first = chains[0]!;
  return { chain: first, lowGas: first.toLowerCase() !== 'ethereum' };
}

function buildSteps(p: SnapshotProtocol, tier: TierKind, age: number | null, per1k: number): FarmStep[] {
  const { chain, lowGas } = chooseChain(p.chains);
  const cap = p.tvl_usd >= 1e9 ? (lowGas ? 500 : 1000) : p.tvl_usd >= 2e8 ? (lowGas ? 250 : 500) : p.tvl_usd >= 5e7 ? (lowGas ? 150 : 300) : (lowGas ? 100 : 200);
  const gas = lowGas ? '<$0.40 network gas' : '$8-$16 L1 gas (<15 gwei)';
  const holdDays = age === null ? 45 : age >= 365 ? 30 : age >= 180 ? 45 : 60;
  const g7 = p.change_7d ?? 0;
  const cat = (p.category ?? '').toLowerCase();

  let action = `Deposit $${cap} stable/major collateral into ${p.name} flagship vault on ${chain} for continuous epoch points.`;
  if (cat.includes('curator') || cat.includes('allocator')) {
    action = `Allocate $${cap} USDC into ${p.name} curated yield vault on ${chain} and hold vault shares in wallet.`;
  } else if (cat.includes('lend') || cat.includes('cdp')) {
    action = `Supply $${cap} USDC/ETH on ${p.name} (${chain}) and borrow 20-25% safely for dual-side accrual.`;
  } else if (cat.includes('dex') || cat.includes('liquidity')) {
    action = `Seed $${cap} in a correlated LP range on ${p.name} (${chain}) with 2 swaps per weekly epoch.`;
  } else if (cat.includes('basis') || cat.includes('yield')) {
    action = `Mint $${cap} delta-neutral yield shares on ${p.name} (${chain}) without wrapping into third-party pools.`;
  } else if (cat.includes('rwa')) {
    action = `Subscribe $${cap} into ${p.name} tokenized treasury/RWA pool on ${chain} from your primary address.`;
  } else if (cat.includes('derivative') || cat.includes('options')) {
    action = `Fund $${cap} margin on ${p.name} (${chain}) and maintain weekly balanced maker/taker notional.`;
  }

  const flowNote = g7 <= -10
    ? `TVL declined ${g7.toFixed(1)}% in 7d: phase $${cap / 2} across two tranches and check redemption queue depth.`
    : g7 >= 15
      ? `TVL rose +${g7.toFixed(1)}% in 7d: enter ahead of cap dilution (~$${per1k} per $1k at current TVL).`
      : `TVL remained steady (${g7 >= 0 ? '+' : ''}${g7.toFixed(1)}% 7d): sustain balance across weekly snapshots (~$${per1k}/$1k est.).`;

  const altLowFee = p.chains.find((c) => c !== chain && c.toLowerCase() !== 'ethereum');
  const altChain = altLowFee ?? p.chains.find((c) => c !== chain);
  const routeNote = altChain
    ? `Split 25% activity onto ${altChain} (${p.chains.length} chains; favor low-gas L2s) across a ${holdDays}-day window.`
    : tier === 'cohort'
      ? `Verify standalone token attribution vs parent entity before scaling past $${cap} over ${holdDays} days.`
      : `Hold continuously for at least ${holdDays} days (${age !== null && age >= 365 ? 'mature TGE window' : 'early epoch retention'}).`;

  return [
    { text: `Use an aged wallet on ${chain} with >=5 prior organic transfers so Sybil filters clear cleanly.`, cost: `${gas} funding`, time: '10 min' },
    { text: action, cost: `$${cap} principal + ${gas}`, time: '15 min' },
    { text: flowNote, cost: lowGas ? '$0.25-$0.85 weekly gas' : '$5-$12 bi-weekly L1', time: '10 min / wk' },
    { text: routeNote, cost: `$${cap} liquid capital`, time: `${holdDays}d hold` },
    { text: `Audit epoch points only via ${p.name} official channels and revoke approvals once the season settles.`, cost: '<$0.50 revoke gas', time: '10 min TGE' },
  ];
}

export function parseSnapshot(raw: string): Snapshot {
  const d = JSON.parse(raw) as Partial<Snapshot>;
  if (!d || !Array.isArray(d.protocols) || !Array.isArray(d.watchlist)) throw new Error('Invalid snapshot');
  return {
    as_of: String(d.as_of ?? '2026-11-14'),
    source: String(d.source ?? 'defillama'),
    floor_usd: Number(d.floor_usd ?? 50_000_000),
    protocols: d.protocols,
    watchlist: d.watchlist,
  };
}

export function buildRadar(snapshot: Snapshot, cfg: ModelConfig = MODEL) {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const wlSet = new Set(snapshot.watchlist);
  const brandIndex = buildLiveBrandIndex(snapshot.protocols);
  const { priors, olsBeta } = computeCategoryPriors(snapshot.protocols, cfg);
  const activeCfg: ModelConfig = { ...cfg, ols_beta: olsBeta };

  const selected = new Map<string, { p: SnapshotProtocol; tier: TierKind }>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p) selected.set(slug, { p, tier: 'watchlist' });
  }

  const cohortCandidates: SnapshotProtocol[] = [];
  const earlyCandidates: SnapshotProtocol[] = [];
  const excluded: { slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number; reason: string }[] = [];

  for (const p of snapshot.protocols) {
    if (wlSet.has(p.slug) || !isPreToken(p)) continue;
    const reason = exclusionReason(p, brandIndex);
    if (reason !== null) {
      if (p.tvl_usd >= 10_000_000) excluded.push({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, reason });
      continue;
    }
    if (p.tvl_usd >= snapshot.floor_usd) {
      if (activeCfg.include_cohort) cohortCandidates.push(p);
      else excluded.push({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, reason: 'Off-watchlist >=$50M parent-protocol exclusion' });
    } else {
      earlyCandidates.push(p);
    }
  }

  for (const p of cohortCandidates.sort((a, b) => b.tvl_usd - a.tvl_usd)) {
    selected.set(p.slug, { p, tier: 'cohort' });
  }

  const scoredEarly = earlyCandidates
    .map((p) => ({ p, ev: evaluateProtocol(p, 'early', snapshot.as_of, activeCfg, priors) }))
    .sort((a, b) => b.ev.implied - a.ev.implied || b.p.tvl_usd - a.p.tvl_usd || a.p.slug.localeCompare(b.p.slug))
    .slice(0, EARLY_LIMIT);

  for (const item of scoredEarly) selected.set(item.p.slug, { p: item.p, tier: 'early' });

  const ranked = [...selected.values()]
    .map(({ p, tier }) => {
      const ev = evaluateProtocol(p, tier, snapshot.as_of, activeCfg, priors);
      return { p, tier, ev, steps: buildSteps(p, tier, ev.age, ev.airdropPer1k) };
    })
    .sort((a, b) => b.ev.implied - a.ev.implied || b.p.tvl_usd - a.p.tvl_usd || a.p.slug.localeCompare(b.p.slug));

  const board: BoardRow[] = ranked.map((it, i) => ({
    rank: i + 1, slug: it.p.slug, name: it.p.name, category: it.p.category, chains: it.p.chains,
    tvl_usd: it.p.tvl_usd, change_7d: it.p.change_7d, mcap_usd: it.p.mcap_usd, listed_at: it.p.listed_at,
    gecko_id: it.p.gecko_id, symbol: it.p.symbol, tier: it.tier, token_status: 'pre-token', age_days: it.ev.age,
    implied_value_usd: it.ev.implied, low_value_usd: it.ev.low, high_value_usd: it.ev.high,
    airdrop_pool_usd: it.ev.airdropPool, airdrop_per_1k_usd: it.ev.airdropPer1k,
    model: {
      category_multiple: it.ev.catMult, peer_count: it.ev.peerCount, scale_multiplier: it.ev.scaleMult,
      growth_multiplier: it.ev.growthMult, maturity_multiplier: it.ev.maturityMult, chain_multiplier: it.ev.chainMult,
      sleeve_factor: it.ev.sleeveFactor, airdrop_share: it.ev.airdropShare,
    },
    farm_steps: it.steps.map((s) => `${s.text} Cost: ${s.cost}. Time: ${s.time}.`),
  }));

  const rows: RadarRow[] = ranked.map((it, i) => ({
    rank: i + 1, slug: it.p.slug, name: it.p.name, category: it.p.category, chains: it.p.chains,
    tvl_usd: it.p.tvl_usd, change_7d: it.p.change_7d, listed_at: it.p.listed_at, tier: it.tier, age_days: it.ev.age,
    implied_value_usd: it.ev.implied, low_value_usd: it.ev.low, high_value_usd: it.ev.high,
    airdrop_pool_usd: it.ev.airdropPool, airdrop_per_1k_usd: it.ev.airdropPer1k,
    category_multiple: it.ev.catMult, peer_count: it.ev.peerCount, scale_multiplier: it.ev.scaleMult,
    growth_multiplier: it.ev.growthMult, maturity_multiplier: it.ev.maturityMult, chain_multiplier: it.ev.chainMult,
    sleeve_factor: it.ev.sleeveFactor, airdrop_share: it.ev.airdropShare, steps: it.steps,
  }));

  const live = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd >= 100_000 && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, LIVE_LIMIT)
    .map((p) => ({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd, change_7d: p.change_7d, symbol: p.symbol,
      mcap_tvl: round4((p.mcap_usd ?? 0) / Math.max(p.tvl_usd, 1)),
    }));

  const sortedExcl = excluded.sort((a, b) => b.tvl_usd - a.tvl_usd).slice(0, EXCLUDED_LIMIT);

  return {
    board,
    radar: {
      as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
      model: activeCfg, model_version: MODEL_VERSION, formula_desc: "Huber-MAD Location: FDV = TVL * M_huber(k=4, band=±1.25*MAD) * Scale^0.12 * Flow * Maturity * Chains",
      watchlist_size: snapshot.watchlist.length, cohort_size: cohortCandidates.length,
      early_size: scoredEarly.length, board_size: board.length, live_size: live.length,
      excluded_size: sortedExcl.length,
      total_implied_usd: board.reduce((s, r) => s + r.implied_value_usd, 0),
      priors, rows, live, excluded: sortedExcl,
    },
  };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `row count ${board.length} < 100`;
  const slugs = new Set(board.map((r) => r.slug));
  for (const w of snapshot.watchlist) if (!slugs.has(w)) return `missing watchlist ${w}`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `rank mismatch at ${i + 1}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `unsorted at ${i + 1}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `bad value ${r.slug}`;
    if (r.farm_steps.length < 3) return `bad steps ${r.slug}`;
  }
  return null;
}

export function dataScript(radar: unknown): string {
  return `window.RADAR=${JSON.stringify(radar).replace(/</g, '\\u003c')};\n`;
}
