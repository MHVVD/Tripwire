// Client-side fake data for previewing the dashboard without the backend.
// Only loaded when the page has ?demo=1 and /api/stream is unreachable.
// Emits the same events as the real SSE stream (see docs/API.md) and fakes the REST API.

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const rnd = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rnd(a, b + 1));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const b58 = (n) => Array.from({ length: n }, () => pick(B58)).join("");
const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const f1 = (n) => n.toFixed(1);
const pl = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const median = (arr) => {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const FF_MIN = 12; // minutes of history simulated before the page shows

const SUPPLY = 1e9;
const P0 = 2.8e-8; // pump.fun starting price, SOL per token
const GRAD_MCAP_SOL = 410;
const TICK = 250;

const WORDS = ["PEPE", "GIGA", "BONK", "WIF", "MOON", "CHAD", "FROG", "CAT", "DOGE", "SNEK", "GOAT", "BASED", "WAGMI", "MOG", "SIGMA", "RIZZ", "KITTY", "HAMSTER", "BRETT", "ANDY", "TURBO", "NEIRO", "PNUT", "FWOG", "MICHI", "LOBSTER", "BEANS", "GRIFT", "TOAD", "CHILL", "YETI", "PENGU", "APU", "WOJAK", "BOBO", "SKIBIDI", "OTTER", "DUCK", "BLOB", "ZOOM"];
const SUFFIX = ["", "", "", "AI", "INU", "SOL", "2", "X", "CEO", "COIN", "DAO", "ON SOL"];
const NAMES = { AI: "AI", INU: "Inu", SOL: "on Solana", "2": "2.0", X: "X", CEO: "CEO", COIN: "Coin", DAO: "DAO", "ON SOL": "on Sol" };
const REGIONS = ["fra", "ams", "ny", "slc", "tyo", "lon"];

function mkName() {
  const w = pick(WORDS);
  const s = pick(SUFFIX);
  const sym = (w + (s && s.length <= 3 ? s : "")).slice(0, 10);
  const nice = w.charAt(0) + w.slice(1).toLowerCase();
  const name = s ? `${nice} ${NAMES[s]}` : pick([nice, `${nice} Classic`, `Baby ${nice}`, `${nice} the ${pick(["Frog", "Cat", "Dog", "Chad", "Degen"])}`, `Real ${nice}`]);
  return { name, symbol: sym };
}

function weighted(opts) {
  let r = Math.random() * opts.reduce((s, o) => s + o[1], 0);
  for (const [v, w] of opts) if ((r -= w) <= 0) return v;
  return opts[0][0];
}

// Hand-armed mints the tracker never saw launching have no risk data.
function unknownRisk() {
  return {
    score: 0, level: "unknown", flags: [],
    metrics: { devInitialPct: 0, devHeldPct: 0, devSoldPct: 0, devTransferredPct: 0, bundlerPct: 0, bundlers: 0, sniperPct: 0, snipers: 0, linkedWallets: 0, insiderHeldPct: 0, uniqueBuyers: 0, buySellRatio: 0, drawdownPct: 0 },
  };
}

function scoreOf(t) {
  if (t.adopted) return unknownRisk();
  const m = t.m;
  const flags = [];
  const add = (id, severity, weight, detail) => flags.push({ id, severity, weight, detail });
  if (m.bundlerPct >= 10) add("bundled", "danger", 30, `${pl(m.bundlers, "wallet")} bought ${f1(m.bundlerPct)}% in the creation slot`);
  else if (m.bundlerPct >= 3) add("bundled", "warning", 15, `${pl(m.bundlers, "wallet")} bought ${f1(m.bundlerPct)}% in the creation slot`);
  if (m.sniperPct >= 20) add("sniped", "danger", 20, `${pl(m.snipers, "sniper")} took ${f1(m.sniperPct)}% within the first slots`);
  else if (m.sniperPct >= 8) add("sniped", "warning", 10, `${pl(m.snipers, "sniper")} took ${f1(m.sniperPct)}% within the first slots`);
  if (m.devInitialPct >= 10) add("dev_bag", "warning", 15, `dev bought ${f1(m.devInitialPct)}% of supply at launch`);
  if (m.devSoldPct >= 50) add("dev_dumped", "danger", 25, `dev has sold ${f1(m.devSoldPct)}% of their bag`);
  else if (m.devSoldPct >= 10) add("dev_selling", "warning", 12, `dev has sold ${f1(m.devSoldPct)}% of their bag`);
  if (m.devTransferredPct >= 0.5) add("dev_moved", "danger", 20, `dev moved ${f1(m.devTransferredPct)}% of supply to ${pl(t.recipients, "other wallet")}`);
  if (m.insiderHeldPct >= 25) add("insiders_hold", "danger", 20, `dev, bundlers and snipers still hold ${f1(m.insiderHeldPct)}%`);
  else if (m.insiderHeldPct >= 12) add("insiders_hold", "warning", 10, `dev, bundlers and snipers still hold ${f1(m.insiderHeldPct)}%`);
  if (m.drawdownPct >= 70 && t.trades > 10) add("collapsed", "danger", 20, `price is ${f1(m.drawdownPct)}% below its high`);
  if (t.enriched && t.noSocials) add("no_socials", "info", 3, "no website or socials in metadata");
  flags.sort((a, b) => b.weight - a.weight);
  const score = Math.min(100, flags.reduce((s, f) => s + f.weight, 0));
  const level = score >= 70 ? "critical" : score >= 45 ? "high" : score >= 20 ? "medium" : "low";
  return { score, level, flags, metrics: { ...m } };
}

export function createDemo(emit, opts = {}) {
  const exitMode = opts.exitMode || "live";
  const tokens = new Map();
  const watches = new Map();
  let alerts = [];
  let exits = [];
  const queue = []; // scheduled {at, fn}
  let live = false;
  let now = Date.now() - FF_MIN * 60 * 1000;
  const baseline = []; // 5-min moves of watched tokens sampled at random times
  const start = now;
  let nextSpawn = now;
  let tickN = 0;
  let launchesSeen = 0;
  let slot = 318_442_000 + ri(0, 9999);
  let txTotal = 48_000_000 + ri(0, 1e6);
  let solUsd = rnd(146, 152);
  const beam = { sent: 0, landed: 0, failed: 0, landSum: 0 };
  const blur = { calls: 0, errors: 0 };
  let seq = 0;

  const out = (ev, data) => live && emit(ev, data);
  const at = (t, fn) => queue.push({ at: t, fn });

  function spawn(t) {
    const profile = weighted([["rug", 34], ["pump", 18], ["dud", 33], ["slow", 15]]);
    const { name, symbol } = mkName();
    const rug = profile === "rug";
    const bundlers = rug ? ri(4, 9) : Math.random() < 0.5 ? 0 : ri(2, 4);
    const snipers = rug ? ri(6, 16) : ri(1, 8);
    const m = {
      devInitialPct: rug ? rnd(6, 16) : rnd(0.5, 6),
      devHeldPct: 0, devSoldPct: 0, devTransferredPct: 0,
      bundlers, bundlerPct: bundlers ? (rug ? rnd(12, 38) : rnd(1, 9)) : 0,
      snipers, sniperPct: rug ? rnd(9, 26) : rnd(1, 9),
      linkedWallets: rug ? ri(1, 5) : ri(0, 1), insiderHeldPct: 0, uniqueBuyers: bundlers + snipers + ri(1, 5),
      buySellRatio: 3, drawdownPct: 0,
    };
    m.devHeldPct = m.devInitialPct;
    m.insiderHeldPct = m.devHeldPct + m.bundlerPct + m.sniperPct * 0.7;
    const price = P0 * (1 + (m.bundlerPct + m.sniperPct + m.devInitialPct) / 60);
    const tok = {
      mint: b58(40) + "pump", name, symbol, uri: "", creator: b58(44), createdAt: t,
      price, athPrice: price, progress: 0, migrated: false,
      trades: bundlers + snipers + 1, buys: bundlers + snipers + 1, sells: 0, volumeSol: rnd(3, 12),
      profile, m, recipients: 0, spark: [price], enriched: false, noSocials: Math.random() < 0.6,
      rugAt: rug ? t + rnd(22e3, 140e3) : Infinity, rugged: 0, drift: profile === "pump" ? rnd(0.004, 0.009) : profile === "rug" ? rnd(0.002, 0.007) : profile === "dud" ? rnd(-0.004, 0.001) : rnd(-0.001, 0.002),
      phase: ri(0, 3), risk: null,
    };
    tok.risk = scoreOf(tok);
    tokens.set(tok.mint, tok);
    launchesSeen++;
    // Blur enrichment arrives a couple of seconds later
    at(t + rnd(1200, 4000), () => { tok.enriched = true; blur.calls++; if (Math.random() < 0.02) blur.errors++; });
    // auto-watch risky-but-tradeable launches (what a sniper bot would be holding)
    const autoP = rug ? 0.13 : profile === "pump" ? 0.06 : 0.012;
    if (Math.random() < autoP) at(t + rnd(1500, 5000), () => tokens.has(tok.mint) && arm(tok, "auto", true));
    // rugs: dev splits supply to fresh wallets first sometimes, then dumps
    if (rug) {
      if (Math.random() < 0.5) at(tok.rugAt - rnd(2500, 6000), () => devTransfer(tok));
      at(tok.rugAt, () => rugPull(tok));
    }
    evict();
    return tok;
  }

  function evict() {
    if (tokens.size <= 150) return;
    const old = [...tokens.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const t of old) {
      if (tokens.size <= 150) break;
      if (watches.has(t.mint)) continue;
      tokens.delete(t.mint);
      out("launch_removed", { mint: t.mint });
    }
  }

  function view(t) {
    const priceUsd = t.price * solUsd;
    return {
      mint: t.mint, name: t.name, symbol: t.symbol, uri: t.uri, creator: t.creator, createdAt: t.createdAt,
      price: t.price, priceUsd, mcapUsd: priceUsd * SUPPLY, athPrice: t.athPrice, progress: t.progress, migrated: t.migrated,
      trades: t.trades, buys: t.buys, sells: t.sells, volumeSol: t.volumeSol, risk: t.risk, enriched: t.enriched,
      adopted: !!t.adopted, supply: SUPPLY, watched: watches.has(t.mint), spark: t.spark.slice(-60),
    };
  }

  function watchView(w) {
    const t = tokens.get(w.mint);
    const price = t ? t.price : w.entryPrice;
    return {
      mint: w.mint, symbol: w.symbol, source: w.source, armedAt: w.armedAt, autoExit: w.autoExit,
      entryPrice: w.entryPrice, price, pnlPct: (price / w.entryPrice - 1) * 100,
      alerts: w.alerts, lastAlert: w.lastAlert, risk: t ? t.risk : null,
    };
  }

  function arm(t, source, autoExit) {
    let w = watches.get(t.mint);
    if (w) { if (autoExit !== undefined) w.autoExit = autoExit; }
    else {
      w = { mint: t.mint, symbol: t.symbol, source, armedAt: now, autoExit: autoExit ?? false, entryPrice: t.price, alerts: 0, lastAlert: undefined };
      watches.set(t.mint, w);
    }
    out("watch", watchView(w));
    out("launch", view(t));
    return watchView(w);
  }

  function fire(t, rule, severity, title, detail, wallet) {
    const w = watches.get(t.mint);
    if (!w) return null;
    const a = {
      id: `a${++seq}`, t: now, mint: t.mint, symbol: t.symbol, rule, severity, title, detail,
      signature: b58(88), slot, wallet, price: t.price, detectMs: Math.round(rnd(140, 620)),
    };
    alerts = [a, ...alerts].slice(0, 200);
    w.alerts++;
    w.lastAlert = a;
    out("alert", a);
    out("watch", watchView(w));
    // follow-ups: max drop within 10 min, signed move at +1m and +5m, folded repeat triggers
    let min = a.price;
    const push = () => {
      alerts = alerts.map((x) => (x.id === a.id ? a : x));
      if (w.lastAlert?.id === a.id) w.lastAlert = a;
      out("alert_update", { ...a });
    };
    for (const [key, ms] of [["move1m", 60e3], ["move5m", 300e3]]) {
      at(now + ms, () => {
        const tk = tokens.get(t.mint);
        if (!tk) return;
        a[key] = (tk.price / a.price - 1) * 100;
        push();
      });
    }
    if (severity === "critical" && Math.random() < 0.35) {
      at(now + rnd(1500, 4000), () => { a.suppressed = ri(1, 3); push(); });
    }
    const checks = [...Array.from({ length: 12 }, (_, k) => (k + 1) * 1500), ...Array.from({ length: 39 }, (_, k) => 30e3 + k * 15e3)];
    for (const dt of checks) {
      at(now + dt, () => {
        const tk = tokens.get(t.mint);
        if (!tk) return;
        min = Math.min(min, tk.price);
        const avoided = (1 - min / a.price) * 100;
        if (avoided <= 0.05 && a.avoidedPct === undefined) return;
        if (a.avoidedPct !== undefined && Math.abs(avoided - a.avoidedPct) < 0.05) return;
        Object.assign(a, { minPriceAfter: min, avoidedPct: avoided });
        push();
      });
    }
    if (severity === "critical" && w.autoExit && !w.exited) {
      w.exited = true;
      doExit(t, title, now);
    }
    return a;
  }

  function doExit(t, trigger, t0) {
    const w = watches.get(t.mint);
    const tokensHeld = w ? (0.1 / w.entryPrice) : 3.2e6; // 0.1 SOL paper position
    const e = {
      id: `x${++seq}`, t: t0, mint: t.mint, symbol: t.symbol, mode: exitMode, trigger,
      status: exitMode === "live" ? "sending" : "quoting", tokens: tokensHeld, expectedSol: tokensHeld * t.price * 0.985,
    };
    exits = [e, ...exits].slice(0, 100);
    out("exit", { ...e });
    const sendMs = Math.round(rnd(22, 70));
    if (exitMode === "live") {
      beam.sent++;
      at(t0 + sendMs + rnd(380, 900), () => {
        const failed = Math.random() < 0.05;
        e.sendMs = sendMs;
        if (failed) { e.status = "failed"; e.error = "blockhash expired"; beam.failed++; }
        else {
          e.status = "landed";
          e.landMs = Math.round(rnd(380, 880));
          e.slotDelta = ri(1, 3);
          e.signature = b58(88);
          e.beam = { region: pick(REGIONS), landedViaJito: Math.random() < 0.4, tipLamports: pick([50000, 100000, 150000, 200000]), heldMs: ri(0, 40) };
          beam.landed++;
          beam.landSum += e.landMs;
        }
        out("exit", { ...e });
      });
    } else {
      at(t0 + rnd(150, 400), () => { e.status = "simulated"; e.sendMs = sendMs; out("exit", { ...e }); });
    }
    return e;
  }

  function devTransfer(t) {
    if (!tokens.has(t.mint) || t.rugged || t.adopted) return;
    const pct = rnd(3, 12);
    t.recipients = ri(2, 6);
    t.m.devTransferredPct = pct;
    t.m.devHeldPct = Math.max(0, t.m.devHeldPct - pct);
    t.m.linkedWallets += t.recipients;
    fire(t, "dev_transfer", "critical", `Dev moved ${f1(pct)}% of supply`, `${short(t.creator)} sent tokens to ${pl(t.recipients, "fresh wallet")} - classic pre-dump split`, t.creator);
  }

  function rugPull(t) {
    if (!tokens.has(t.mint) || t.adopted) return;
    t.rugged = 1;
    const kind = pick(["dev", "dev", "cohort"]);
    const bag = rnd(82, 100);
    t.m.devSoldPct = bag;
    const supplyPct = t.m.devInitialPct * bag / 100;
    t.m.devHeldPct = Math.max(0, t.m.devHeldPct * (1 - bag / 100));
    t.m.bundlerPct *= kind === "cohort" ? 0.15 : 0.6;
    t.m.sniperPct *= 0.5;
    const sol = supplyPct / 100 * SUPPLY * t.price;
    if (kind === "dev") fire(t, "dev_sell", "critical", `Dev sold ${f1(supplyPct)}% of supply`, `${short(t.creator)} dumped ${f1(bag)}% of its bag for ${sol.toFixed(2)} SOL`, t.creator);
    else fire(t, "cohort_dump", "critical", `Insiders dumped ${f1(rnd(18, 40))}% in 10s`, "bundlers, snipers and dev-linked wallets are selling together");
    at(now + rnd(4000, 7000), () => {
      if (!tokens.has(t.mint)) return;
      const hi = t.athPrice;
      const drop = (1 - t.price / hi) * 100;
      if (drop > 40 && Math.random() < 0.35) fire(t, "crash", "warning", `Price -${f1(drop)}% in 30s`, `from ${hi.toExponential(3)} to ${t.price.toExponential(3)} SOL`);
    });
  }

  function evolve(t) {
    const age = now - t.createdAt;
    if (age > 7 * 60e3 && !watches.has(t.mint)) return false;
    let r;
    if (t.rugged) {
      r = t.rugged < 7 ? -rnd(0.05, 0.13) : rnd(-0.02, 0.019);
      t.rugged++;
    } else {
      const decay = Math.max(-0.04, 1 - age / 150e3); // early hype, then the usual bleed
      const young = age < 150e3;
      const vol = young ? 0.03 : 0.012;
      r = t.drift * decay + rnd(-vol, vol);
      if (young && Math.random() < 0.015) r += t.profile === "pump" ? rnd(0.05, 0.14) : rnd(-0.09, 0.08);
    }
    const trades = Math.random() < 0.6 ? ri(1, 3) : 0;
    if (trades) {
      t.trades += trades;
      if (r >= 0) t.buys += trades; else t.sells += trades;
      t.volumeSol += trades * rnd(0.1, 1.4);
      if (r > 0 && Math.random() < 0.5) t.m.uniqueBuyers++;
    }
    t.price = Math.max(P0 * 0.08, t.price * (1 + r));
    t.athPrice = Math.max(t.athPrice, t.price);
    if (!t.migrated) {
      t.progress = clamp(((t.price * SUPPLY - P0 * SUPPLY) / (GRAD_MCAP_SOL - P0 * SUPPLY)) * 100, 0, 100);
      if (t.progress >= 100) { t.migrated = true; t.progress = 100; }
    }
    if (!t.rugged && t.profile !== "rug" && Math.random() < 0.004 && t.m.devSoldPct < 60) t.m.devSoldPct += rnd(5, 20);
    t.m.drawdownPct = (1 - t.price / t.athPrice) * 100;
    t.m.buySellRatio = t.buys / Math.max(1, t.sells);
    t.m.insiderHeldPct = t.m.devHeldPct + t.m.bundlerPct + t.m.sniperPct * 0.7;
    return true;
  }

  function health() {
    const txPerSec = Math.round(rnd(2600, 3400) + 300 * Math.sin(now / 9000));
    txTotal += txPerSec;
    const withAvoid = alerts.filter((a) => a.avoidedPct > 0).map((a) => a.avoidedPct).sort((a, b) => a - b);
    const det = alerts.map((a) => a.detectMs).sort((a, b) => a - b);
    const med = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : 0);
    const crit5m = alerts.filter((a) => a.severity === "critical" && a.move5m !== undefined).map((a) => a.move5m);
    return {
      uptimeSec: Math.round((now - start) / 1000) + 3600 * 2 + 1260,
      grpc: { connected: true, reconnects: 1, lastSlot: slot, txTotal, txPerSec, msgPerSec: Math.round(txPerSec * 1.18), watchedAccounts: 2 + watches.size * 2, replayedFromSlot: 318_441_212 },
      chainSlot: slot + ri(0, 2),
      slotsBehind: ri(0, 2),
      blur: { enabled: true, ok: true, calls: blur.calls, errors: blur.errors, avgMs: rnd(70, 110) },
      rpc: { ok: true },
      beam: { sent: beam.sent, landed: beam.landed, failed: beam.failed, avgLandMs: beam.landed ? beam.landSum / beam.landed : 0 },
      solUsd,
      stats: {
        launchesSeen, tracked: tokens.size, watches: watches.size,
        alertsFired: alerts.length, criticalAlerts: alerts.filter((a) => a.severity === "critical").length,
        medianAvoidedPct: med(withAvoid), medianDetectMs: med(det),
        alertMove5m: median(crit5m), baselineMove5m: median(baseline),
        alertSamples: crit5m.length, baselineSamples: baseline.length,
      },
    };
  }

  function step() {
    tickN++;
    if (now >= nextSpawn) {
      const t = spawn(now);
      out("launch", view(t));
      nextSpawn = now + rnd(900, 3200);
    }
    queue.sort((a, b) => a.at - b.at);
    while (queue.length && queue[0].at <= now) queue.shift().fn();
    for (const t of tokens.values()) {
      if (!evolve(t)) continue;
      // throttle: ~1 update per second per mint, staggered
      if ((tickN + t.phase) % 4 === 0) {
        t.spark.push(t.price);
        if (t.spark.length > 60) t.spark.shift();
        t.risk = scoreOf(t);
        out("launch", view(t));
        const w = watches.get(t.mint);
        if (w) out("watch", watchView(w));
      }
    }
    // baseline: watched tokens at random moments (mostly quiet periods, like the real sampler)
    if (tickN % 12 === 0 && watches.size) {
      const w = pick([...watches.values()]);
      const tk = tokens.get(w.mint);
      if (tk && (tk.rugged >= 7 || tk.rugAt - now > 300e3)) {
        const p0 = tk.price;
        at(now + 300e3, () => { const t2 = tokens.get(w.mint); if (t2) baseline.push((t2.price / p0 - 1) * 100); });
      }
    }
    if (tickN % 4 === 0) {
      slot += ri(2, 3);
      solUsd = clamp(solUsd + rnd(-0.08, 0.08), 140, 160);
      out("health", health());
    }
  }

  // Fast-forward a few minutes so the page opens on a populated state.
  while (now < Date.now()) { step(); now += TICK; }
  // a couple of manual watches and a manual paper exit for variety
  const pool = [...tokens.values()].filter((t) => !watches.has(t.mint) && t.profile !== "rug");
  for (const t of pool.slice(-2)) arm(t, "manual", false);
  arm(findOrCreate(b58(40) + "pump"), "manual", false); // hand-armed mint with no launch data -> risk "unknown"
  live = true;
  emit("snapshot", {
    launches: [...tokens.values()].sort((a, b) => b.createdAt - a.createdAt).filter((t, i) => i < 150 || watches.has(t.mint)).map(view),
    watches: [...watches.values()].map(watchView),
    alerts, exits: exits.map((e) => ({ ...e })), health: health(),
    config: { exitMode, autoWatch: true, blur: true, wallet: b58(44) },
  });
  const timer = setInterval(() => { now = Date.now(); step(); }, TICK);

  // ---- fake REST ----
  function holders(t) {
    let s = 0;
    for (const c of t.mint) s = (s * 33 + c.charCodeAt(0)) >>> 0;
    const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const wallet = () => Array.from({ length: 44 }, () => B58[Math.floor(rng() * 58)]).join("");
    const list = [];
    const push = (w, role, boughtPct, heldPct) => {
      const bought = boughtPct / 100 * SUPPLY;
      const held = Math.max(0, heldPct) / 100 * SUPPLY;
      list.push({ wallet: w, role, bought, sold: Math.max(0, bought - held), held, heldPct: Math.max(0, heldPct) });
    };
    const m = t.m;
    push(t.creator, "dev", m.devInitialPct, m.devHeldPct);
    const split = (n, total, orig) => Array.from({ length: n }, () => rng() + 0.3).map((x, _, a) => x / a.reduce((p, q) => p + q, 0)).map((f) => [f * orig, f * total]);
    split(m.bundlers, m.bundlerPct, Math.max(m.bundlerPct, t.risk.metrics.bundlerPct)).forEach(([b, h]) => push(wallet(), "bundler", b * (t.rugged ? 4 : 1), h));
    split(Math.min(m.snipers, 8), m.sniperPct, m.sniperPct * (t.rugged ? 2 : 1.2)).forEach(([b, h]) => push(wallet(), "sniper", b, h));
    for (let i = 0; i < Math.min(t.recipients, 4); i++) push(wallet(), "linked", 0, m.devTransferredPct / Math.max(1, t.recipients));
    for (let i = 0; i < 14; i++) { const b = rng() * 2.4; push(wallet(), "trader", b, b * (0.3 + rng() * 0.7)); }
    return list.sort((a, b) => b.held - a.held).slice(0, 25);
  }

  function findOrCreate(mint) {
    let t = tokens.get(mint);
    if (!t) {
      t = spawn(now - 40 * 60e3);
      tokens.delete(t.mint);
      t.mint = mint;
      t.profile = "slow";
      t.rugAt = Infinity;
      t.adopted = true;
      t.risk = unknownRisk();
      tokens.set(mint, t);
    }
    return t;
  }

  async function api(method, path, body) {
    await new Promise((r) => setTimeout(r, rnd(60, 180)));
    const mm = path.match(/^\/api\/(launch|watch|exit)(?:\/([^/?]+))?/);
    if (!mm) throw new Error("404");
    const [, kind, mint] = mm;
    if (kind === "launch" && method === "GET") {
      const t = tokens.get(mint);
      if (!t) throw new Error("unknown mint");
      return { ...view(t), holders: holders(t) };
    }
    if (kind === "watch" && method === "POST") return arm(findOrCreate(body.mint), "manual", body.autoExit);
    if (kind === "watch" && method === "DELETE") {
      watches.delete(mint);
      out("watch_removed", { mint });
      const t = tokens.get(mint);
      if (t) out("launch", view(t));
      return { ok: true };
    }
    if (kind === "exit" && method === "POST") return { ...doExit(findOrCreate(mint), "manual", Date.now()) };
    throw new Error("405");
  }

  return { api, stop: () => clearInterval(timer) };
}
