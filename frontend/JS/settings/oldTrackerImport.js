// ---- Settings > Import from the old tracker (CSV): the preview, then the import (routes/oldTrackerImportRoutes.js) ----
// Pick the file -> the server reads it and answers what it would do (nothing saved) -> this dialog shows it:
// the check against the old tracker's own totals, the new categories, every correction, the lines to look at
// (with a tick box each), how the history fits in front of today's balances, the car and the ETFs, and what each
// category cost a month. "Import" sends the same file again with the unticked lines; the server saves a copy of
// the database first.

import { elementById, createElement } from "../core/domHelpers.js";
import { euroFormatter, formatShortDate, formatSignedEuros } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { loadAllData } from "../core/dataRefresh.js";
import { showToast } from "../core/toast.js";

let csvText = "";
let excluded = new Set();
let plan = null;

const monthFormatter = new Intl.DateTimeFormat("en-GB", { month: "short" });
const formatPeriod = (from, to) => `${formatShortDate(from, true)} – ${formatShortDate(to, true)}`;
const section = (title, ...children) => {
  const part = createElement("section", "ot-section");
  part.append(createElement("h4", "", title), ...children);
  return part;
};
const paragraph = (...children) => {
  const element = createElement("p", "ot-text");
  element.append(...children);
  return element;
};
const strong = (text, className = "") => createElement("strong", className, text);

// "Food → Coffee" lines, and the flagged lines with a tick box
function createLineRow(line, withTickBox) {
  const row = createElement(withTickBox ? "label" : "li", "ot-line");
  if (withTickBox) {
    const tick = createElement("input");
    tick.type = "checkbox";
    tick.checked = !line.excluded;
    tick.addEventListener("change", () => {
      if (tick.checked) excluded.delete(line.key); else excluded.add(line.key);
      refreshPreview();
    });
    row.append(tick);
  }
  const what = line.type === "adjustment" ? "recount" : line.category;
  row.append(
    createElement("span", "ot-line-date", formatShortDate(line.date)),
    createElement("span", "ot-line-what", `${line.description || "(no description)"}`),
    createElement("span", "ot-line-amount", euroFormatter.format(line.amount)),
    createElement("span", "ot-line-change", withTickBox ? what : `${line.old_category} → ${what}`),
    createElement("small", "hint ot-line-why", withTickBox ? line.flag : line.correction),
  );
  return row;
}

// Per category: total over the period and the monthly average of its complete months
function createCategoryTable(lines, firstNettoDay) {
  const months = new Set(lines.map((line) => line.date.slice(0, 7)).filter((month) => month < firstNettoDay.slice(0, 7)));
  const totals = new Map();
  for (const line of lines.filter((candidate) => !candidate.excluded && candidate.type !== "adjustment")) {
    const key = `${line.type}:${line.category}`;
    const entry = totals.get(key) ?? { type: line.type, category: line.category, total: 0, inMonths: 0 };
    entry.total += line.amount;
    if (months.has(line.date.slice(0, 7))) entry.inMonths += line.amount;
    totals.set(key, entry);
  }
  const table = createElement("table", "ot-categories");
  table.innerHTML = `<thead><tr><th>Category</th><th>Total</th><th>A month</th></tr></thead>`;
  const body = createElement("tbody");
  for (const type of ["expense", "income"]) {
    const rows = [...totals.values()].filter((entry) => entry.type === type).sort((first, second) => second.total - first.total);
    for (const entry of rows) {
      const row = createElement("tr", type === "income" ? "ot-income" : "");
      row.append(createElement("td", "", entry.category), createElement("td", "", euroFormatter.format(entry.total)),
        createElement("td", "", months.size ? euroFormatter.format(entry.inMonths / months.size) : "–"));
      body.append(row);
    }
  }
  table.append(body);
  const scroller = createElement("div", "ot-scroll");
  scroller.append(table);
  const monthList = [...months].sort();
  return [scroller, createElement("p", "hint small",
    monthList.length ? `A month: the average of ${monthList.length} complete months (${monthFormatter.format(new Date(monthList[0] + "-15"))} – ${monthFormatter.format(new Date(monthList.at(-1) + "-15"))}). Goals suggest their baselines from these from now on.` : "")];
}

// How the history sits in front of today's balances
function createAccountsSection(history, firstNettoDay) {
  const steps = createElement("ul", "ot-steps");
  const step = (label, amount, signed = true) => {
    const item = createElement("li");
    item.append(createElement("span", "", label), createElement("span", "ot-step-amount", signed ? formatSignedEuros(amount) : euroFormatter.format(amount)));
    steps.append(item);
  };
  step(`${formatShortDate(history.opens, true)}: the old tracker's cash`, history.opening, false);
  step("income", history.income);
  step("spending", -history.spending);
  if (history.adjustments) step("its recalculations (as recounts)", history.adjustments);
  if (history.invested) step("put into the ETFs", -history.invested);
  if (history.moved_to_car) step("put into the car", -history.moved_to_car);
  step(`held on the day before netto`, history.before_hand_over, false);

  const handedOver = history.hand_overs.reduce((sum, handOver) => sum + handOver.amount, 0);
  const gap = paragraph(
    `On ${formatShortDate(firstNettoDay, true)} your netto accounts started with `, strong(euroFormatter.format(handedOver)), ": ",
    history.difference === 0 ? "exactly the same." : createElement("span", "", `${euroFormatter.format(Math.abs(history.difference))} ${history.difference < 0 ? "less" : "more"} than the old tracker held. That gap is saved as a recount on that day.`),
  );
  if (history.difference !== 0 && history.later_recounts) {
    const remaining = history.difference + history.later_recounts;
    gap.append(` In netto's first month you then recounted ${formatSignedEuros(history.later_recounts)} (${history.later_recount_accounts.join(", ")}), so overall the two trackers differ by ${euroFormatter.format(Math.abs(remaining))}.`);
  }
  const handOverList = history.hand_overs.map((handOver) => `${handOver.name} ${euroFormatter.format(handOver.amount)}`).join(", ");
  return section("Your balances",
    paragraph(`A closed account, `, strong(`"${history.name}"`), `, holds the history:`),
    steps, gap,
    paragraph(`Then it hands each account its opening balance (${handOverList}) and closes at 0 on ${formatShortDate(history.closes, true)}. `,
      strong("Every balance today stays exactly as it is."), " Those accounts now start at 0 and receive that money from it."),
  );
}

function createCarAndInvestments(car, investments) {
  const items = createElement("ul", "ot-list");
  if (car.applies) {
    const moved = car.moves.reduce((sum, move) => sum + move.amount, 0);
    items.append(createElement("li", "", `${car.account}: from ${euroFormatter.format(car.start_of_year)} on 1 Jan, + ${euroFormatter.format(moved)} put in on ${car.moves.map((move) => formatShortDate(move.date)).join(", ")} (${euroFormatter.format(car.start_of_year + moved)}, as now).`));
  } else if (car.moves.length) {
    items.append(createElement("li", "", `The car: left as it is (${car.reason}).`));
  }
  for (const investment of investments) {
    if (!investment.applies) {
      items.append(createElement("li", "hint", `${investment.ticker}: left as it is (${investment.reason}).`));
      continue;
    }
    const shares = investment.purchases.reduce((sum, purchase) => sum + purchase.shares, 0);
    const start = investment.openingShares ? `${investment.openingShares} shares on 1 Jan + ` : "";
    const when = investment.purchases.length === 1 ? formatShortDate(investment.purchases[0].date) : `${investment.purchases.length} purchases, ${formatShortDate(investment.purchases[0].date)} – ${formatShortDate(investment.purchases.at(-1).date)}`;
    items.append(createElement("li", "", `${investment.ticker}: ${start}${shares} bought (${when}), paid from "Old tracker". Cost ${euroFormatter.format(investment.cost)}, as now${investment.costNote ? ` (${investment.costNote})` : ""}.`));
  }
  return section("The car and the ETFs", items);
}

function renderPreview() {
  const box = elementById("old-tracker-preview");
  const button = elementById("old-tracker-import");
  const included = plan.lines.filter((line) => !line.excluded).length;
  button.textContent = `Import ${included} transactions`;
  button.disabled = !plan.canImport;

  const parts = [];
  if (plan.blockers.length) parts.push(createElement("p", "neg ot-text", `Can't import: ${plan.blockers.join("; ")}.`));

  const differences = plan.total_checks.filter((check) => check.differences.length);
  const counts = plan.counts;
  parts.push(paragraph(
    strong(formatPeriod(plan.period.from, plan.period.to)), ` · ${counts.expense} expenses, ${counts.income} income, ${counts.adjustment} recounts`,
    counts.excluded ? ` · ${counts.excluded} left out` : "", counts.after_netto_start ? ` · ${counts.after_netto_start} after netto's start, skipped` : "",
  ));
  parts.push(differences.length
    ? createElement("p", "neg ot-text", `These months don't match the old tracker's own totals: ${differences.map((check) => `${check.month} ${check.differences.map((difference) => `${difference.label} ${euroFormatter.format(difference.lines)} vs ${euroFormatter.format(difference.sheet)}`).join(", ")}`).join("; ")}.`)
    : createElement("p", "pos ot-text", "✓ Every month adds up to the old tracker's own totals: nothing was missed."));

  if (plan.new_categories.length) {
    const expense = plan.new_categories.filter((category) => category.kind === "expense").map((category) => category.name);
    const income = plan.new_categories.filter((category) => category.kind === "income").map((category) => category.name);
    parts.push(section("New categories",
      paragraph(expense.length ? `Spending: ${expense.join(", ")} (one-off). ` : "", income.length ? `Income: ${income.join(", ")}.` : "")));
  }

  const corrected = plan.lines.filter((line) => line.correction);
  if (corrected.length) {
    const details = createElement("details", "ot-details");
    details.append(createElement("summary", "", `Corrected: ${corrected.length} lines (coffee, fuel, clothes, health, recalculations)`));
    const list = createElement("ul", "ot-lines");
    list.append(...corrected.map((line) => createLineRow(line, false)));
    details.append(list);
    parts.push(details);
  }

  const flagged = plan.lines.filter((line) => line.flag);
  if (flagged.length) {
    const list = createElement("div", "ot-lines");
    list.append(...flagged.map((line) => createLineRow(line, true)));
    parts.push(section("Look at these (ticked = imported)", list));
  }

  parts.push(createAccountsSection(plan.history_account, plan.first_netto_day));
  parts.push(createCarAndInvestments(plan.car, plan.investments));
  parts.push(section("What each category cost", ...createCategoryTable(plan.lines, plan.first_netto_day)));
  parts.push(createElement("p", "hint small", "A copy of your data is saved in the backups folder just before importing, so it can always be undone."));
  box.replaceChildren(...parts);
}

async function refreshPreview() {
  elementById("old-tracker-error").textContent = "";
  try {
    plan = await callApi("/import/old-tracker/preview", { method: "POST", body: { csv: csvText, excluded: [...excluded] } });
    renderPreview();
  } catch (error) {
    elementById("old-tracker-error").textContent = error.message;
  }
}

async function openPreview(file) {
  csvText = await file.text();
  excluded = new Set();
  elementById("old-tracker-preview").replaceChildren(createElement("p", "hint", "Reading the file…"));
  elementById("old-tracker-import").disabled = true;
  elementById("old-tracker-dialog").showModal();
  await refreshPreview();
}

async function importNow() {
  const button = elementById("old-tracker-import");
  button.disabled = true;
  button.textContent = "Importing…";
  try {
    const result = await callApi("/import/old-tracker", { method: "POST", body: { csv: csvText, excluded: [...excluded] } });
    elementById("old-tracker-dialog").close();
    showToast(`Imported ${result.imported} transactions from the old tracker`);
    loadAllData();
  } catch (error) {
    elementById("old-tracker-error").textContent = error.message;
    button.disabled = false;
    button.textContent = "Try again";
  }
}

export function initializeOldTrackerImport() {
  const fileInput = elementById("old-tracker-file");
  fileInput.addEventListener("change", () => {
    const [file] = fileInput.files;
    fileInput.value = ""; // the same file can be picked again
    if (file) openPreview(file);
  });
  elementById("old-tracker-import").addEventListener("click", importNow);
}
