// ---- Home > the month's wrap-up: last month in a few lines, from the 1st until you close it ----
// GET /month-wrap-up answers with last month's, or null once it's been closed (or with no records that month).
// "Got it" closes it for good, on every device (PUT /month-wrap-up/dismiss). The maths: backend/server/services/monthWrapUp.js.
// Settings > Month wrap-ups shows any past month's again, in the same card (with "Close" instead of "Got it").

import { elementById, createElement } from "../core/domHelpers.js";
import { euroFormatter, formatSignedEuros, formatShortDate } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { showErrorMessage } from "../core/errorBanner.js";
import { t, dateLocale, nameOfCategory } from "../core/i18n.js";

const monthFormatter = new Intl.DateTimeFormat(dateLocale, { month: "long", year: "numeric" });
const monthNameFormatter = new Intl.DateTimeFormat(dateLocale, { month: "long" });
const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 0 });
const monthDate = (yearMonth) => new Date(yearMonth + "-15T12:00");
const previousMonthName = (yearMonth) => { const date = monthDate(yearMonth); date.setMonth(date.getMonth() - 1); return monthNameFormatter.format(date); };

export async function loadMonthWrapUp() {
  const { wrap_up: wrapUp } = await callApi("/month-wrap-up");
  renderMonthWrapUp(wrapUp);
}

// One line: a label in grey, then the parts
function createLine(label, ...parts) {
  const line = createElement("p", "wrap-line");
  const value = createElement("span", "wrap-value"); // one box for all the parts: the line is a two-column grid
  value.append(...parts);
  line.append(createElement("span", "wrap-label", label), value);
  return line;
}

// "You saved 558,84 € · 28% of what came in", or the shortfall
function createHeadline(wrapUp) {
  const headline = createElement("p", "wrap-headline");
  if (wrapUp.saved >= 0) {
    headline.append(t("You saved "), createElement("strong", "pos", euroFormatter.format(wrapUp.saved)),
      wrapUp.savings_rate !== null ? t(" · {share} of what came in", { share: percentFormatter.format(wrapUp.savings_rate) }) : "");
  } else {
    headline.append(t("You spent "), createElement("strong", "neg", euroFormatter.format(-wrapUp.saved)), t(" more than came in"));
  }
  return headline;
}

// "1.421,31 € spent · −12% on September" (or why there's nothing to compare with)
function createSpendingLine(wrapUp) {
  const parts = [t("{out} out, {in} in", { out: euroFormatter.format(wrapUp.expenses), in: euroFormatter.format(wrapUp.income) })];
  if (wrapUp.expenses_before > 0 && !wrapUp.previous_is_partial) {
    const change = (wrapUp.expenses - wrapUp.expenses_before) / wrapUp.expenses_before;
    parts.push(createElement("span", change > 0 ? "neg" : "pos", " · " + t("spending {change} on {month}", { change: `${change > 0 ? "+" : "−"}${percentFormatter.format(Math.abs(change))}`, month: previousMonthName(wrapUp.month) })));
  }
  return createLine(t("Money"), ...parts);
}

function createCategoriesLine(wrapUp) {
  const parts = [];
  wrapUp.top_categories.forEach((category, index) => {
    if (index) parts.push(" · ");
    parts.push(`${nameOfCategory(category)} ${euroFormatter.format(category.amount)}`);
    if (category.amount_before !== null && !wrapUp.previous_is_partial && category.amount !== category.amount_before) {
      parts.push(createElement("small", "hint", ` (${formatSignedEuros(category.amount - category.amount_before)})`));
    }
  });
  return createLine(t("Most spent on"), ...parts);
}

// closeLabel / closeTitle / onClose: what its button says and does (Home: "Got it", closed for good)
function createWrapUpCard(wrapUp, { closeLabel, closeTitle, onClose }) {
  const card = createElement("article", "wrap-up");
  const head = createElement("div", "wrap-head");
  const title = createElement("h4", "", t("{month} wrap-up", { month: monthFormatter.format(monthDate(wrapUp.month)) }));
  if (wrapUp.is_partial) title.append(createElement("small", "hint", " " + t("from {date}, when you started", { date: formatShortDate(wrapUp.from) })));
  const closeButton = createElement("button", "ghost", closeLabel);
  closeButton.type = "button";
  closeButton.title = closeTitle;
  closeButton.addEventListener("click", () => onClose(card));
  head.append(title, closeButton);
  card.append(head, createHeadline(wrapUp), createSpendingLine(wrapUp));

  if (wrapUp.top_categories.length) card.append(createCategoriesLine(wrapUp));
  const biggest = wrapUp.biggest_expense;
  if (biggest) {
    card.append(createLine(t("Biggest purchase"), t("{what}, {amount} on {date}", { what: biggest.description || biggest.category || t("an expense"), amount: euroFormatter.format(biggest.amount), date: formatShortDate(biggest.date) })));
  }
  if (wrapUp.budgets) {
    const { within, over } = wrapUp.budgets;
    card.append(createLine(t("Budgets"), over.length
      ? createElement("span", "neg", t("over in {list}", { list: over.map((row) => t("{name} ({actual} of {budget})", { name: row.name, actual: euroFormatter.format(row.actual), budget: euroFormatter.format(row.budget) })).join(", ") }))
      : createElement("span", "pos", t("all {count} kept", { count: within })),
      over.length && within ? ` · ${t("{count} kept", { count: within })}` : ""));
  }
  if (wrapUp.goals.length) {
    const parts = [];
    wrapUp.goals.forEach((goal, index) => {
      if (index) parts.push(" · ");
      parts.push(`${goal.name} `, createElement("span", goal.saved >= 0 ? "pos" : "neg", formatSignedEuros(goal.saved)));
    });
    card.append(createLine(t("Goals"), ...parts));
  }
  card.append(createLine(t("Habit"), t("you added something on {count} of {days} days", { count: wrapUp.days_with_entries, days: wrapUp.days })));
  return card;
}

async function dismiss(month, card) {
  card.classList.add("closing");
  try {
    await callApi("/month-wrap-up/dismiss", { method: "PUT", body: { month } });
    elementById("month-wrap-up").replaceChildren();
  } catch (error) {
    card.classList.remove("closing");
    showErrorMessage(error.message);
  }
}

export function renderMonthWrapUp(wrapUp) {
  elementById("month-wrap-up").replaceChildren(...(wrapUp ? [createWrapUpCard(wrapUp, {
    closeLabel: t("Got it"),
    closeTitle: t("Close it: it won't be shown again (Settings > Month wrap-ups has every month). The next one comes on the 1st of next month."),
    onClose: (card) => dismiss(wrapUp.month, card),
  })] : []));
}

// ---------- Settings > Month wrap-ups: look at any past month's again ----------

export async function loadWrapUpMonths() {
  const months = await callApi("/month-wrap-up/months");
  const picker = elementById("wrap-up-month");
  const picked = picker.value;
  picker.replaceChildren(...months.map((month) => new Option(monthFormatter.format(monthDate(month)), month)));
  if (months.includes(picked)) picker.value = picked;
  picker.disabled = elementById("wrap-up-show").disabled = !months.length;
  elementById("wrap-up-none").hidden = months.length > 0;
}

async function showPickedWrapUp() {
  const month = elementById("wrap-up-month").value;
  if (!month) return;
  try {
    const { wrap_up: wrapUp } = await callApi(`/month-wrap-up?month=${month}`);
    elementById("wrap-up-again").replaceChildren(...(wrapUp ? [createWrapUpCard(wrapUp, {
      closeLabel: t("Close"), closeTitle: t("Hide it"), onClose: () => elementById("wrap-up-again").replaceChildren(),
    })] : []));
  } catch (error) {
    showErrorMessage(error.message);
  }
}

export function initializeWrapUpSettings() {
  elementById("wrap-up-show").addEventListener("click", showPickedWrapUp);
  elementById("wrap-up-month").addEventListener("change", showPickedWrapUp);
}
