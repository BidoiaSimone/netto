// ---- netto expenses: ExpensesReport.html, what was spent each month by category ----
// One row per expense category, one column per month (from the first expense to this month, the newest on the
// left), the month's total at the bottom and each category's monthly average on the right. Only expenses count:
// this edition has no income and no net worth. "Download CSV" gives every expense, one per line, for a spreadsheet.

import { createCategoryIcon } from "../core/categoryIcons.js";
import { visibleEuroFormatter, getTodayAsLocalDate } from "../core/formatting.js";

const table = document.getElementById("report-table");
const summaryLine = document.getElementById("report-summary");
const problemLine = document.getElementById("report-problem");
const downloadButton = document.getElementById("report-download");

let expenses = [];

const UNCATEGORIZED = { id: null, name: "Uncategorized" };
const formatEuros = (amount) => (amount ? visibleEuroFormatter.format(amount) : "–");
const centsOf = (euros) => Math.round(euros * 100);

// "2026-10" -> "Oct 2026"
const formatMonth = (yearMonth) => new Date(`${yearMonth}-01T12:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

// Every month from the first one to the last one, both included, newest first: ["2026-10", "2026-09", …]
function listMonthsBackwards(firstMonth, lastMonth) {
  const months = [];
  for (let [year, month] = lastMonth.split("-").map(Number); `${year}-${String(month).padStart(2, "0")}` >= firstMonth;) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    [year, month] = month === 1 ? [year - 1, 12] : [year, month - 1];
  }
  return months;
}

const cell = (tag, content, className = "") => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.append(content);
  return element;
};

function drawTable(categories) {
  const thisMonth = getTodayAsLocalDate().slice(0, 7);
  const firstMonth = expenses.reduce((first, expense) => (expense.date.slice(0, 7) < first ? expense.date.slice(0, 7) : first), thisMonth);
  const months = listMonthsBackwards(firstMonth, thisMonth);

  // cents by category id, then by month (cents, so the totals add up exactly)
  const centsByCategory = new Map();
  for (const expense of expenses) {
    const byMonth = centsByCategory.get(expense.category_id ?? null) ?? new Map();
    const month = expense.date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + centsOf(expense.amount));
    centsByCategory.set(expense.category_id ?? null, byMonth);
  }
  const rows = [...categories, ...(centsByCategory.has(null) ? [UNCATEGORIZED] : [])]
    .map((category) => ({ category, byMonth: centsByCategory.get(category.id) ?? new Map() }))
    .map((row) => ({ ...row, totalCents: [...row.byMonth.values()].reduce((sum, cents) => sum + cents, 0) }))
    .sort((first, second) => second.totalCents - first.totalCents);
  const monthTotalCents = (month) => rows.reduce((sum, row) => sum + (row.byMonth.get(month) ?? 0), 0);
  const allCents = rows.reduce((sum, row) => sum + row.totalCents, 0);

  const headRow = document.createElement("tr");
  headRow.append(cell("th", "Category"), ...months.map((month) => cell("th", formatMonth(month), "amount")), cell("th", "Average / month", "amount average"));
  table.tHead.replaceChildren(headRow);

  table.tBodies[0].replaceChildren(...rows.map(({ category, byMonth, totalCents }) => {
    const label = cell("span", createCategoryIcon(category, "category-icon small"), "category-cell");
    label.append(category.name);
    const name = cell("th", label);
    name.scope = "row";
    const row = document.createElement("tr");
    row.append(name, ...months.map((month) => cell("td", formatEuros((byMonth.get(month) ?? 0) / 100), "amount")),
      cell("td", formatEuros(totalCents / 100 / months.length), "amount average"));
    return row;
  }));

  const totalRow = document.createElement("tr");
  totalRow.append(cell("th", "Total"), ...months.map((month) => cell("td", formatEuros(monthTotalCents(month) / 100), "amount")),
    cell("td", formatEuros(allCents / 100 / months.length), "amount average"));
  table.tFoot.replaceChildren(totalRow);

  summaryLine.textContent = expenses.length
    ? `${expenses.length} expenses since ${formatMonth(firstMonth)}, ${formatEuros(allCents / 100)} in all. This month so far: ${formatEuros(monthTotalCents(thisMonth) / 100)}.`
    : "Nothing written down yet.";
}

// Every expense as a CSV a spreadsheet opens as it is: ";" between the columns and a decimal comma, like Excel set to
// Italian expects, and a BOM so the accents come out right
function downloadCsv() {
  const quote = (text) => `"${String(text).replace(/"/g, '""')}"`;
  const lines = [["date", "month", "category", "amount", "note"].join(";"),
    ...[...expenses].reverse().map((expense) => [expense.date, expense.date.slice(0, 7), quote(expense.category ?? UNCATEGORIZED.name),
      expense.amount.toFixed(2).replace(".", ","), quote(expense.description ?? "")].join(";"))];
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  link.download = `expenses-${getTodayAsLocalDate()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function loadReport() {
  try {
    const [transactions, categories] = await Promise.all(["/transactions", "/categories"].map(async (path) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`${path} answered ${response.status}`);
      return response.json();
    }));
    expenses = transactions.filter((transaction) => transaction.type === "expense");
    drawTable(categories.filter((category) => category.kind === "expense"));
  } catch (error) {
    problemLine.textContent = `Couldn't load the expenses (${error.message}).`;
    problemLine.hidden = false;
  }
}

downloadButton.addEventListener("click", downloadCsv);
loadReport();
