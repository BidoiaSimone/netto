// ---- config ----
const API = "";            // same origin; use "/api" if you ever mount the routers under a prefix
const REFRESH_MS = 10000;  // auto refresh interval (Yahoo calls are slow, so not too short)

const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const $ = (id) => document.getElementById(id);

let accounts = [];      // [{ name, amount, open_date }]
let transactions = [];  // [{ id, from_account, to_account, type, amount, description, date }]

// ---- helpers ----
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || res.statusText);
  return data;
}

function showError(msg) {
  $("error").textContent = msg;
}

// Replace a table body with rows; toCells(row) returns text values or DOM nodes
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

// Rebuild a <select>'s options (list of strings) while keeping the current choice
function setOptions(select, names, blankLabel) {
  const current = select.value;
  select.replaceChildren(new Option(blankLabel, ""));
  for (const name of names) select.append(new Option(name, name));
  select.value = current;
}

// Run a write action, then refresh everything
async function run(action) {
  try {
    await action();
    await loadAll();
  } catch (err) {
    showError(err.message);
  }
}

// ---- loaders (each may return a warning string) ----
async function loadNetWorth() {
  const data = await api("/net-worth");
  $("net-worth-value").textContent = eur.format(data.net_worth);
  if (data.failed_tickers?.length) {
    return `No live price for ${data.failed_tickers.join(", ")}: not included in net worth`;
  }
}

async function loadAccounts() {
  accounts = await api("/accounts");
  fill("accounts-body", accounts, (a) => [a.name, eur.format(a.amount), a.open_date]);

  const names = accounts.map((a) => a.name);
  setOptions($("account-select"), names, "All accounts");
  setOptions($("tx-from"), names, "— from —");
  setOptions($("tx-to"), names, "— to —");
}

function renderTransactions() {
  const selected = $("account-select").value;
  const rows = selected
    ? transactions.filter((t) => t.from_account === selected || t.to_account === selected)
    : transactions;

  fill("transactions-body", [...rows].reverse(), (t) => [ // newest first
    t.date, t.type, t.from_account, t.to_account, eur.format(t.amount), t.description,
  ]);
}

async function loadTransactions() {
  transactions = await api("/transactions");
  renderTransactions();
}

async function loadInvestments() {
  const rows = await api("/investments");
  fill("investments-body", rows, (i) => {
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.onclick = () => {
      if (confirm(`Delete ${i.ticker}?`)) {
        run(() => api(`/investments/${encodeURIComponent(i.ticker)}`, { method: "DELETE" }));
      }
    };

    const live = !i.price_error;
    return [
      i.ticker,
      i.shares,
      eur.format(i.average_purchase_price),
      eur.format(i.amount_invested),
      live ? eur.format(i.current_value) : "n/a",
      live ? eur.format(i.gain) : "n/a",
      live && i.gain_pct != null ? i.gain_pct.toFixed(2) + "%" : "n/a",
      del,
    ];
  });
}

async function loadAll() {
  const results = await Promise.allSettled([
    loadNetWorth(),
    loadAccounts().then(loadTransactions), // transactions render account names
    loadInvestments(),
  ]);

  const messages = results
    .map((r) => (r.status === "rejected" ? r.reason.message : r.value))
    .filter(Boolean);
  showError(messages.join(" · "));
}

// ---- forms ----
function onSubmit(formId, build) {
  $(formId).addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form)); // disabled fields are omitted
    const [path, body] = build(data);
    run(async () => {
      await api(path, { method: "POST", body });
      form.reset();
    });
  });
}

onSubmit("account-form", (d) => ["/accounts", { name: d.name.trim(), amount: Number(d.amount) }]);

onSubmit("tx-form", (d) => ["/transactions", {
  type: d.type,
  amount: Number(d.amount),
  from_account: d.from_account || null,
  to_account: d.to_account || null,
  description: d.description || null,
}]);

onSubmit("inv-form", (d) => ["/investments", {
  ticker: d.ticker,
  shares: Number(d.shares),
  average_purchase_price: Number(d.average_purchase_price),
  // amount_invested is computed by the server (shares x average price)
}]);

// Income only has a destination, expense only a source, movement has both
function syncTxFields() {
  const type = $("tx-type").value;
  $("tx-from").disabled = type === "income";
  $("tx-to").disabled = type === "expense";
  $("tx-from").required = type !== "income";  // browser blocks submit if a needed account is empty
  $("tx-to").required = type !== "expense";
}
$("tx-type").addEventListener("change", syncTxFields);
$("tx-form").addEventListener("reset", () => setTimeout(syncTxFields));

$("account-select").addEventListener("change", renderTransactions);

// ---- auto refresh (reloads data, not the page, so forms keep their input) ----
let timer = null;
const toggle = $("refreshToggle");

function setAutoRefresh(on) {
  clearInterval(timer);
  timer = on ? setInterval(loadAll, REFRESH_MS) : null;
  toggle.textContent = `Auto Refresh: ${on ? "ON" : "OFF"}`;
  localStorage.setItem("autoRefresh", on ? "on" : "off");
}

toggle.addEventListener("click", () => setAutoRefresh(timer === null));

// ---- init ----
syncTxFields();
setAutoRefresh(localStorage.getItem("autoRefresh") === "on");
loadAll();
