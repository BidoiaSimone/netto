// ---- config ----
const API = "";
const REFRESH_MS = 10000;
const STALE_DAYS = 30; // an account not recounted for this long is flagged on Home

const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const $ = (id) => document.getElementById(id);

// ---- small UI helpers ----
const todayStr = () => new Date().toLocaleDateString("sv-SE"); // local YYYY-MM-DD
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const badge = (type) => el("span", `badge ${type}`, type);

// Green for money in, red for money out, plain for movements
function amountCell(t) {
  const sign = t.type === "income" || (t.type === "adjustment" && t.to_account) ? 1
             : t.type === "expense" || t.type === "adjustment" ? -1 : 0;
  return el("span", sign > 0 ? "pos" : sign < 0 ? "neg" : "", (sign > 0 ? "+" : sign < 0 ? "−" : "") + eur.format(t.amount));
}

// Count up (or down) to a new value instead of jumping
function animateNumber(node, to) {
  const from = node._v ?? 0, start = performance.now();
  node._v = to;
  (function frame(now) {
    const p = Math.min((now - start) / 700, 1);
    node.textContent = eur.format(from + (to - from) * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(frame);
  })(start);
}

let accounts = [], transactions = [], categories = [], netWorth = null;
let counted = {}; // recount inputs by account name, kept across auto refreshes

// ---- helpers ----
async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Network error (Safari says "Load failed", Firefox "NetworkError..."): the server isn't running
    throw new Error("Can't reach netto's server. If this doesn't go away in a few seconds, check it with: bash scripts/service.sh log");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error) || res.statusText);
    err.status = res.status;
    err.data = data; // the whole answer, e.g. merge_into when a rename hits an existing category
    throw err;
  }
  return data;
}

const showError = (msg) => { $("error").textContent = msg; };

// Fill a table body; toCells(row) returns text values or DOM nodes
function fill(tbodyId, rows, toCells) {
  const tbody = $(tbodyId);
  tbody.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const cell of toCells(row)) {
      const td = document.createElement("td");
      if (cell instanceof Node) td.append(cell);
      else td.textContent = cell ?? "";
      tr.append(td);
    }
    tbody.append(tr);
  }
}

// items: [{ value, label }]. The value is what the form sends (e.g. an account id), the label what you see.
function setOptions(select, items, blankLabel) {
  const current = select.value;
  select.replaceChildren(new Option(blankLabel, ""));
  for (const it of items) select.append(new Option(it.label, it.value));
  select.value = current;
}

async function run(action) {
  try { await action(); await loadAll(); } catch (err) { showError(err.message); }
}

// ---- sidebar navigation (hash routing: #home, #assets, ...) ----
const pages = [...document.querySelectorAll("[data-page]")];

function route() {
  const wanted = location.hash.slice(1);
  const page = pages.some((p) => p.dataset.page === wanted) ? wanted : "home";
  pages.forEach((p) => { p.hidden = p.dataset.page !== page; });
  document.querySelectorAll("#sidebar a").forEach((a) => a.classList.toggle("active", a.hash === "#" + page));
}
window.addEventListener("hashchange", route);

// ---- loaders (may return a warning string) ----
async function loadNetWorth() {
  netWorth = await api("/net-worth");
  for (const id of ["net-worth-value", "h-net"]) animateNumber($(id), netWorth.net_worth);
  animateNumber($("h-acc"), netWorth.accounts_value);
  animateNumber($("h-inv"), netWorth.investments_value);

  const a = Math.max(0, netWorth.accounts_value), i = Math.max(0, netWorth.investments_value);
  $("bar-acc").style.width = a + i ? (a / (a + i)) * 100 + "%" : "0%";
  $("bar-inv").style.width = a + i ? (i / (a + i)) * 100 + "%" : "0%";
  updateRecount();
  if (netWorth.failed_tickers?.length) {
    return `No live price for ${netWorth.failed_tickers.join(", ")}: not included in net worth`;
  }
}

async function loadAccounts() {
  accounts = await api("/accounts");
  renderAssets();

  // option values are account ids: the API identifies accounts by id, so a rename can't break anything
  const items = accounts.map((a) => ({ value: a.id, label: a.name }));
  setOptions($("account-select"), items, "All accounts");
  setOptions($("tx-from"), items, "— from —");
  setOptions($("tx-to"), items, "— to —");

  const limit = Date.now() - STALE_DAYS * 864e5;
  const stale = accounts.filter((a) => !a.last_reconciled || Date.parse(a.last_reconciled) < limit);
  $("stale").textContent = stale.length
    ? `Not recounted in ${STALE_DAYS}+ days: ${stale.map((a) => `${a.name} (${a.last_reconciled ?? "never"})`).join(", ")}`
    : "";
}

async function loadTransactions() {
  transactions = await api("/transactions");
  renderTransactions();
  renderRecent();
  renderInsights();
}

// The category list feeds the Categories page, the transaction form and the category filter
async function loadCategories() {
  categories = await api("/categories");
  renderCategories();

  const pick = $("tx-category"), current = pick.value; // the value is the category id
  pick.replaceChildren(new Option("— no category —", ""), ...categories.map((c) => new Option(c.name, c.id)));
  pick.value = current;

  const filter = $("f-category"), wanted = filter.value; // the filter matches by name
  filter.replaceChildren(new Option("All categories", ""), ...categories.map((c) => new Option(c.name, c.name)),
    new Option("Uncategorized", "__none"));
  filter.value = wanted;
}

async function loadInvestments() {
  const rows = await api("/investments");
  fill("investments-body", rows, (i) => {
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.onclick = () => {
      if (confirm(`Delete ${i.ticker}?`)) run(() => api(`/investments/${encodeURIComponent(i.ticker)}`, { method: "DELETE" }));
    };
    const live = !i.price_error;
    return [
      i.ticker, i.shares, eur.format(i.average_purchase_price), eur.format(i.amount_invested),
      live ? eur.format(i.current_value) : "n/a",
      live ? el("span", i.gain >= 0 ? "pos" : "neg", eur.format(i.gain)) : "n/a",
      live && i.gain_pct != null ? el("span", i.gain >= 0 ? "pos" : "neg", i.gain_pct.toFixed(2) + "%") : "n/a",
      del,
    ];
  });
  invRows = rows;
  renderInvestmentSummary(rows);
  loadInvestmentHistory(rows);
}

// ---- investments charts ----
const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + eur.format(Math.abs(n));
const eur0 = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const signed0 = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + eur0.format(Math.abs(n));
const signedPct = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(1) + "%";
const shortDate = (d, withYear) =>
  new Date(d + "T00:00").toLocaleDateString("it-IT", withYear ? { day: "numeric", month: "short", year: "2-digit" } : { day: "numeric", month: "short" });

let invRange = localStorage.getItem("invRange") || "1y";
let invRows = [], invHistory = null, invHistoryKey = null;
let invTicker = localStorage.getItem("invTicker"); // which fund the line chart shows

function renderInvestmentSummary(rows) {
  const live = rows.filter((i) => !i.price_error);
  const invested = rows.reduce((s, i) => s + i.amount_invested, 0);
  const value = live.reduce((s, i) => s + i.current_value, 0);
  const gain = live.reduce((s, i) => s + i.gain, 0);
  const liveInvested = live.reduce((s, i) => s + i.amount_invested, 0);

  animateNumber($("inv-value"), value);
  animateNumber($("inv-invested"), invested);
  const g = $("inv-gain");
  g.textContent = signed(gain);
  g.className = gain >= 0 ? "pos" : "neg";
  const p = $("inv-gain-pct");
  p.textContent = liveInvested ? signedPct((gain / liveInvested) * 100) : "";
  p.className = gain >= 0 ? "pos" : "neg";

  // Allocation: share of current value, biggest first
  const alloc = live.filter((i) => i.current_value > 0).sort((a, b) => b.current_value - a.current_value);
  drawBars("inv-alloc", alloc.map((i) => ({
    name: i.ticker, value: i.current_value, tone: "share",
    label: `${((i.current_value / value) * 100).toFixed(1)}% · ${eur0.format(i.current_value)}`,
  })));

  drawBars("inv-gains", live.map((i) => ({ name: i.ticker, value: i.gain, label: `${signed0(i.gain)} · ${signedPct(i.gain_pct ?? 0)}` })));
}

// Bar rows: name | track | value label. Each item: { name, value, label }.
// Bars grow right from a zero line (left for negatives); the zero line sits where the data needs it,
// so an all-positive chart uses the full width.
function drawBars(id, items, { sort = true } = {}) {
  const box = $(id);
  if (!items.length) return box.replaceChildren(el("p", "chart-empty", "No data yet"));
  const posMax = Math.max(0, ...items.map((it) => it.value));
  const negMax = Math.max(0, ...items.map((it) => -it.value));
  const span = posMax + negMax || 1;
  const zero = (negMax / span) * 100;
  const rows = sort ? [...items].sort((a, b) => b.value - a.value) : items;
  box.replaceChildren(...rows.map((it) => {
    const row = el("div", "hbar");
    const track = el("div", "track");
    if (negMax > 0) {
      const axis = el("span", "zero");
      axis.style.left = zero + "%";
      track.append(axis);
    }
    const fill = el("span", "fill " + (it.tone ?? (it.value >= 0 ? "pos" : "neg")));
    const w = (Math.abs(it.value) / span) * 100;
    fill.style.left = (it.value >= 0 ? zero : zero - w) + "%";
    fill.style.width = w + "%";
    track.append(fill);
    const cells = [el("span", "name", it.name), track, el("span", "val", it.label)];
    cells.forEach((c) => (c.title = `${it.name}: ${it.label}`));
    row.append(...cells);
    return row;
  }));
}

// History is slow (one download per ticker), so it is only fetched when the range or the holdings change
async function loadInvestmentHistory(rows, force) {
  const key = invRange + JSON.stringify(rows.map((r) => [r.ticker, r.shares, r.amount_invested]));
  if (!force && key === invHistoryKey) return;
  invHistoryKey = key;
  document.querySelectorAll("[data-inv-range]").forEach((b) => b.classList.toggle("active", b.dataset.invRange === invRange));
  if (!rows.length) { invHistory = null; return renderInvestmentHistory(); }

  $("inv-line").replaceChildren(el("p", "chart-empty", "Loading price history…"));
  try {
    const data = await api(`/investments/history?range=${invRange}`);
    if (key !== invHistoryKey) return; // the range changed while loading
    invHistory = data;
  } catch (err) {
    invHistory = null;
    invHistoryKey = null; // retry on the next refresh
    $("inv-line").replaceChildren(el("p", "chart-empty", "Price history unavailable: " + err.message));
    return;
  }
  renderInvestmentHistory();
}

function renderInvestmentHistory() {
  const h = invHistory;
  const labels = { "1m": "1 month", "6m": "6 months", "1y": "1 year", "5y": "5 years" };
  $("inv-period-title").textContent = `Change over ${labels[invRange]}`;
  const sum = $("inv-period-summary");

  const list = h?.holdings ?? [];
  if (!list.some((x) => x.ticker === invTicker)) invTicker = list[0]?.ticker ?? null;
  $("inv-tickers").replaceChildren(...list.map((x) => {
    const b = el("button", "ghost" + (x.ticker === invTicker ? " active" : ""), x.ticker);
    b.type = "button";
    b.onclick = () => { invTicker = x.ticker; localStorage.setItem("invTicker", invTicker); renderInvestmentHistory(); };
    return b;
  }));

  const fund = list.find((x) => x.ticker === invTicker);
  if (!fund || fund.prices.length < 2) {
    sum.textContent = h?.failed_tickers?.length ? `No price history for ${h.failed_tickers.join(", ")}` : "";
    $("inv-line").replaceChildren(el("p", "chart-empty", h ? "Not enough price history for this range" : "Add an investment to see how it's doing"));
    drawBars("inv-period", []);
    return;
  }

  const last = fund.prices[fund.prices.length - 1];
  sum.replaceChildren(el("strong", "", eur.format(last)),
    el("span", fund.change_pct >= 0 ? "pos" : "neg", signedPct(fund.change_pct)),
    document.createTextNode(` over ${labels[invRange]}`));
  if (h.failed_tickers.length) sum.append(document.createTextNode(` · no history for ${h.failed_tickers.join(", ")}`));

  drawLineChart($("inv-line"), fund.dates, fund.prices, fund.average_purchase_price, "Your avg price");
  drawBars("inv-period", list.map((x) => ({ name: x.ticker, value: x.change_pct, label: `${signedPct(x.change_pct)} · ${signed0(x.change)}` })));
}

// Single-series line with a dashed reference line (e.g. your average price) and a hover crosshair
function drawLineChart(box, dates, values, reference, refName) {
  const W = box.clientWidth || 600, H = box.clientHeight || 260;
  const m = { top: 12, right: 16, bottom: 24, left: 64 };
  const lo0 = Math.min(...values, reference), hi0 = Math.max(...values, reference);
  // round axis steps (1, 2, 2.5 or 5 × 10^n) so the labels read 8.500 €, 9.000 € ...
  const raw = (hi0 - lo0 || hi0 * 0.1 || 1) / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((st) => st >= raw);
  const lo = Math.floor(lo0 / step) * step, hi = Math.ceil(hi0 / step) * step;
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const axisFmt = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const x = (i) => m.left + (i / (values.length - 1)) * (W - m.left - m.right);
  const y = (v) => m.top + (1 - (v - lo) / (hi - lo)) * (H - m.top - m.bottom);

  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Price over time" });
  svg.innerHTML = `<defs><linearGradient id="inv-fill" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#22c55e" stop-opacity="0.22"/><stop offset="1" stop-color="#22c55e" stop-opacity="0"/></linearGradient></defs>`;

  // y grid + labels
  for (let v = lo; v <= hi + step / 2; v += step) {
    svg.append(svgEl("line", { class: "grid", x1: m.left, x2: W - m.right, y1: y(v), y2: y(v) }));
    const t = svgEl("text", { class: "axis", x: m.left - 8, y: y(v) + 4, "text-anchor": "end" });
    t.textContent = axisFmt.format(v);
    svg.append(t);
  }
  // x labels: first, middle, last
  const withYear = dates[0].slice(0, 4) !== dates[dates.length - 1].slice(0, 4);
  [[0, "start"], [Math.floor((dates.length - 1) / 2), "middle"], [dates.length - 1, "end"]].forEach(([i, anchor]) => {
    const t = svgEl("text", { class: "axis", x: x(i), y: H - 6, "text-anchor": anchor });
    t.textContent = shortDate(dates[i], withYear);
    svg.append(t);
  });

  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  svg.append(svgEl("path", { class: "area", d: `M${pts.join("L")}L${x(values.length - 1)},${H - m.bottom}L${m.left},${H - m.bottom}Z` }));
  svg.append(svgEl("line", { class: "ref", x1: m.left, x2: W - m.right, y1: y(reference), y2: y(reference) }));
  // label at the right end, on the side of the dashed line the data is NOT on at the end
  // (and always inside the plot, so it never sits on the date labels)
  let below = values[values.length - 1] >= reference;
  if (below && y(reference) + 15 > H - m.bottom - 2) below = false;
  if (!below && y(reference) - 7 < m.top + 10) below = true;
  const refLabel = svgEl("text", { class: "ref-label", x: W - m.right - 4, y: y(reference) + (below ? 15 : -7), "text-anchor": "end" });
  refLabel.textContent = `${refName} ${eur.format(reference)}`;
  svg.append(refLabel);
  svg.append(svgEl("path", { class: "line", d: `M${pts.join("L")}` }));

  // hover layer
  const cross = svgEl("line", { class: "cross", y1: m.top, y2: H - m.bottom, visibility: "hidden" });
  const dot = svgEl("circle", { class: "hover-dot", r: 5, visibility: "hidden" });
  const hit = svgEl("rect", { x: m.left, y: 0, width: W - m.left - m.right, height: H, fill: "transparent" });
  svg.append(cross, dot, hit);
  const tip = el("div", "tip");
  tip.hidden = true;

  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(values.length - 1, Math.round(((px - m.left) / (W - m.left - m.right)) * (values.length - 1))));
    const cx = x(i), cy = y(values[i]);
    for (const a of [cross, dot]) a.setAttribute("visibility", "visible");
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx);
    dot.setAttribute("cx", cx); dot.setAttribute("cy", cy);
    const vsInv = values[i] - reference;
    tip.replaceChildren(document.createTextNode(shortDate(dates[i], true)), el("strong", "", eur.format(values[i])),
      el("span", vsInv >= 0 ? "pos" : "neg", `${signedPct((vsInv / reference) * 100)} vs ${refName.toLowerCase()}`));
    tip.hidden = false;
    const left = (cx / W) * r.width;
    tip.style.left = Math.min(left + 12, r.width - tip.offsetWidth) + "px";
    if (left + 12 + tip.offsetWidth > r.width) tip.style.left = Math.max(0, left - tip.offsetWidth - 12) + "px";
    tip.style.top = Math.max(0, (cy / H) * r.height - tip.offsetHeight - 10) + "px";
  };
  const hide = () => { tip.hidden = true; for (const a of [cross, dot]) a.setAttribute("visibility", "hidden"); };
  hit.addEventListener("pointermove", (e) => show(e.clientX));
  hit.addEventListener("pointerdown", (e) => show(e.clientX));
  hit.addEventListener("pointerleave", hide);

  box.replaceChildren(svg, tip);
}

document.querySelectorAll("[data-inv-range]").forEach((b) => b.addEventListener("click", () => {
  invRange = b.dataset.invRange;
  localStorage.setItem("invRange", invRange);
  loadInvestmentHistory(invRows);
}));

// The line chart is drawn at the real pixel size, so redraw it when the window (or the page) changes size
let resizeTimer;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => invHistory && renderInvestmentHistory(), 150); });
window.addEventListener("hashchange", () => { if (location.hash === "#investments" && invHistory) setTimeout(renderInvestmentHistory); });

async function loadAll() {
  const results = await Promise.allSettled([
    loadNetWorth(),
    loadAccounts().then(loadTransactions),
    loadCategories(),
    loadInvestments()
  ]);
  showError(results.map((r) => (r.status === "rejected" ? r.reason.message : r.value)).filter(Boolean).join(" · "));
}


// ---- renderers ----
const diffCells = new Map(); // account name -> difference <td>

function renderAssets() {
  diffCells.clear();
  fill("assets-body", accounts, (a) => {
    const input = document.createElement("input");
    input.type = "number"; input.step = "0.01"; input.placeholder = "unchanged";
    input.value = counted[a.name] ?? "";
    input.oninput = () => { counted[a.name] = input.value; updateRecount(); };

    const diff = document.createElement("span");
    diffCells.set(a.name, diff);
    return [a.name, a.kind, eur.format(a.balance), a.last_reconciled ?? "never", input, diff];
  });
  [...$("assets-body").rows].forEach((tr, i) => { tr.dataset.name = accounts[i].name; });
  updateRecount();
  renderAssetsPie();
}

// ---- assets pie (SVG drawn here) ----
// One color per account, picked by its position in the accounts list (= the order you created them),
// so an account keeps its color when amounts change. Colors checked for color-blind separation on this dark background.
const PIE_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const PIE_OTHER = "#5b6b62";

function renderAssetsPie() {
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  animateNumber($("assets-total"), total);

  // A pie can only show positive parts; anything at zero or below is listed in a note instead
  let slices = accounts
    .map((a, i) => ({ name: a.name, value: a.balance, color: PIE_COLORS[i] }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  // More than 8 accounts: keep the 7 biggest and fold the rest into "Other" (never invent a 9th color)
  if (slices.length > PIE_COLORS.length) {
    const rest = slices.slice(PIE_COLORS.length - 1);
    slices = slices.slice(0, PIE_COLORS.length - 1);
    slices.push({ name: `Other (${rest.length})`, value: rest.reduce((s, x) => s + x.value, 0), color: PIE_OTHER, members: rest.map((x) => x.name) });
  }
  // a color is reused only if an account past the 8th made it into the top 7: give those the free colors
  const used = new Set(slices.map((s) => s.color).filter(Boolean));
  const free = PIE_COLORS.filter((c) => !used.has(c));
  slices.forEach((s) => { if (!s.color) s.color = free.shift(); });

  const positive = slices.reduce((s, x) => s + x.value, 0);
  const left = accounts.filter((a) => a.balance <= 0);
  $("assets-pie-note").textContent = left.length
    ? `Not in the chart (zero or negative): ${left.map((a) => `${a.name} ${eur.format(a.balance)}`).join(", ")}`
    : "";

  const box = $("assets-pie");
  if (!slices.length) {
    $("assets-legend").replaceChildren();
    return box.replaceChildren(el("p", "chart-empty", "Add an account to see how your assets are split"));
  }

  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const C = 100, R = 96; // viewBox 200×200
  const pt = (angle) => `${(C + R * Math.cos(angle)).toFixed(2)},${(C + R * Math.sin(angle)).toFixed(2)}`;
  const svg = svgEl("svg", { viewBox: "0 0 200 200", role: "img", "aria-label": "How your assets are split" });

  const tip = el("div", "tip");
  tip.hidden = true;
  const marks = []; // [{ slice, path, legendRow }]

  let angle = -Math.PI / 2; // start at 12 o'clock, go clockwise
  for (const s of slices) {
    const sweep = (s.value / positive) * Math.PI * 2;
    const path = slices.length === 1
      ? svgEl("circle", { cx: C, cy: C, r: R })
      : svgEl("path", { d: `M${C},${C}L${pt(angle)}A${R},${R} 0 ${sweep > Math.PI ? 1 : 0} 1 ${pt(angle + sweep)}Z` });
    path.setAttribute("class", "slice");
    path.setAttribute("fill", s.color);
    s.mid = angle + sweep / 2;
    s.pct = (s.value / positive) * 100;
    angle += sweep;
    svg.append(path);

    const row = el("li");
    const sw = el("i", "swatch");
    sw.style.background = s.color;
    row.append(sw, el("span", "name", s.name), el("span", "pct", s.pct.toFixed(1) + "%"), el("span", "val", eur.format(s.value)));
    marks.push({ s, path, row });
  }

  // Hover a slice or a legend row: that part lights up (and its row in the list on the right)
  const focus = (m) => {
    for (const x of marks) {
      const on = x === m;
      x.path.classList.toggle("dim", !!m && !on);
      x.row.classList.toggle("on", on);
    }
    const names = m ? (m.s.members ?? [m.s.name]) : [];
    for (const tr of $("assets-body").rows) tr.classList.toggle("hl", names.includes(tr.dataset.name));
    if (!m) { tip.hidden = true; return; }
    tip.replaceChildren(document.createTextNode(m.s.name), el("strong", "", eur.format(m.s.value)), document.createTextNode(`${m.s.pct.toFixed(1)}% of the chart`));
    tip.hidden = false;
    // place the tip just outside the middle of the slice
    const r = box.getBoundingClientRect(), scale = r.width / 200;
    const x = (C + R * 0.6 * Math.cos(m.s.mid)) * scale, y = (C + R * 0.6 * Math.sin(m.s.mid)) * scale;
    tip.style.left = Math.max(0, Math.min(x - tip.offsetWidth / 2, r.width - tip.offsetWidth)) + "px";
    tip.style.top = Math.max(0, y - tip.offsetHeight - 8) + "px";
  };
  for (const m of marks) {
    for (const node of [m.path, m.row]) {
      node.addEventListener("pointerenter", () => focus(m));
      node.addEventListener("pointerleave", () => focus(null));
    }
  }

  box.replaceChildren(svg, tip);
  $("assets-legend").replaceChildren(...marks.map((m) => m.row));
}

// Live feedback: difference per account and the net worth you'd get after applying
function updateRecount() {
  let delta = 0;
  for (const a of accounts) {
    const v = counted[a.name];
    const cell = diffCells.get(a.name);
    // rounded to the cent: subtracting two euro floats can leave noise like 0.0000001
    const d = v === undefined || v === "" ? null : Math.round((Number(v) - a.balance) * 100) / 100;
    if (d !== null) delta += d;
    if (cell) {
      cell.textContent = d === null ? "" : (d > 0 ? "+" : "") + eur.format(d);
      cell.className = d > 0 ? "pos" : d < 0 ? "neg" : "";
    }
  }
  $("recount-summary").textContent = netWorth
    ? `Net worth now ${eur.format(netWorth.net_worth)} → after recount ${eur.format(netWorth.net_worth + delta)} (${delta >= 0 ? "+" : ""}${eur.format(delta)})`
    : "";
}

// ---- categories page ----
// Each name is an input: edit it and press Enter (or click away) to rename.
function renderCategories() {
  // an auto refresh must not wipe a name you are in the middle of typing
  if (document.activeElement?.closest("#categories-body")) return;

  fill("categories-body", categories, (c) => {
    const input = el("input");
    input.value = c.name;
    input.setAttribute("aria-label", "Category name");
    input.addEventListener("change", () => {
      const name = input.value.trim();
      if (!name || name === c.name) { input.value = c.name; return; }
      renameCategory(c, name);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur(); // blur fires "change"
      if (e.key === "Escape") { input.value = c.name; input.blur(); }
    });

    const del = el("button", "", "Delete");
    del.type = "button";
    del.onclick = () => {
      const msg = c.used
        ? `Delete "${c.name}"? Its ${plural(c.used, "transaction")} will become uncategorized.`
        : `Delete "${c.name}"?`;
      if (confirm(msg)) run(() => api(`/categories/${c.id}`, { method: "DELETE" }));
    };

    return [input, c.used ? plural(c.used, "transaction") : "not used yet", del];
  });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// If the new name already exists, the server answers 409 + merge_into: ask, then merge
function renameCategory(c, name) {
  run(async () => {
    try {
      await api(`/categories/${c.id}`, { method: "PUT", body: { name } });
    } catch (err) {
      const target = err.data?.merge_into;
      if (!target) throw err;
      const moving = c.used ? ` Its ${plural(c.used, "transaction")} will move to "${target.name}".` : "";
      if (!confirm(`"${target.name}" already exists. Merge "${c.name}" into it?${moving}`)) return; // the reload puts the old name back
      await api(`/categories/${c.id}`, { method: "PUT", body: { name, merge: true } });
    }
  });
}

// ---- transaction filters (all client-side, so they apply instantly) ----
function filteredTransactions() {
  const q = $("f-search").value.trim().toLowerCase();
  const acc = $("account-select").value, type = $("f-type").value, cat = $("f-category").value;
  const from = $("f-from").value, to = $("f-to").value;
  const min = $("f-min").value === "" ? null : Number($("f-min").value);
  const max = $("f-max").value === "" ? null : Number($("f-max").value);

  return transactions.filter((t) =>
    (!acc || t.from_account_id === Number(acc) || t.to_account_id === Number(acc)) &&
    (!type || t.type === type) &&
    (!cat || (cat === "__none" ? !t.category : t.category === cat)) &&
    (!from || t.date >= from) && (!to || t.date <= to) &&
    (min === null || t.amount >= min) && (max === null || t.amount <= max) &&
    (!q || `${t.description ?? ""} ${t.category ?? ""}`.toLowerCase().includes(q))
  );
}

function renderTransactions() {
  const rows = filteredTransactions();
  fill("transactions-body", rows, (t) => [
    t.date, badge(t.type), t.from_account, t.to_account, amountCell(t), t.category, t.description,
  ]);

  const sum = (type) => rows.filter((t) => t.type === type).reduce((n, t) => n + t.amount, 0);
  $("tx-summary").textContent =
    `${rows.length} of ${transactions.length} transactions · income ${eur.format(sum("income"))} · expenses ${eur.format(sum("expense"))}`;
}

const dateStr = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("sv-SE");
};

function renderRecent() {
  fill("recent-body", transactions.slice(0, 5), (t) => [t.date, badge(t.type), amountCell(t), t.description ?? t.category]);
}

function renderInsights() {
  const months = {}, cats = {};
  const thisMonth = todayStr().slice(0, 7);
  for (const t of transactions) { // movements and recount adjustments are not income/spending
    const m = t.date.slice(0, 7);
    const row = (months[m] ??= { income: 0, expense: 0 });
    if (t.type === "income") row.income += t.amount;
    if (t.type === "expense") {
      row.expense += t.amount;
      if (m === thisMonth) { const c = t.category || "Uncategorized"; cats[c] = (cats[c] ?? 0) + t.amount; }
    }
  }
  fill("months-body", Object.keys(months).sort().reverse().slice(0, 6), (m) => [
    m, eur.format(months[m].income), eur.format(months[m].expense), eur.format(months[m].income - months[m].expense),
  ]);
  fill("cats-body", Object.entries(cats).sort((a, b) => b[1] - a[1]), ([c, v]) => [c, eur.format(v)]);
}

// ---- forms ----
function onSubmit(formId, build) {
  $(formId).addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    const [path, body] = build(Object.fromEntries(new FormData(form)));
    run(async () => {
      await api(path, { method: "POST", body });
      form.reset();
      form.closest("dialog")?.close();
    });
  });
}

onSubmit("account-form", (d) => ["/accounts", { name: d.name, kind: d.kind, opening_balance: Number(d.opening_balance) }]);

onSubmit("category-form", (d) => ["/categories", { name: d.name }]);

onSubmit("tx-form", (d) => ["/transactions", {
  type: d.type, amount: Number(d.amount),
  from_account_id: d.from_account_id ? Number(d.from_account_id) : null,
  to_account_id: d.to_account_id ? Number(d.to_account_id) : null,
  date: d.date || null, // empty = the server uses today
  category_id: d.category_id ? Number(d.category_id) : null, description: d.description || null,
}]);

onSubmit("inv-form", (d) => ["/investments", {
  ticker: d.ticker, shares: Number(d.shares), average_purchase_price: Number(d.average_purchase_price),
}]);

$("recount-apply").onclick = () => run(async () => {
  for (const [name, v] of Object.entries(counted)) {
    const acc = accounts.find((a) => a.name === name);
    if (acc && v !== "") await api(`/accounts/${acc.id}/reconcile`, { method: "POST", body: { counted: Number(v) } });
  }
  counted = {};
});

// Income only has a destination, expense only a source, movement has both
function syncTxFields() {
  const type = $("tx-type").value;
  $("tx-from").disabled = type === "income";
  $("tx-to").disabled = type === "expense";
  $("tx-from").required = type !== "income";
  $("tx-to").required = type !== "expense";
}
// ---- privacy mode: blurs every amount except the transactions (see body.private in the CSS) ----
function setPrivacy(on) {
  document.body.classList.toggle("private", on);
  $("privacy-toggle").checked = on;
}
$("privacy-toggle").addEventListener("change", (e) => setPrivacy(e.target.checked));

// ---- dialogs: each "add" form opens from a button at the top right of its page ----
function openDialog(id) {
  showError("");
  if (id === "tx-dialog") { $("tx-date").value = $("tx-date").max = todayStr(); syncTxFields(); }
  const dialog = $(id);
  dialog.showModal();
  dialog.querySelector("[name=amount], [name=name], [name=ticker]")?.focus();
}
document.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openDialog(b.dataset.open)));
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
document.querySelectorAll("dialog").forEach((d) => {
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); }); // click outside
});

// shortcuts: N = new transaction, P = privacy mode
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.matches?.("input, select, textarea") || document.querySelector("dialog[open]")) return;
  if (e.key === "n") { e.preventDefault(); openDialog("tx-dialog"); }
  if (e.key === "p") { e.preventDefault(); setPrivacy(!document.body.classList.contains("private")); }
});

$("tx-type").addEventListener("change", syncTxFields);
$("tx-form").addEventListener("reset", () => setTimeout(syncTxFields));
document.querySelectorAll(".filters input, .filters select").forEach((el) => el.addEventListener("input", renderTransactions));

// quick date ranges
document.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => {
  const ranges = {
    today: [dateStr(), dateStr()],
    week: [dateStr(-6), dateStr()],
    month: [todayStr().slice(0, 8) + "01", dateStr()],
  };
  [$("f-from").value, $("f-to").value] = ranges[b.dataset.range];
  renderTransactions();
}));

$("f-reset").addEventListener("click", () => {
  document.querySelectorAll(".filters input, .filters select").forEach((el) => { el.value = ""; });
  renderTransactions();
});

// ---- to do list (stored in localStorage, client-side only) ----
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

function loadTodos() {
  let todos;
  try { todos = JSON.parse(localStorage.getItem("todoList")) ?? []; } catch { todos = []; }
  if (!Array.isArray(todos)) todos = [];
  // give old items (saved before ids existed) a stable id
  if (todos.some((t) => !t.id)) {
    todos = todos.map((t) => ({ ...t, id: t.id ?? newId() }));
    saveTodos(todos);
  }
  return todos;
}
const saveTodos = (todos) => localStorage.setItem("todoList", JSON.stringify(todos));

let justMoved = null; // id of the item to animate in on the next render

function todoItem(todo) {
  const li = el("li");
  if (todo.id === justMoved) li.classList.add("entering");
  const cb = el("input");
  cb.type = "checkbox";
  cb.checked = todo.done;
  cb.addEventListener("change", () => toggleTodo(todo.id, li));
  const label = el("label");
  label.append(cb, el("span", null, todo.text));
  const del = el("button", "todo-del", "×");
  del.title = "Delete";
  del.addEventListener("click", () => deleteTodo(todo.id, li));
  li.append(label, del);   // replaces li.append(label);
  return li;
}

function renderTodos() {
  const todos = loadTodos();
  $("todoList").replaceChildren(...todos.filter((t) => !t.done).map(todoItem));
  $("doneList").replaceChildren(...todos.filter((t) => t.done).map(todoItem));
  justMoved = null;
}

function toggleTodo(id, li) {
  const todos = loadTodos();
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;
  todo.done = !todo.done;
  saveTodos(todos);

  const moveIt = () => { justMoved = id; renderTodos(); };
  if (reducedMotion.matches) return moveIt();
  li.classList.add("leaving");
  li.addEventListener("animationend", moveIt, { once: true });
  renderTodos();
}

function deleteTodo(id, li) {
  saveTodos(loadTodos().filter((t) => t.id !== id));
  if (reducedMotion.matches) return renderTodos();
  li.classList.add("leaving");
  li.addEventListener("animationend", renderTodos, { once: true });
}

function addTodo() {
  const text = $("todoInput").value.trim();
  if (!text) return;
  const todos = loadTodos();
  todos.push({ id: newId(), text, done: false });
  justMoved = todos.at(-1).id;
  saveTodos(todos);
  $("todoInput").value = "";
  renderTodos();
}

$("todoAddBtn").addEventListener("click", addTodo);
$("todoInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addTodo(); });

// ---- auto refresh (reloads data, not the page) ----
let timer = null;
const toggle = $("refreshToggle");

function setAutoRefresh(on) {
  clearInterval(timer);
  timer = on ? setInterval(loadAll, REFRESH_MS) : null;
  toggle.textContent = `Auto Refresh: ${on ? "ON" : "OFF"}`;
  localStorage.setItem("autoRefresh", on ? "on" : "off");
}
toggle.addEventListener("click", () => setAutoRefresh(timer === null));

// ---- restore a backup made with "Download backup" ----
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // lets you pick the same file again later
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { return showError("That file is not valid JSON."); }
  const n = (k) => (Array.isArray(data[k]) ? data[k].length : 0);
  if (!confirm(`Replace ALL current data with this backup?\n\n${n("accounts")} accounts, ${n("investments")} investments, ${n("transactions")} transactions.\n\nA copy of the current data is saved first in backend/db/backups.`)) return;
  run(async () => {
    const r = await api("/import", { method: "POST", body: data });
    alert(`Backup restored: ${r.accounts} accounts, ${r.investments} investments, ${r.categories} categories, ${r.transactions} transactions.`);
  });
});

  // Tells the server this window is open; when every window is closed the server can stop (see app.js)
  new EventSource("/session");

  // ---- init ----
  setPrivacy(true); // always start hidden, so nobody sees amounts at launch
  syncTxFields();
  setAutoRefresh(localStorage.getItem("autoRefresh") === "on");
  route();
  renderTodos();
  loadAll();
