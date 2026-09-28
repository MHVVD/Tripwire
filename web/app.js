// Tripwire dashboard. No build step: Preact + htm vendored in web/vendor.
import { h, render, Component } from "./vendor/preact.js";
import { useState, useEffect, useRef, useMemo } from "./vendor/hooks.js";
import htm from "./vendor/htm.js";

const html = htm.bind(h);

const LAUNCH_CAP = 150;
const ALERT_CAP = 200;
const EXIT_CAP = 100;
const params = new URLSearchParams(location.search);
const DEMO_ALLOWED = params.get("demo") === "1";
const BOOT_T = Date.now();

// ---------------------------------------------------------------------------
// Store: plain mutable state + rAF-batched re-render
// ---------------------------------------------------------------------------
const store = {
  conn: "connecting", // connecting | live | reconnecting | demo
  launches: new Map(),
  watches: new Map(),
  alerts: [],
  exits: [],
  health: null,
  config: { exitMode: "paper", autoWatch: false, blur: false },
  txHist: [],
  now: Date.now(),
  filter: "all",
  openMint: null,
  pending: new Set(),
  toasts: [],
  muted: true,
  version: 0,
};

let rerender = () => {};
let rafQueued = false;
function bump() {
  store.version++;
  if (rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(() => {
    rafQueued = false;
    rerender();
  });
}

function toast(msg, kind = "info") {
  const id = Math.random().toString(36).slice(2);
  store.toasts = [...store.toasts, { id, msg, kind }].slice(-4);
  bump();
  setTimeout(() => {
    store.toasts = store.toasts.filter((t) => t.id !== id);
    bump();
  }, 3200);
}

// ---------------------------------------------------------------------------
// Event handling (shared by SSE and demo)
// ---------------------------------------------------------------------------
function evictLaunches() {
  if (store.launches.size <= LAUNCH_CAP) return;
  const sorted = [...store.launches.values()].sort((a, b) => a.createdAt - b.createdAt);
  for (const l of sorted) {
    if (store.launches.size <= LAUNCH_CAP) break;
    if (l.watched || store.watches.has(l.mint) || l.mint === store.openMint) continue;
    store.launches.delete(l.mint);
  }
}

function upsertById(list, item, cap) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) {
    const next = list.slice();
    next[i] = item;
    return next;
  }
  return [item, ...list].slice(0, cap);
}

const handlers = {
  snapshot(s) {
    store.launches = new Map((s.launches || []).map((l) => [l.mint, l]));
    store.watches = new Map((s.watches || []).map((w) => [w.mint, w]));
    store.alerts = (s.alerts || []).slice(0, ALERT_CAP);
    store.exits = (s.exits || []).slice(0, EXIT_CAP);
    store.config = s.config || store.config;
    if (s.health) handlers.health(s.health);
  },
  launch(l) {
    store.launches.set(l.mint, l);
    evictLaunches();
  },
  launch_removed({ mint }) {
    if (!store.watches.has(mint) && mint !== store.openMint) store.launches.delete(mint);
  },
  alert(a) {
    const isNew = !store.alerts.some((x) => x.id === a.id);
    store.alerts = upsertById(store.alerts, a, ALERT_CAP);
    if (isNew && a.severity === "critical") beep();
  },
  alert_update(a) {
    store.alerts = upsertById(store.alerts, a, ALERT_CAP);
    const w = store.watches.get(a.mint);
    if (w && w.lastAlert && w.lastAlert.id === a.id) store.watches.set(a.mint, { ...w, lastAlert: a });
  },
  watch(w) {
    store.watches.set(w.mint, w);
    const l = store.launches.get(w.mint);
    if (l && !l.watched) store.launches.set(w.mint, { ...l, watched: true });
  },
  watch_removed({ mint }) {
    store.watches.delete(mint);
    const l = store.launches.get(mint);
    if (l && l.watched) store.launches.set(mint, { ...l, watched: false });
  },
  exit(e) {
    store.exits = upsertById(store.exits, e, EXIT_CAP);
  },
  health(hl) {
    store.health = hl;
    store.txHist = [...store.txHist, hl.grpc?.txPerSec ?? 0].slice(-60);
  },
};

function dispatch(name, data) {
  const fn = handlers[name];
  if (!fn) return;
  try {
    fn(data);
  } catch (e) {
    console.warn("handler failed", name, e);
  }
  bump();
}

// ---------------------------------------------------------------------------
// SSE with backoff, demo fallback
// ---------------------------------------------------------------------------
let es = null;
let retry = 0;
let retryTimer = null;
let demo = null;

function connect() {
  if (demo) return;
  es = new EventSource("/api/stream");
  es.onopen = () => {
    retry = 0;
    store.conn = "live";
    bump();
  };
  for (const name of Object.keys(handlers)) {
    es.addEventListener(name, (ev) => {
      let data;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (store.conn !== "live") store.conn = "live";
      dispatch(name, data);
    });
  }
  es.onerror = () => {
    es.close();
    es = null;
    store.conn = "reconnecting";
    bump();
    const delay = Math.min(15000, 800 * 2 ** retry++) + Math.random() * 300;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, delay);
  };
}

async function startDemo() {
  clearTimeout(retryTimer);
  if (es) es.close();
  es = null;
  const mod = await import("./demo.js");
  store.conn = "demo";
  demo = mod.createDemo(dispatch, { exitMode: params.get("mode") === "paper" ? "paper" : "live" });
  bump();
}

connect();
if (DEMO_ALLOWED) {
  setTimeout(() => {
    if (store.conn !== "live") startDemo();
  }, 3000);
}

setInterval(() => {
  store.now = Date.now();
  bump();
}, 1000);

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------
async function api(method, path, body) {
  if (demo) return demo.api(method, path, body);
  const r = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      const j = await r.json();
      msg = j.error || j.message || msg;
    } catch {}
    throw new Error(msg);
  }
  return r.json();
}

async function withPending(key, fn) {
  store.pending.add(key);
  bump();
  try {
    return await fn();
  } catch (e) {
    toast(e.message || String(e), "error");
  } finally {
    store.pending.delete(key);
    bump();
  }
}

const actions = {
  arm: (mint, autoExit) =>
    withPending("arm:" + mint, async () => {
      const w = await api("POST", "/api/watch", autoExit === undefined ? { mint } : { mint, autoExit });
      if (w && w.mint) handlers.watch(w);
      toast(`Tripwire armed on ${w?.symbol ? "$" + w.symbol : short(mint)}`, "ok");
    }),
  setAutoExit: (w) =>
    withPending("arm:" + w.mint, async () => {
      const nw = await api("POST", "/api/watch", { mint: w.mint, autoExit: !w.autoExit });
      if (nw && nw.mint) handlers.watch(nw);
    }),
  disarm: (mint) =>
    withPending("disarm:" + mint, async () => {
      await api("DELETE", `/api/watch/${mint}`);
      handlers.watch_removed({ mint });
      toast("Tripwire disarmed");
    }),
  exit: (mint) =>
    withPending("exit:" + mint, async () => {
      const e = await api("POST", `/api/exit/${mint}`, {});
      if (e && e.id) handlers.exit(e);
      toast(`Exit ${e?.mode === "live" ? "sent via Beam" : "simulated (paper)"}`, "ok");
    }),
};

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------
let actx = null;
let lastBeep = 0;
function beep() {
  if (store.muted || !actx) return;
  const now = performance.now();
  if (now - lastBeep < 400) return;
  lastBeep = now;
  const t = actx.currentTime;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = "square";
  o.frequency.setValueAtTime(1175, t);
  o.frequency.setValueAtTime(880, t + 0.08);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + 0.25);
}
function toggleMute() {
  store.muted = !store.muted;
  if (!store.muted) {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    actx.resume?.();
    beep();
  }
  bump();
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
const MINUS = "−";
const ok = (v) => v !== undefined && v !== null && Number.isFinite(v);

function fmtUsd(v) {
  if (!ok(v)) return "—";
  const a = Math.abs(v);
  const s = v < 0 ? MINUS : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(a < 10 ? 2 : 0)}`;
}
function fmtPrice(p) {
  if (!ok(p)) return "—";
  if (p === 0) return "0";
  if (Math.abs(p) < 0.001) return p.toExponential(2);
  return p.toPrecision(4);
}
function fmtPct(v, signed = false) {
  if (!ok(v)) return "—";
  const sign = v < 0 ? MINUS : signed && v > 0 ? "+" : "";
  return `${sign}${Math.abs(v).toFixed(1)}%`;
}
function fmtNum(v, digits = 1) {
  if (!ok(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(digits) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(digits) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(digits) + "K";
  return a < 10 && !Number.isInteger(v) ? v.toFixed(2) : Math.round(v).toString();
}
const fmtInt = (v) => (ok(v) ? Math.round(v).toLocaleString("en-US") : "—");
function fmtMs(ms) {
  if (!ok(ms)) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}
function fmtAge(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
function fmtUptime(sec) {
  if (!ok(sec)) return "—";
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = Math.floor(sec % 60);
  return hh ? `${hh}h ${mm}m` : `${mm}m ${String(ss).padStart(2, "0")}s`;
}
const fmtClock = (t) => new Date(t).toLocaleTimeString("en-GB", { hour12: false });
const short = (a) => (a && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || "—");
const solscanTx = (sig) => `https://solscan.io/tx/${sig}`;
const solscanToken = (m) => `https://solscan.io/token/${m}`;
const solscanAcct = (a) => `https://solscan.io/account/${a}`;
const pumpUrl = (m) => `https://pump.fun/coin/${m}`;

const LEVEL_LABEL = { low: "LOW", medium: "MED", high: "HIGH", critical: "CRIT" };
const levelOf = (risk) => risk?.level || "low";
const cx = (...c) => c.filter(Boolean).join(" ");

// ---------------------------------------------------------------------------
// SVG primitives
// ---------------------------------------------------------------------------
function Spark({ data, w = 84, h = 26, color }) {
  if (!data || data.length < 2) return html`<svg class="spark" width=${w} height=${h}></svg>`;
  let min = Infinity, max = -Infinity;
  for (const v of data) { if (v < min) min = v; if (v > max) max = v; }
  const span = max - min || max || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`);
  const up = data[data.length - 1] >= data[0];
  const c = color || (up ? "var(--green)" : "var(--red)");
  return html`<svg class="spark" width=${w} height=${h} viewBox="0 0 ${w} ${h}">
    <polygon points=${`0,${h} ${pts.join(" ")} ${w},${h}`} fill=${c} opacity="0.12" />
    <polyline points=${pts.join(" ")} fill="none" stroke=${c} stroke-width="1.4" stroke-linejoin="round" />
  </svg>`;
}

function PriceChart({ data, entry, alertPrices = [] }) {
  const W = 600, H = 170;
  if (!data || data.length < 2) return html`<div class="chart empty">waiting for trades…</div>`;
  const vals = entry ? [...data, entry] : data;
  let min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.08 || max * 0.05 || 1;
  min -= pad; max += pad;
  const y = (v) => H - ((v - min) / (max - min)) * H;
  const step = W / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = data[data.length - 1] >= data[0];
  const c = up ? "var(--green)" : "var(--red)";
  const hi = Math.max(...data);
  const last = data[data.length - 1];
  return html`<div class="chart">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height=${H}>
      <defs>
        <linearGradient id="pcfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color=${c} stop-opacity="0.28" />
          <stop offset="1" stop-color=${c} stop-opacity="0" />
        </linearGradient>
      </defs>
      ${[0.25, 0.5, 0.75].map((f) => html`<line x1="0" x2=${W} y1=${H * f} y2=${H * f} class="grid" vector-effect="non-scaling-stroke" />`)}
      ${entry ? html`<line x1="0" x2=${W} y1=${y(entry)} y2=${y(entry)} class="entry" vector-effect="non-scaling-stroke" />` : null}
      <polygon points=${`0,${H} ${pts} ${W},${H}`} fill="url(#pcfill)" />
      <polyline points=${pts} fill="none" stroke=${c} stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
    </svg>
    <div class="chart-lbl top">high ${fmtPrice(hi)}</div>
    <div class="chart-lbl last" style=${{ top: `${Math.min(88, Math.max(4, (y(last) / H) * 100))}%` }}>${fmtPrice(last)}</div>
    ${entry ? html`<div class="chart-lbl entry-lbl" style=${{ top: `${Math.min(90, Math.max(2, (y(entry) / H) * 100))}%` }}>entry ${fmtPrice(entry)}</div>` : null}
  </div>`;
}

function RiskGauge({ risk }) {
  const score = risk?.score ?? 0;
  const lvl = levelOf(risk);
  const R = 70, cxp = 90, cyp = 86;
  const arc = (from, to) => {
    const a0 = Math.PI * (1 - from), a1 = Math.PI * (1 - to);
    const x0 = cxp + R * Math.cos(a0), y0 = cyp - R * Math.sin(a0);
    const x1 = cxp + R * Math.cos(a1), y1 = cyp - R * Math.sin(a1);
    return `M ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1}`;
  };
  const f = Math.max(0.001, Math.min(1, score / 100));
  const na = Math.PI * (1 - f);
  return html`<div class=${cx("gauge", "lvl-" + lvl)}>
    <svg viewBox="0 0 180 100" width="180" height="100">
      <path d=${arc(0, 0.2)} class="g-seg g-low" />
      <path d=${arc(0.2, 0.45)} class="g-seg g-med" />
      <path d=${arc(0.45, 0.7)} class="g-seg g-high" />
      <path d=${arc(0.7, 1)} class="g-seg g-crit" />
      <path d=${arc(0, f)} class="g-val" />
      <circle cx=${cxp + R * Math.cos(na)} cy=${cyp - R * Math.sin(na)} r="5" class="g-dot" />
    </svg>
    <div class="g-score">${Math.round(score)}</div>
    <div class="g-level">${(lvl || "").toUpperCase()} RISK</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Small UI atoms
// ---------------------------------------------------------------------------
const RiskBadge = ({ risk, size = "md" }) => {
  const lvl = levelOf(risk);
  return html`<div class=${cx("rbadge", "lvl-" + lvl, size)} title=${`${lvl} risk`}>
    <b>${risk ? Math.round(risk.score) : "–"}</b><span>${LEVEL_LABEL[lvl]}</span>
  </div>`;
};

const Chip = ({ kind, children, title }) => html`<span class=${cx("chip", kind)} title=${title}>${children}</span>`;

function TokenMark({ mint, symbol }) {
  // deterministic hue from mint so each token has a recognizable avatar
  let hsh = 0;
  for (let i = 0; i < (mint || "").length; i++) hsh = (hsh * 31 + mint.charCodeAt(i)) >>> 0;
  const hue = hsh % 360;
  return html`<div class="tmark" style=${{ background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 60) % 360} 70% 35%))` }}>
    ${(symbol || "?").slice(0, 1).toUpperCase()}
  </div>`;
}

function Pill({ state = "ok", label, value, title }) {
  return html`<div class=${cx("pill", state)} title=${title}>
    <i class="dot"></i><span class="pl">${label}</span>${value !== undefined ? html`<span class="pv">${value}</span>` : null}
  </div>`;
}

// ---------------------------------------------------------------------------
// Top bar + hero
// ---------------------------------------------------------------------------
function TopBar() {
  const hl = store.health;
  const g = hl?.grpc;
  const conn = store.conn;
  const mode = store.config?.exitMode === "live" ? "live" : "paper";
  const behind = hl?.slotsBehind;
  return html`<header class="topbar">
    <div class="brand">
      <svg class="logo" viewBox="0 0 32 32" width="26" height="26"><path d="M3 20h8l3-9 4 14 3-9h8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div>
        <div class="wordmark">TRIPWIRE</div>
        <div class="tagline">rug radar & auto-exit, live on Solami</div>
      </div>
      <span class=${cx("mode", mode)} title="EXIT_MODE">${mode === "live" ? "LIVE EXITS" : "PAPER"}</span>
      ${conn === "demo" ? html`<span class="mode demo">DEMO DATA</span>` : null}
    </div>
    <div class="pills">
      <${Pill} state=${g?.connected ? "ok" : hl ? "bad" : "idle"} label="gRPC" value=${g?.connected ? `${fmtInt(g.txPerSec)} tx/s` : "down"} title=${g?.lastError || "Yellowstone gRPC firehose"} />
      <${Pill} state=${ok(behind) && behind > 8 ? "warn" : g?.lastSlot ? "ok" : "idle"} label="slot" value=${html`${fmtInt(g?.lastSlot)}${ok(behind) ? html`<em class=${behind > 8 ? "warn" : ""}> ${behind > 0 ? MINUS + behind : "tip"}</em>` : null}`} title="last processed slot · slots behind chain tip" />
      <${Pill} state=${!hl?.blur?.enabled ? "idle" : hl.blur.ok ? "ok" : "bad"} label="Blur" value=${!hl?.blur?.enabled ? "off" : hl.blur.ok ? `${Math.round(hl.blur.avgMs)}ms` : "err"} title=${hl?.blur?.lastError || "Blur market data"} />
      <${Pill} state=${hl?.beam?.failed > 0 && hl.beam.landed === 0 ? "warn" : hl ? "ok" : "idle"} label="Beam" value=${hl ? `${hl.beam.landed}/${hl.beam.sent}` : "—"} title="Beam landed / sent" />
      <${Pill} state=${hl?.rpc?.ok === false ? "bad" : hl ? "ok" : "idle"} label="SOL" value=${ok(hl?.solUsd) ? `$${hl.solUsd.toFixed(2)}` : "—"} title=${hl?.rpc?.lastError || "SOL/USD"} />
      <div class=${cx("stream", conn)}>
        <i class="pulse"></i>
        ${conn === "live" ? "STREAMING" : conn === "demo" ? "DEMO STREAM" : conn === "reconnecting" ? "RECONNECTING…" : "CONNECTING…"}
      </div>
    </div>
  </header>`;
}

function Hero() {
  const s = store.health?.stats;
  const tx = store.health?.grpc;
  const tiles = [
    { k: "Launches seen", v: fmtInt(s?.launchesSeen), sub: s ? `${fmtInt(s.tracked)} tracked live` : "" },
    { k: "Under watch", v: fmtInt(s?.watches ?? store.watches.size), sub: `${[...store.watches.values()].filter((w) => w.autoExit).length} with auto-exit`, cls: "accent" },
    { k: "Alerts fired", v: fmtInt(s?.alertsFired), sub: html`<span class="crit-txt">${fmtInt(s?.criticalAlerts)} critical</span>`, cls: s?.criticalAlerts ? "red" : "" },
    { k: "Median drop avoided", v: ok(s?.medianAvoidedPct) && s.medianAvoidedPct > 0 ? `${MINUS}${s.medianAvoidedPct.toFixed(1)}%` : "—", sub: "price fall after alert", cls: "green big" },
    { k: "Median detection", v: ok(s?.medianDetectMs) ? fmtMs(s.medianDetectMs) : "—", sub: "slot first seen → alert" },
  ];
  return html`<section class="hero">
    ${tiles.map((t) => html`<div class=${cx("tile", t.cls)}>
      <div class="tk">${t.k}</div>
      <div class="tv">${t.v}</div>
      <div class="ts">${t.sub}</div>
    </div>`)}
    <div class="tile fire">
      <div class="fire-txt">
        <div class="tk">gRPC firehose</div>
        <div class="tv">${fmtInt(tx?.txPerSec)}<small> tx/s</small></div>
        <div class="ts" title=${`${fmtInt(tx?.txTotal)} tx total`}>${fmtInt(tx?.msgPerSec)} msg/s</div>
      </div>
      <div class="fire-spark"><${Spark} data=${store.txHist} w=${120} h=${44} color="var(--accent)" /></div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Launch radar
// ---------------------------------------------------------------------------
class LaunchRow extends Component {
  shouldComponentUpdate(n) {
    const p = this.props;
    return n.l !== p.l || n.armed !== p.armed || n.pending !== p.pending || n.sec !== p.sec || n.active !== p.active;
  }
  render({ l, armed, pending, active }) {
    const flags = (l.risk?.flags || []).slice().sort((a, b) => b.weight - a.weight);
    const top = flags[0];
    const more = flags.length - 1;
    const lvl = levelOf(l.risk);
    const fresh = Date.now() - l.createdAt < 4000 && l.createdAt > BOOT_T - 1000;
    return html`<div class=${cx("lrow", "lvl-" + lvl, fresh && "fresh", active && "active", armed && "armed")} onClick=${() => { store.openMint = l.mint; bump(); }}>
      <${RiskBadge} risk=${l.risk} />
      <div class="lmain">
        <div class="l1">
          <span class="sym">${l.symbol || "???"}</span>
          <span class="nm">${l.name}</span>
          ${l.enriched ? html`<span class="blur-tag" title="Blur intel attached">B</span>` : null}
          <span class="age">${fmtAge(Date.now() - l.createdAt)}</span>
        </div>
        <div class="l2">
          ${l.migrated
            ? html`<span class="grad">GRADUATED</span>`
            : html`<div class="prog"><i style=${{ width: `${Math.min(100, Math.max(0, l.progress || 0))}%` }}></i></div><span class="pct">${Math.round(l.progress || 0)}%</span>`}
          <span class="bs"><b class="g">${l.buys}</b>/<b class="r">${l.sells}</b></span>
        </div>
        <div class="l3">
          ${top ? html`<span class=${cx("fl", top.severity)}>${top.detail}</span>` : html`<span class="fl none">no red flags yet</span>`}
          ${more > 0 ? html`<span class="more">+${more}</span>` : null}
        </div>
      </div>
      <div class="lmkt">
        <${Spark} data=${l.spark} w=${78} h=${24} />
        <div class="mc">${fmtUsd(l.mcapUsd)}</div>
      </div>
      <button class=${cx("arm", armed && "on")} disabled=${armed || pending}
        onClick=${(e) => { e.stopPropagation(); if (!armed) actions.arm(l.mint); }}>
        ${armed ? html`<span>◉</span> Armed` : pending ? "…" : "Arm"}
      </button>
    </div>`;
  }
}

const FILTERS = [
  ["all", "All"],
  ["low", "Low risk"],
  ["high", "High risk"],
  ["watched", "Watched"],
];

function LaunchRadar({ launches }) {
  const f = store.filter;
  const isArmed = (l) => l.watched || store.watches.has(l.mint);
  const pass = {
    all: () => true,
    low: (l) => levelOf(l.risk) === "low",
    high: (l) => ["high", "critical"].includes(levelOf(l.risk)),
    watched: isArmed,
  };
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, launches.filter(pass[k]).length]));
  const rows = launches.filter(pass[f]);
  const sec = Math.floor(store.now / 1000);
  return html`<section class="panel radar">
    <div class="ph">
      <h2><span class="live-dot"></span>Launch Radar <small>pump.fun · live</small></h2>
      <div class="chips">
        ${FILTERS.map(([k, label]) => html`<button class=${cx("fchip", f === k && "on", "f-" + k)} onClick=${() => { store.filter = k; bump(); }}>
          ${label}<b>${counts[k]}</b>
        </button>`)}
      </div>
    </div>
    <div class="pb list">
      ${rows.length === 0 ? html`<div class="empty">${store.conn === "live" || store.conn === "demo" ? "No launches match this filter yet." : "Waiting for the firehose…"}</div>` : null}
      ${rows.map((l) => html`<${LaunchRow} key=${l.mint} l=${l} armed=${isArmed(l)} pending=${store.pending.has("arm:" + l.mint)} sec=${sec} active=${store.openMint === l.mint} />`)}
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Tripwires
// ---------------------------------------------------------------------------
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function ArmForm() {
  const [mint, setMint] = useState("");
  const [auto, setAuto] = useState(true);
  const valid = MINT_RE.test(mint.trim());
  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return toast("Not a valid mint address", "error");
    await actions.arm(mint.trim(), auto);
    setMint("");
  };
  return html`<form class="armform" onSubmit=${submit}>
    <input placeholder="Arm any mint by address…" value=${mint} onInput=${(e) => setMint(e.target.value)} spellcheck="false" />
    <label class="chk"><input type="checkbox" checked=${auto} onChange=${(e) => setAuto(e.target.checked)} /><span>auto-exit</span></label>
    <button class="btn accent" disabled=${!valid}>Arm</button>
  </form>`;
}

function WatchCard({ w, launch }) {
  const pnl = w.pnlPct;
  const lvl = levelOf(w.risk || launch?.risk);
  const hot = w.lastAlert && Date.now() - w.lastAlert.t < 60000;
  return html`<div class=${cx("wcard", hot && "hot", w.lastAlert?.severity === "critical" && hot && "hot-crit")} onClick=${() => { store.openMint = w.mint; bump(); }}>
    <div class="w1">
      <${TokenMark} mint=${w.mint} symbol=${w.symbol} />
      <div class="wid">
        <div><span class="sym">$${w.symbol || short(w.mint)}</span>
          <${Chip} kind=${"src-" + w.source}>${w.source}</${Chip}>
          ${w.risk || launch?.risk ? html`<span class=${cx("rtag", "lvl-" + lvl)}>${Math.round((w.risk || launch.risk).score)}</span>` : null}
        </div>
        <div class="wsub">armed ${fmtAge(Date.now() - w.armedAt)} ago</div>
      </div>
      <div class=${cx("pnl", pnl >= 0 ? "g" : "r")}>${fmtPct(pnl, true)}</div>
    </div>
    <div class="w2">
      <div class="px"><span>entry</span>${fmtPrice(w.entryPrice)}<span class="arrow">→</span><b class=${w.price >= w.entryPrice ? "g" : "r"}>${fmtPrice(w.price)}</b></div>
      ${launch?.spark ? html`<${Spark} data=${launch.spark} w=${90} h=${22} />` : null}
    </div>
    <div class=${cx("w3", w.lastAlert && "has", w.lastAlert?.severity)}>
      ${w.alerts > 0
        ? html`<span class="acount">${w.alerts}</span><span class="atitle">${w.lastAlert?.title || "alert"}</span>`
        : html`<span class="quiet">tripwire quiet · no insider activity</span>`}
    </div>
    <div class="w4" onClick=${(e) => e.stopPropagation()}>
      <button class=${cx("toggle", w.autoExit && "on")} onClick=${() => actions.setAutoExit(w)} title="Auto-exit through Beam when a critical alert fires">
        <i></i>auto-exit ${w.autoExit ? "ON" : "OFF"}
      </button>
      <span class="spacer"></span>
      <button class="btn ghost red" disabled=${store.pending.has("exit:" + w.mint)} onClick=${() => actions.exit(w.mint)}>Exit now</button>
      <button class="btn ghost" disabled=${store.pending.has("disarm:" + w.mint)} onClick=${() => actions.disarm(w.mint)}>Disarm</button>
    </div>
  </div>`;
}

function Tripwires() {
  // tokens with a recent alert float to the top, then most recently armed/alerted
  const recent = (w) => (w.lastAlert && store.now - w.lastAlert.t < 90000 ? 1 : 0);
  const list = [...store.watches.values()].sort((a, b) => recent(b) - recent(a) || (b.lastAlert?.t || b.armedAt) - (a.lastAlert?.t || a.armedAt));
  return html`<section class="panel wires">
    <div class="ph">
      <h2>Tripwires <small>${list.length} armed</small></h2>
    </div>
    <${ArmForm} />
    <div class="pb list">
      ${list.length === 0 ? html`<div class="empty">No tripwires armed.<br />Hit <b>Arm</b> on any launch, or paste a mint above.</div>` : null}
      ${list.map((w) => html`<${WatchCard} key=${w.mint} w=${w} launch=${store.launches.get(w.mint)} />`)}
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
const RULE_LABEL = { dev_sell: "dev sell", cohort_dump: "cohort dump", dev_transfer: "dev transfer", lp_pull: "LP pull", crash: "crash", whale_sell: "whale sell" };

function AlertItem({ a }) {
  const fresh = a.t > BOOT_T - 1500 && Date.now() - a.t < 8000;
  return html`<div class=${cx("alert", a.severity, fresh && "fresh")} onClick=${() => { store.openMint = a.mint; bump(); }}>
    <div class="a1">
      <span class="asym">$${a.symbol}</span>
      <span class="atitle">${a.title}</span>
      <span class="ago">${fmtAge(Date.now() - a.t)}</span>
    </div>
    <div class="adetail">${a.detail}</div>
    <div class="a3">
      <span class=${cx("rule", a.rule)}>${RULE_LABEL[a.rule] || a.rule}</span>
      ${ok(a.detectMs) ? html`<span class="caught">caught in <b>${fmtMs(a.detectMs)}</b></span>` : null}
      ${ok(a.avoidedPct) && a.avoidedPct > 0.05 ? html`<span class="avoided" key=${Math.round(a.avoidedPct)}>avoided <b>${MINUS}${a.avoidedPct.toFixed(1)}%</b></span>` : null}
      <span class="spacer"></span>
      ${a.signature ? html`<a class="sig" href=${solscanTx(a.signature)} target="_blank" rel="noopener" onClick=${(e) => e.stopPropagation()}>${short(a.signature)} ↗</a>` : null}
    </div>
  </div>`;
}

function Alerts() {
  const crit = store.alerts.filter((a) => a.severity === "critical").length;
  return html`<section class="panel alerts">
    <div class="ph">
      <h2>Alerts <small>${store.alerts.length} · <span class="crit-txt">${crit} critical</span></small></h2>
      <button class=${cx("mute", !store.muted && "on")} onClick=${toggleMute} title="Beep on critical alerts">
        ${store.muted ? "🔇 muted" : "🔊 sound on"}
      </button>
    </div>
    <div class="pb list">
      ${store.alerts.length === 0 ? html`<div class="empty">Quiet. Alerts fire the moment insiders move on an armed token.</div>` : null}
      ${store.alerts.map((a) => html`<${AlertItem} key=${a.id} a=${a} />`)}
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Bottom row: exits + pipeline health
// ---------------------------------------------------------------------------
function Exits() {
  return html`<section class="panel exits">
    <div class="ph"><h2>Exits <small>${store.exits.length} · via Beam</small></h2></div>
    <div class="pb table-wrap">
      <table>
        <thead><tr>
          <th>time</th><th>token</th><th>mode</th><th>trigger</th><th>status</th>
          <th class="num">tokens</th><th class="num">exp. SOL</th><th class="num" title="trigger → send, send → confirmation, slots after alert tx">send → land</th><th>Beam</th><th>tx</th>
        </tr></thead>
        <tbody>
          ${store.exits.length === 0 ? html`<tr><td colspan="10" class="empty">No exits yet. Auto-exit fires on critical alerts; or hit “Exit now”.</td></tr>` : null}
          ${store.exits.map((e) => html`<tr key=${e.id} title=${e.error || ""}>
            <td class="mono dim">${fmtClock(e.t)}</td>
            <td><a class="sym link" onClick=${() => { store.openMint = e.mint; bump(); }}>$${e.symbol}</a></td>
            <td><span class=${cx("mode-sm", e.mode)}>${e.mode}</span></td>
            <td class="trig">${e.trigger}</td>
            <td><span class=${cx("status", e.status)}>${e.status}</span></td>
            <td class="num mono">${fmtNum(e.tokens)}</td>
            <td class="num mono">${ok(e.expectedSol) ? e.expectedSol.toFixed(3) : "—"}</td>
            <td class="num mono">${fmtMs(e.sendMs)} <span class="dim">→</span> <b class=${e.landMs ? "g" : ""}>${fmtMs(e.landMs)}</b>${ok(e.slotDelta) ? html`<span class="dim"> +${e.slotDelta}sl</span>` : null}</td>
            <td class="mono dim beam">${e.beam ? html`<b>${e.beam.region || "—"}</b>${ok(e.beam.tipLamports) ? ` · tip ${fmtNum(e.beam.tipLamports / 1e3, 0)}k` : ""}${e.beam.landedViaJito ? " · jito" : ""}` : "—"}</td>
            <td class="err">${e.signature ? html`<a class="sig" href=${solscanTx(e.signature)} target="_blank" rel="noopener">${short(e.signature)} ↗</a>` : e.error ? html`<span class="r">${e.error}</span>` : html`<span class="dim">—</span>`}</td>
          </tr>`)}
        </tbody>
      </table>
    </div>
  </section>`;
}

function Health() {
  const hl = store.health;
  const row = (k, v, state) => html`<div class="hrow"><span class="hk">${k}</span><span class=${cx("hv", state)}>${v}</span></div>`;
  if (!hl) return html`<section class="panel health"><div class="ph"><h2>Pipeline health</h2></div><div class="pb"><div class="empty">no data</div></div></section>`;
  const g = hl.grpc, b = hl.blur, bm = hl.beam;
  return html`<section class="panel health">
    <div class="ph"><h2>Pipeline health <small>up ${fmtUptime(hl.uptimeSec)}</small></h2></div>
    <div class="pb hgrid">
      <div class="hcol">
        <div class="hhead"><i class=${cx("dot", g.connected ? "ok" : "bad")}></i>Yellowstone gRPC</div>
        ${row("reconnects", fmtInt(g.reconnects), g.reconnects > 0 ? "warn" : "")}
        ${row("replay slot", g.replayedFromSlot ? String(g.replayedFromSlot) : "—")}
        ${row("watched accts", fmtInt(g.watchedAccounts))}
        ${row("msg/s", fmtInt(g.msgPerSec))}
      </div>
      <div class="hcol">
        <div class="hhead"><i class=${cx("dot", !b.enabled ? "idle" : b.ok ? "ok" : "bad")}></i>Blur market data</div>
        ${row("calls", fmtInt(b.calls))}
        ${row("errors", fmtInt(b.errors), b.errors > 0 ? "warn" : "")}
        ${row("avg latency", b.enabled ? fmtMs(b.avgMs) : "disabled")}
        ${row("RPC", hl.rpc.ok ? "ok" : "error", hl.rpc.ok ? "g" : "r")}
      </div>
      <div class="hcol">
        <div class="hhead"><i class=${cx("dot", bm.failed > 0 && !bm.landed ? "warn" : "ok")}></i>Beam tx landing</div>
        ${row("sent", fmtInt(bm.sent))}
        ${row("landed", fmtInt(bm.landed), "g")}
        ${row("failed", fmtInt(bm.failed), bm.failed ? "r" : "")}
        ${row("avg land", bm.landed ? fmtMs(bm.avgLandMs) : "—")}
      </div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------
const ROLE_ORDER = ["dev", "bundler", "sniper", "linked", "trader"];

function Drawer({ mint }) {
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    setDetail(null);
    setErr(null);
    const load = () =>
      api("GET", `/api/launch/${mint}`)
        .then((d) => alive && (setDetail(d), setErr(null)))
        .catch((e) => alive && setErr(e.message || String(e)));
    load();
    const t = setInterval(load, 2500);
    return () => { alive = false; clearInterval(t); };
  }, [mint]);

  // live fields from the stream win over the last REST snapshot
  const live = store.launches.get(mint);
  const d = detail || live ? { ...(detail || {}), ...(live || {}), holders: detail?.holders } : null;
  const w = store.watches.get(mint);
  const armed = !!(w || d?.watched);
  const close = () => { store.openMint = null; bump(); };
  const copy = () => navigator.clipboard?.writeText(mint).then(() => toast("Mint copied"), () => toast("Copy failed", "error"));
  const m = d?.risk?.metrics;
  const alertsForMint = store.alerts.filter((a) => a.mint === mint).slice(0, 6);

  const metric = (k, v, bad) => html`<div class=${cx("metric", bad && "bad")}><label>${k}</label><b>${v}</b></div>`;
  return html`<div class="drawer-wrap" onClick=${close}>
    <aside class="drawer" onClick=${(e) => e.stopPropagation()}>
      <div class="dh">
        <${TokenMark} mint=${mint} symbol=${d?.symbol} />
        <div class="dtitle">
          <div class="dname">${d?.name || "Loading…"} <span class="sym">$${d?.symbol || "…"}</span>
            ${d?.migrated ? html`<span class="grad">GRADUATED</span>` : null}
          </div>
          <div class="dmint">
            <span class="mono">${mint}</span>
            <button class="icon" onClick=${copy} title="Copy mint">⧉</button>
          </div>
          <div class="dcreator">creator <a href=${solscanAcct(d?.creator)} target="_blank" rel="noopener" class="mono">${short(d?.creator)}</a>
            ${d ? html`· age ${fmtAge(Date.now() - d.createdAt)} · ${d.trades} trades · ${d.volumeSol?.toFixed(1)} SOL vol` : null}
          </div>
        </div>
        <button class="icon close" onClick=${close} title="Close (Esc)">✕</button>
      </div>

      ${err && !d ? html`<div class="empty r">Failed to load: ${err}</div>` : null}
      ${d ? html`
        <div class="dbody">
          <div class="drow">
            <${RiskGauge} risk=${d.risk} />
            <div class="dflags">
              ${(d.risk?.flags || []).length === 0 ? html`<div class="fl none">No flags raised.</div>` : null}
              ${(d.risk?.flags || []).slice().sort((a, b) => b.weight - a.weight).map((f) => html`<div class=${cx("dflag", f.severity)}>
                <i></i><span class="fid">${f.id.replace(/_/g, " ")}</span><span class="fdet">${f.detail}</span><span class="fw">+${f.weight}</span>
              </div>`)}
            </div>
          </div>

          <div class="dprice">
            <div class="dp-head">
              <div><span class="k">price</span><b class="mono">${fmtPrice(d.price)} SOL</b></div>
              <div><span class="k">mcap</span><b>${fmtUsd(d.mcapUsd)}</b></div>
              <div><span class="k">ATH</span><b class="mono">${fmtPrice(d.athPrice)}</b></div>
              <div><span class="k">bonding</span><b>${d.migrated ? "migrated" : `${Math.round(d.progress)}%`}</b></div>
              ${w ? html`<div><span class="k">paper PnL</span><b class=${w.pnlPct >= 0 ? "g" : "r"}>${fmtPct(w.pnlPct, true)}</b></div>` : null}
            </div>
            <${PriceChart} data=${d.spark} entry=${w?.entryPrice} />
          </div>

          ${m ? html`<div class="metrics">
            ${metric("dev initial", fmtPct(m.devInitialPct), m.devInitialPct >= 10)}
            ${metric("dev held", fmtPct(m.devHeldPct), m.devHeldPct >= 10)}
            ${metric("dev sold", fmtPct(m.devSoldPct), m.devSoldPct >= 10)}
            ${metric("dev transferred", fmtPct(m.devTransferredPct), m.devTransferredPct >= 0.5)}
            ${metric("bundlers", html`${m.bundlers} <small>· ${fmtPct(m.bundlerPct)}</small>`, m.bundlerPct >= 10)}
            ${metric("snipers", html`${m.snipers} <small>· ${fmtPct(m.sniperPct)}</small>`, m.sniperPct >= 20)}
            ${metric("insiders hold", fmtPct(m.insiderHeldPct), m.insiderHeldPct >= 25)}
            ${metric("linked wallets", fmtInt(m.linkedWallets), m.linkedWallets >= 2)}
            ${metric("unique buyers", fmtInt(m.uniqueBuyers))}
            ${metric("buy/sell ratio", ok(m.buySellRatio) ? m.buySellRatio.toFixed(2) : "—", m.buySellRatio < 0.8)}
            ${metric("drawdown", fmtPct(m.drawdownPct), m.drawdownPct >= 50)}
            ${metric("buys / sells", html`<span class="g">${d.buys}</span> / <span class="r">${d.sells}</span>`)}
          </div>` : null}

          ${alertsForMint.length ? html`<div class="dsec">
            <h3>Alerts on this token</h3>
            ${alertsForMint.map((a) => html`<div class=${cx("dalert", a.severity)}>
              <span class="mono dim">${fmtClock(a.t)}</span><b>${a.title}</b>
              ${ok(a.avoidedPct) ? html`<span class="avoided">avoided <b>${MINUS}${a.avoidedPct.toFixed(1)}%</b></span>` : null}
            </div>`)}
          </div>` : null}

          <div class="dsec">
            <h3>Top holders ${d.holders ? html`<small>${d.holders.length}</small>` : null}</h3>
            ${!d.holders ? html`<div class="empty">loading holders…</div>` : html`<table class="holders">
              <thead><tr><th>wallet</th><th>role</th><th class="num">bought</th><th class="num">sold</th><th class="num">held</th></tr></thead>
              <tbody>
                ${d.holders.map((x) => html`<tr>
                  <td><a class="mono" href=${solscanAcct(x.wallet)} target="_blank" rel="noopener">${short(x.wallet)}</a></td>
                  <td><span class=${cx("role", "role-" + (ROLE_ORDER.includes(x.role) ? x.role : "trader"))}>${x.role}</span></td>
                  <td class="num mono">${fmtNum(x.bought)}</td>
                  <td class="num mono ${x.sold > 0 ? "r" : "dim"}">${fmtNum(x.sold)}</td>
                  <td class="num mono"><div class="held"><span class="hbar"><i style=${{ width: `${Math.min(100, x.heldPct * 4)}%` }}></i></span>${fmtPct(x.heldPct)}</div></td>
                </tr>`)}
              </tbody>
            </table>`}
          </div>
        </div>` : html`<div class="empty">Loading…</div>`}

      <div class="dfoot">
        <button class=${cx("btn", armed ? "ghost" : "accent")} disabled=${armed || store.pending.has("arm:" + mint)} onClick=${() => actions.arm(mint)}>
          ${armed ? "◉ Tripwire armed" : "Arm tripwire"}
        </button>
        <button class="btn danger" disabled=${store.pending.has("exit:" + mint)} onClick=${() => actions.exit(mint)}>Exit now</button>
        <span class="spacer"></span>
        <a class="btn ghost" href=${solscanToken(mint)} target="_blank" rel="noopener">Solscan ↗</a>
        <a class="btn ghost" href=${pumpUrl(mint)} target="_blank" rel="noopener">pump.fun ↗</a>
      </div>
    </aside>
  </div>`;
}

function Toasts() {
  return html`<div class="toasts">${store.toasts.map((t) => html`<div key=${t.id} class=${cx("toast", t.kind)}>${t.msg}</div>`)}</div>`;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
function App() {
  const [, force] = useState(0);
  useEffect(() => {
    rerender = () => force((x) => x + 1);
    const onKey = (e) => {
      if (e.key === "Escape" && store.openMint) { store.openMint = null; bump(); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  const v = store.version;
  const launches = useMemo(() => [...store.launches.values()].sort((a, b) => b.createdAt - a.createdAt), [v]);
  return html`<div class=${cx("app", store.conn)}>
    <${TopBar} />
    <${Hero} />
    <main class="grid">
      <${LaunchRadar} launches=${launches} />
      <${Tripwires} />
      <${Alerts} />
    </main>
    <div class="bottom">
      <${Exits} />
      <${Health} />
    </div>
    ${store.openMint ? html`<${Drawer} key=${store.openMint} mint=${store.openMint} />` : null}
    <${Toasts} />
  </div>`;
}

render(html`<${App} />`, document.getElementById("root"));
